"""File parsing and the non-destructive preprocessing pipeline.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
"""
import io
import re
from collections import Counter

import numpy as np
from pybaselines import Baseline
from scipy.signal import savgol_filter

import formats


# ---------------------------------------------------------------- parsing
def _rows_from_text(text):
    lines = text.splitlines()
    # decimal commas: ';' or tab separated numbers with ',' and no '.'
    if '.' not in text and ',' in text and (';' in text or '\t' in text):
        lines = [ln.replace(',', '.') for ln in lines]
    return [[t for t in re.split(r'[,;\t ]+', ln.strip()) if t] for ln in lines]


def _to_float(tok):
    try:
        return float(tok)
    except (TypeError, ValueError):
        return None


def parse_table(rows):
    """rows: list of token lists. Finds the numeric block, skipping metadata/header lines."""
    num = [[_to_float(t) for t in r] for r in rows]
    is_num = [len(r) >= 2 and all(v is not None for v in r) for r in num]
    if not any(is_num):
        raise ValueError('No numeric data columns found')
    ncol = Counter(len(r) for r, ok in zip(num, is_num) if ok).most_common(1)[0][0]
    keep = [i for i, ok in enumerate(is_num) if ok and len(num[i]) == ncol]
    data = np.array([num[i] for i in keep], float)
    header = rows[keep[0] - 1] if keep[0] > 0 else []
    cols = [str(h) for h in header] if len(header) == ncol else [f'Column {i + 1}' for i in range(ncol)]
    data = data[np.all(np.isfinite(data), axis=1)]
    return dict(columns=cols, data=data.T.tolist())


def parse_file(name, raw):
    reader = formats.reader_for(name)
    if reader:
        try:
            return reader(raw)
        except ValueError:
            raise
        except Exception as e:  # corrupt or unexpected variant of a binary format
            raise ValueError(f'Could not read {name}: {e}')
    if name.lower().endswith(('.xlsx', '.xls')):
        import pandas as pd
        df = pd.read_excel(io.BytesIO(raw), header=None)
        rows = [[v for v in r if not (isinstance(v, float) and np.isnan(v))] for r in df.values.tolist()]
    else:
        rows = _rows_from_text(raw.decode('utf-8-sig', errors='replace'))
    return parse_table(rows)


# ---------------------------------------------------------------- steps
def crop(x, y, p):
    m = (x >= p.get('min', -np.inf)) & (x <= p.get('max', np.inf))
    return (x[m], y[m]) if m.sum() >= 5 else (x, y)


def despike(x, y, p):
    """Whitaker-Hayes: modified Z-score of the first difference; spikes replaced by neighbour mean."""
    thr, m = float(p.get('threshold', 7)), int(p.get('width', 3))
    d = np.diff(y)
    mad = np.median(np.abs(d - np.median(d)))
    if mad == 0:
        return x, y
    z = np.abs(0.6745 * (d - np.median(d)) / mad)
    spike = np.concatenate([[False], z > thr])
    spike |= np.concatenate([spike[1:], [False]])  # both sides of the jump
    # A cosmic ray is at most `width` points wide; longer flagged runs are the steep
    # flanks of real, sharp peaks and must be left alone.
    edges = np.flatnonzero(np.diff(np.concatenate([[0], spike.astype(int), [0]])))
    for a, b in zip(edges[::2], edges[1::2]):
        if b - a > m + 2:
            spike[a:b] = False
    out = y.copy()
    for i in np.flatnonzero(spike):
        w = np.arange(max(0, i - m), min(len(y), i + m + 1))
        w = w[~spike[w]]
        if len(w):
            out[i] = y[w].mean()
    return x, out


def baseline(x, y, p):
    fit = Baseline(x_data=x)
    method = p.get('method', 'als')
    lam = 10 ** float(p.get('lam', 6))
    if method == 'als':
        b = fit.asls(y, lam=lam, p=float(p.get('p', 0.01)))[0]
    elif method == 'airpls':
        b = fit.airpls(y, lam=lam)[0]
    elif method == 'poly':
        b = fit.imodpoly(y, poly_order=int(p.get('order', 3)))[0]
    else:  # rubberband: lower convex hull
        b = _rubberband(x, y)
    return x, y - b, b


def _rubberband(x, y):
    hull = []  # lower convex hull, monotone chain
    for i in np.argsort(x):
        while len(hull) >= 2:
            a, b = hull[-2], hull[-1]
            if (x[b] - x[a]) * (y[i] - y[a]) - (y[b] - y[a]) * (x[i] - x[a]) <= 0:
                hull.pop()
            else:
                break
        hull.append(i)
    return np.interp(x, x[hull], y[hull])


