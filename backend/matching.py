"""Library search: cosine + Pearson + shift-tolerant peak matching, optional two-phase mixture check.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
"""
from itertools import combinations

import numpy as np
from pybaselines import Baseline
from scipy.ndimage import uniform_filter1d
from scipy.optimize import nnls
from scipy.signal import find_peaks

import library as L

# Wavelength the XRD library was computed at: pymatgen's 'CuKa', the weighted K-alpha average.
CU_KA = 1.54184
PREFILTER = 300  # ponytail: peak scoring only for the best N by first-pass score; raise if recall matters
POOL, SECOND, FIRST = 12, 5, 3  # mixture check: phases of the sample, phases of each residual, phases subtracted


def peak_score(sample, ref, tol):
    """sample/ref: arrays [[pos, intensity], ...]. Intensity-weighted fraction of ref peaks found in
    the sample and of sample peaks explained by the ref, combined as a harmonic mean.
    Returns (score 0-1, [[sample_pos, ref_pos], ...])."""
    if len(sample) == 0 or len(ref) == 0:
        return 0.0, []
    d = np.abs(sample[:, None, 0] - ref[None, :, 0])
    hit = d <= tol
    a = ref[hit.any(0), 1].sum() / ref[:, 1].sum()
    b = sample[hit.any(1), 1].sum() / sample[:, 1].sum()
    pairs = [[float(sample[d[:, j].argmin(), 0]), float(ref[j, 0])] for j in np.flatnonzero(hit.any(0))]
    return (2 * a * b / (a + b) if a + b else 0.0), pairs


def _sample_peaks(x, y, n=15):
    rng = (y.max() - y.min()) or 1.0
    idx, pr = find_peaks(y, prominence=0.04 * rng)
    keep = np.argsort(pr['prominences'])[::-1][:n]
    return np.array(sorted([x[idx[k]], y[idx[k]] - y.min()] for k in keep)).reshape(-1, 2)


def _combine(cos, pear, peak, w):
    tot = sum(w) or 1.0
    return 100 * (w[0] * cos + w[1] * max(pear, 0) + w[2] * peak) / tot


def _match_spectra(x, y, technique, lib_ids, tol, w, peaks):
    g = L.grid(technique)
    r = L.to_grid(x, y, technique)
    if r is None:
        raise ValueError('Spectrum does not overlap the library range')
    row, lo, hi = r
    q = row.astype(np.float32) / 255
    i0, i1 = np.searchsorted(g, lo), np.searchsorted(g, hi) + 1
    sp = peaks if peaks is not None else _sample_peaks(g[i0:i1], q[i0:i1])
    # Blur sample and references over ~the tolerance window so that the correlation scores
    # survive calibration drift instead of collapsing on sharp, slightly shifted peaks.
    blur = 2 * max(1, round(tol / 2 / L.GRIDS[technique][2])) + 1
    q = q.copy()
    q[i0:i1] = uniform_filter1d(q[i0:i1], blur, mode='nearest')
    c1, c2 = np.concatenate([[0], np.cumsum(q)]), np.concatenate([[0], np.cumsum(q * q)])
    cands = []
    for lid in lib_ids:
        meta, M = L.load(lid)
        if meta['kind'] != 'spectra' or meta['technique'] != technique:
            continue
        ent = meta['entries']
        Mf = uniform_filter1d(M[:, i0:i1].astype(np.float32) / 255, blur, axis=1, mode='nearest')
        # overlap of each entry's valid range with the sample's
        a = np.maximum(np.searchsorted(g, [e['lo'] for e in ent]), i0)
        b = np.minimum(np.searchsorted(g, [e['hi'] for e in ent]) + 1, i1)
        n = np.maximum(b - a, 0).astype(np.float32)
        sq, sqq = c1[b] - c1[a], c2[b] - c2[a]          # sample sums over each overlap
        sm, smm, smq = Mf.sum(1), (Mf * Mf).sum(1), Mf @ q[i0:i1]
        with np.errstate(divide='ignore', invalid='ignore'):
            cos = smq / np.sqrt(smm * sqq)
            pear = (n * smq - sm * sq) / np.sqrt((n * smm - sm ** 2) * (n * sqq - sq ** 2))
        ok = (n >= max(100, 0.25 * (i1 - i0))) & np.isfinite(cos) & np.isfinite(pear)
        for k in np.flatnonzero(ok):
            cands.append((float(cos[k]), float(pear[k]), lid, int(k)))
    cands.sort(key=lambda c: -(w[0] * c[0] + w[1] * max(c[1], 0)))
    out = []
    # with no weight on the correlations there is no first-pass ranking: score the peaks of every candidate
    for cos, pear, lid, k in (cands[:PREFILTER] if w[0] + w[1] > 0 else cands):
        meta, M = L.load(lid)
        e = meta['entries'][k]
        rp = np.array([p for p in e['peaks'] if lo <= p[0] <= hi]).reshape(-1, 2)
        sps = sp[(sp[:, 0] >= e['lo']) & (sp[:, 0] <= e['hi'])] if len(sp) else sp
        ps, pairs = peak_score(sps, rp, tol)
        # reference is shown only where it overlaps the sample
        j0, j1 = max(np.searchsorted(g, e['lo']), i0), min(np.searchsorted(g, e['hi']) + 1, i1)
        out.append(dict(name=e['name'], formula=e['formula'], system=e['system'], info=e['info'],
                        library=meta['title'], score=_combine(cos, pear, ps, w), cosine=cos, pearson=pear,
                        peak=ps, pairs=pairs, ref_peaks=e['peaks'], _lid=lid, _k=k, _range=(j0, j1)))
    return out, g, q, (i0, i1)