def smooth(x, y, p):
    w = int(p.get('window', 9)) | 1  # force odd
    w = min(w, len(y) - (1 - len(y) % 2))
    if w < 3:
        return x, y
    if p.get('method', 'savgol') == 'savgol':
        return x, savgol_filter(y, w, min(int(p.get('order', 3)), w - 1))
    pad = np.pad(y, w // 2, mode='edge')
    return x, np.convolve(pad, np.ones(w) / w, mode='valid')


def normalize(x, y, p):
    method = p.get('method', 'minmax')
    if method == 'minmax':
        r = y.max() - y.min()
        return x, (y - y.min()) / r if r else y
    if method == 'vector':
        n = np.linalg.norm(y)
        return x, y / n if n else y
    if method == 'area':
        a = abs(np.trapezoid(y, x))
        return x, y / a if a else y
    s = y.std()  # snv
    return x, (y - y.mean()) / s if s else y


def derivative(x, y, p):
    """Savitzky-Golay derivative (order 1 or 2) with respect to x."""
    w = min(int(p.get('window', 11)) | 1, len(y) - (1 - len(y) % 2))
    order = int(p.get('order', 1))
    if w < 5:
        return x, y
    return x, savgol_filter(y, w, max(int(p.get('poly', 3)), order + 1), deriv=order, delta=float(np.median(np.diff(x))) or 1.0)


def convert(x, y, p):
    """Unit conversions. t2a/a2t: transmittance <-> absorbance (%T if values exceed 1.5).
    nm2shift: wavelength (nm) -> Raman shift for the given laser. nm2wn: wavelength (nm) -> cm-1."""
    mode = p.get('mode', 't2a')
    if mode == 't2a':
        t = y / 100 if np.nanmax(y) > 1.5 else y
        return x, -np.log10(np.clip(t, 1e-6, None))
    if mode == 'a2t':
        return x, 100 * 10 ** (-y)
    if mode in ('nm2shift', 'nm2wn'):
        ok = x > 0
        nx = (1e7 / float(p.get('laser', 532)) if mode == 'nm2shift' else 0) - 1e7 / x[ok]
        nx = nx if mode == 'nm2shift' else -nx
        o = np.argsort(nx)
        return nx[o], y[ok][o]
    return x, y


def resample(x, y, p):
    """Linear interpolation onto an evenly spaced x grid."""
    step = float(p.get('step', 1))
    if step <= 0 or (x[-1] - x[0]) / step > 2_000_000:
        return x, y
    nx = np.arange(x[0], x[-1] + step / 2, step)
    return nx, np.interp(nx, x, y)


def shift(x, y, p):
    """Calibration offset added to the x axis."""
    return x + float(p.get('dx', 0)), y


STEPS = dict(crop=crop, despike=despike, baseline=baseline, smooth=smooth, normalize=normalize,
             derivative=derivative, convert=convert, resample=resample, shift=shift)


def run_pipeline(x, y, steps):
    """Apply enabled steps in order. Returns dict(x, y, baseline?) where baseline is the
    curve estimated by the last baseline step plus the signal it was estimated on."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    o = np.argsort(x)
    x, y = x[o], y[o]
    out = {}
    for s in steps:
        if not s.get('enabled', True) or s['type'] not in STEPS:
            continue
        before = y
        r = STEPS[s['type']](x, y, s.get('params', {}))
        x, y = r[0], r[1]
        if len(r) == 3:
            out['baseline'] = dict(x=x.tolist(), y=r[2].tolist(), input=before.tolist())
    out.update(x=x.tolist(), y=y.tolist())
    return out


if __name__ == '__main__':  # self-check
    xs = np.linspace(100, 1800, 1701)
    peak = 100 / (1 + ((xs - 464) / 5) ** 2)
    ys = peak + 0.02 * xs + 50
    ys[700] += 500  # cosmic ray
    r = run_pipeline(xs, ys, [
        dict(type='crop', params=dict(min=200, max=1500)),
        dict(type='despike', params=dict(threshold=7, width=3)),
        dict(type='baseline', params=dict(method='als', lam=6, p=0.01)),
        dict(type='smooth', params=dict(method='savgol', window=7, order=3)),
        dict(type='normalize', params=dict(method='minmax')),
    ])
    rx, ry = np.array(r['x']), np.array(r['y'])
    assert rx[0] >= 200 and rx[-1] <= 1500
    assert abs(rx[ry.argmax()] - 464) < 2, rx[ry.argmax()]
    assert ry[np.abs(rx - 800).argmin()] < 0.05, 'spike or baseline survived'
    sharp = 100 / (1 + ((xs - 464) / 6) ** 2) + np.random.default_rng(0).normal(0, 0.5, xs.size)
    assert np.allclose(despike(xs, sharp, {})[1][350:380], sharp[350:380]), 'despike damaged a real peak'
    for m in ('airpls', 'poly', 'rubberband'):
        b = run_pipeline(xs, peak + 0.02 * xs + 50, [dict(type='baseline', params=dict(method=m))])
        assert abs(np.array(b['x'])[np.argmax(b['y'])] - 464) < 2, m
    xs2 = np.linspace(100, 200, 201)
    d1 = run_pipeline(xs2, xs2 ** 2, [dict(type='derivative', params=dict(order=1, window=7))])
    assert abs(d1['y'][100] - 2 * xs2[100]) < 1e-6
    assert abs(run_pipeline(xs2, np.full(201, 10.0), [dict(type='convert', params=dict(mode='t2a'))])['y'][0] - 1) < 1e-9
    sh = run_pipeline([532.0, 550.0, 600.0], [1, 2, 3], [dict(type='convert', params=dict(mode='nm2shift', laser=532))])
    assert abs(sh['x'][0]) < 1e-9 and abs(sh['x'][1] - 615.2) < 0.1, sh['x']
    rs = run_pipeline([0, 1, 4], [0, 1, 4], [dict(type='resample', params=dict(step=0.5)), dict(type='shift', params=dict(dx=2))])
    assert len(rs['x']) == 9 and rs['x'][0] == 2 and rs['y'][3] == 1.5
    assert parse_file('s.ras', b'*RAS_INT_START\n10 5 1\n11 7 1\n12 6 1\n*RAS_INT_END')['data'][1] == [5, 7, 6]
    t = parse_file('a.txt', b'# meta line\nShift;Int\n100,5;1,0\n101,5;2,0\n102,5;3,0\n')
    assert t['columns'] == ['Shift', 'Int'] and t['data'][0][0] == 100.5, t
    print('processing ok')