def _col(t, rng, blur):
    """Reference row of a candidate over the sample range, blurred like the sample."""
    row = L.load(t['_lid'])[1][t['_k'], rng[0]:rng[1]].astype(float) / 255
    return uniform_filter1d(row, blur, mode='nearest')


def _mixture(res, g, rng, x, y, technique, lib_ids, tol, w):
    """Two-phase check. Candidates: the best phases of the sample plus the best phases of what each of
    the three best single phases leaves unexplained. Every pair is fitted by non-negative least squares
    and scored like a single reference (cosine, Pearson, peaks) with the fitted sum as the reference;
    the best pair is compared with the best single phase."""
    i0, i1 = rng
    gg = g[i0:i1]
    # blurred over twice the tolerance so a small shift does not leave a fake residual
    blur = 2 * max(1, round(tol / L.GRIDS[technique][2])) + 1
    qraw = L.to_grid(x, y, technique)[0][i0:i1].astype(float) / 255
    b = uniform_filter1d(qraw, blur, mode='nearest')
    ss = float(b @ b) or 1.0
    sp = _sample_peaks(gg, qraw)
    pool = _distinct(list(res), POOL)
    first = pool[:FIRST]
    names = {t['name'].lower() for t in pool}
    cols = {}

    def col(t):
        if t['name'] not in cols:
            cols[t['name']] = _col(t, rng, blur)
        return cols[t['name']]

    def rpk(t, k=1.0):
        return [[p[0], p[1] * k] for p in t['ref_peaks'] if gg[0] <= p[0] <= gg[-1]]

    def score(fit, rp):
        nf = float(np.linalg.norm(fit) * np.linalg.norm(b))
        cos = float(fit @ b) / nf if nf else 0.0
        pear = float(np.corrcoef(fit, b)[0, 1]) if fit.std() and b.std() else 0.0
        return _combine(cos, pear, peak_score(sp, np.array(rp, float).reshape(-1, 2), tol)[0], w)

    single_r2 = single = 0.0
    for t in first:
        c = col(t)
        k, r = nnls(c[:, None], b)
        single_r2 = max(single_r2, 1 - r ** 2 / ss)
        single = max(single, score(c, rpk(t)))
        left = np.clip(b - k[0] * c, 0, None)
        if left.max() > 0.15 * b.max():
            try:
                res2 = _match_spectra(gg, left, technique, lib_ids, tol, w, None)[0]
            except ValueError:
                continue
            for t2 in _distinct(res2, SECOND):
                if t2['name'].lower() not in names:
                    names.add(t2['name'].lower())
                    pool.append(t2)
    best = None
    for t1, t2 in combinations(pool, 2):
        c1, c2 = col(t1), col(t2)
        k, r = nnls(np.column_stack([c1, c2]), b)
        if k.min() <= 0:
            continue
        v = score(k[0] * c1 + k[1] * c2, rpk(t1, k[0]) + rpk(t2, k[1]))
        if best is None or v > best[0]:
            best = (v, t1, t2, k, 1 - r ** 2 / ss)
    if best is None:
        return None
    v, t1, t2, k, r2 = best
    ev = []  # the peaks of each phase must be present in what the other phase leaves unexplained
    for ta, tb, kb in ((t1, t2, k[1]), (t2, t1, k[0])):
        left = np.clip(b - kb * col(tb), 0, None)
        ev.append(peak_score(_sample_peaks(gg, left), np.array(rpk(ta), float).reshape(-1, 2), tol)[0])
    f = k / k.sum()
    gain = (v - single) / 100
    return dict(r2=r2, single_r2=single_r2, gain=gain, second_peak=min(ev),
                components=[dict(name=t1['name'], fraction=float(f[0])), dict(name=t2['name'], fraction=float(f[1]))],
                likely=bool(gain > 0.04 and f.min() > 0.1 and min(ev) >= 0.6))


def _match_xrd(x, y, lib_ids, tol, w, peaks, wavelength):
    yn = (y - y.min()) / ((y.max() - y.min()) or 1.0)
    sp = peaks if peaks is not None else _sample_peaks(x, yn, n=25)
    out = []
    for lid in lib_ids:
        meta, _ = L.load(lid)
        if meta['kind'] != 'peaks' or meta['technique'] != 'xrd':
            continue
        for e in meta['entries']:
            rp = np.array(e['peaks'], float).reshape(-1, 2)
            if abs(wavelength - CU_KA) > 1e-4 and len(rp):  # re-map 2-theta via d-spacing
                s = np.sin(np.radians(rp[:, 0] / 2)) * wavelength / CU_KA
                rp = rp[s < 1]
                rp[:, 0] = 2 * np.degrees(np.arcsin(s[s < 1]))
            rp = rp[(rp[:, 0] >= x[0]) & (rp[:, 0] <= x[-1])]
            ps, pairs = peak_score(sp, rp, tol)
            out.append((ps, pairs, rp, e, meta['title']))
    out.sort(key=lambda t: -t[0])
    res = []
    for ps, pairs, rp, e, title in out[:PREFILTER]:
        ref = (rp[:, 1, None] * np.exp(-0.5 * ((x[None, :] - rp[:, 0, None]) / 0.08) ** 2)).sum(0)
        m = ref.max() or 1.0
        ref = ref / m
        cos = float(ref @ yn / (np.linalg.norm(ref) * np.linalg.norm(yn) or 1.0))
        pear = float(np.corrcoef(ref, yn)[0, 1]) if ref.std() else 0.0
        res.append(dict(name=e['name'], formula=e['formula'], system=e['system'], info=e['info'], library=title,
                        score=_combine(cos, pear, ps, w), cosine=cos, pearson=pear, peak=ps, pairs=pairs,
                        ref_peaks=rp.tolist(), ref=dict(x=x.tolist(), y=ref.tolist())))
    return res


def _distinct(res, n):
    res.sort(key=lambda r: -r['score'])
    seen, top = set(), []
    for r in res:
        if r['name'].lower() not in seen:
            seen.add(r['name'].lower())
            top.append(r)
        if len(top) == n:
            break
    return top


def match(x, y, technique, lib_ids, tol=8.0, weights=(0.4, 0.2, 0.4), mixture=False, peaks=None,
          wavelength=CU_KA, n=10, auto_baseline=False):
    x, y = np.asarray(x, float), np.asarray(y, float)
    o = np.argsort(x)
    x, y = x[o], y[o]
    if auto_baseline and len(y) > 20:  # search copy only; the workspace spectrum is untouched
        y = y - Baseline(x_data=x).asls(y, lam=1e6, p=0.01)[0]
    peaks = np.array(peaks, float).reshape(-1, 2) if peaks else None
    if technique == 'xrd':
        return dict(matches=_distinct(_match_xrd(x, y, lib_ids, tol, weights, peaks, wavelength), n), mixture=None)
    res, g, q, rng = _match_spectra(x, y, technique, lib_ids, tol, weights, peaks)
    top = _distinct(res, n)
    mix = _mixture(res, g, rng, x, y, technique, lib_ids, tol, weights) if mixture and top else None
    for t in top:
        _, M = L.load(t.pop('_lid'))
        j0, j1 = t.pop('_range')
        ry = M[t.pop('_k'), j0:j1].astype(float)
        t['ref'] = dict(x=g[j0:j1].tolist(), y=(ry / (ry.max() or 1.0)).round(4).tolist())
    return dict(matches=top, mixture=mix)
