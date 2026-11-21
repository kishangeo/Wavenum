"""Peak finding and Gaussian / Lorentzian / Voigt fitting.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
"""
import os

import numpy as np
from lmfit.models import GaussianModel, LinearModel, LorentzianModel, VoigtModel
from scipy.signal import find_peaks, peak_widths

MODELS = dict(gaussian=GaussianModel, lorentzian=LorentzianModel, voigt=VoigtModel)


def find(x, y, prominence=0.05, height=0.0, distance=10.0):
    """prominence/height are fractions of the spectrum's intensity range; distance is in x units."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    rng = float(y.max() - y.min()) or 1.0
    step = float(np.median(np.abs(np.diff(x)))) or 1.0
    idx, _ = find_peaks(y, prominence=prominence * rng, height=y.min() + height * rng,
                        distance=max(1, round(distance / step)))
    w = peak_widths(y, idx, rel_height=0.5)[0] * step
    return [dict(x=float(x[i]), y=float(y[i]), fwhm=float(wi)) for i, wi in zip(idx, w)]


def fit(x, y, centers, profile='lorentzian', xmin=None, xmax=None, starts=None, max_shift=None):
    """Fit one profile per centre plus a linear background over [xmin, xmax].

    starts: optional (center, sigma, height) start values per peak (Monte Carlo runs); max_shift: limit on
    how far each centre may move from the given one (SpecXY-style), instead of the default window."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    m = (x >= (xmin if xmin is not None else -np.inf)) & (x <= (xmax if xmax is not None else np.inf))
    x, y = x[m], y[m]
    centers = sorted(c for c in centers if x[0] <= c <= x[-1])
    if not centers:
        raise ValueError('No peaks inside the fit range')
    if len(x) < 4 * len(centers) + 2:
        raise ValueError('Too few data points in the fit range')
    step = float(np.median(np.diff(x)))
    span = x[-1] - x[0]
    model = LinearModel(prefix='bg_')
    pars = model.make_params(slope=0, intercept=float(y.min()))
    for i, c in enumerate(centers):
        mod = MODELS[profile](prefix=f'p{i}_')
        h = max(float(np.interp(c, x, y) - y.min()), 1e-9)
        gaps = [abs(c - o) for o in centers if o != c]
        sig = min(max(3 * step, span / 50), (min(gaps) / 2 if gaps else span))
        win = max_shift if max_shift else max(3 * sig, 5 * step)
        c0 = c
        if starts is not None:
            c0, sig, h = starts[i]
        p = mod.make_params()
        p[f'p{i}_center'].set(c0, min=c - win, max=c + win)
        p[f'p{i}_sigma'].set(min(max(sig, step / 4), span / 2), min=step / 4, max=span / 2)
        p[f'p{i}_amplitude'].set(h * sig * 2.5, min=0)
        pars.update(p)
        model = model + mod
    # Monte Carlo runs: bounded effort per run (an unconverged run just scores a lower R²)
    res = model.fit(y, pars, x=x, max_nfev=None if starts is None else 100 * (len(pars) + 1))
    comps = res.eval_components(x=x)
    ss_tot = float(((y - y.mean()) ** 2).sum()) or 1.0
    r2 = 1 - float((res.residual ** 2).sum()) / ss_tot
    table = []
    for i in range(len(centers)):
        v = res.params
        table.append(dict(center=v[f'p{i}_center'].value, height=v[f'p{i}_height'].value,
                          fwhm=v[f'p{i}_fwhm'].value, area=v[f'p{i}_amplitude'].value, r2=r2))
    return dict(x=x.tolist(), fit=res.best_fit.tolist(), residual=(y - res.best_fit).tolist(),
                background=comps['bg_'].tolist() if np.ndim(comps['bg_']) else [float(comps['bg_'])] * len(x),
                components=[(comps[f'p{i}_'] + comps['bg_']).tolist() for i in range(len(centers))],
                table=table, r2=r2, profile=profile)


def _mc_run(job):
    xs, ys, cs, profile, starts, max_shift = job
    try:
        return fit(xs, ys, cs, profile, starts=starts, max_shift=max_shift)
    except Exception:
        return None


def mc_fit(x, y, centers, profile='lorentzian', xmin=None, xmax=None, runs=100, max_shift=5.0, seed=1):
    """Monte Carlo peak deconvolution (after SpecXY, Gies et al. 2024): repeat the fit from random starts
    (centre within +-max_shift, width x0.5-2, height x0.5-1.5) and return every run plus the best fit, so the
    spread of equally good solutions can be seen. Run 0 uses the ordinary start values."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    base = fit(x, y, centers, profile, xmin, xmax, max_shift=max_shift)
    cs = sorted(c for c in centers if base['x'][0] <= c <= base['x'][-1])
    xs, ys = np.asarray(base['x']), np.asarray(base['fit']) + np.asarray(base['residual'])
    step = float(np.median(np.diff(xs)))
    span = xs[-1] - xs[0]
    rng = np.random.default_rng(seed)
    jobs = []
    for _ in range(int(runs) - 1):
        starts = []
        for c in cs:
            gaps = [abs(c - o) for o in cs if o != c]
            sig = min(max(3 * step, span / 50), (min(gaps) / 2 if gaps else span))
            c0 = c + rng.uniform(-max_shift, max_shift)
            h = max(float(np.interp(c0, xs, ys) - ys.min()), 1e-9)
            starts.append((c0, sig * rng.uniform(0.5, 2), h * rng.uniform(0.5, 1.5)))
        jobs.append((xs, ys, cs, profile, starts, max_shift))
    try:  # one fit takes ~0.1-1 s, so spread the runs over the CPU cores
        from concurrent.futures import ProcessPoolExecutor
        with ProcessPoolExecutor(max(1, (os.cpu_count() or 2) // 2)) as ex:  # physical cores
            results = list(ex.map(_mc_run, jobs, chunksize=max(1, len(jobs) // (4 * max(1, (os.cpu_count() or 2) // 2)))))
    except Exception:  # no process pool (e.g. some hosted environments)
        results = [_mc_run(j) for j in jobs]
    out, best = [dict(r2=base['r2'], table=base['table'])], base
    for r in results:
        if r is None:
            continue
        out.append(dict(r2=r['r2'], table=r['table']))
        if r['r2'] > best['r2']:
            best = r
    return dict(best=best, runs=out, centers=cs, max_shift=max_shift)


if __name__ == '__main__':  # self-check
    xs = np.linspace(300, 600, 601)

    def lor(c, h, w):
        return h / (1 + ((xs - c) / (w / 2)) ** 2)

    ys = lor(464, 100, 8) + lor(500, 40, 12) + 5 + np.random.default_rng(0).normal(0, 0.3, xs.size)
    pk = find(xs, ys, prominence=0.1, distance=10)
    assert [round(p['x']) for p in pk] == [464, 500], pk
    r = fit(xs, ys, [p['x'] for p in pk], 'lorentzian')
    t = r['table']
    assert abs(t[0]['center'] - 464) < 0.2 and abs(t[0]['fwhm'] - 8) < 0.5 and abs(t[1]['fwhm'] - 12) < 1, t
    assert r['r2'] > 0.995
    mc = mc_fit(xs, ys, [462, 502], 'lorentzian', runs=20, max_shift=6)
    assert len(mc['runs']) >= 15 and mc['best']['r2'] >= r['r2'] - 1e-6
    cs = [run['table'][0]['center'] for run in mc['runs']]
    assert max(cs) - min(cs) < 1 and all(abs(run['table'][1]['center'] - 502) <= 6 + 1e-9 for run in mc['runs'])
    for prof in ('gaussian', 'voigt'):
        assert fit(xs, ys, [464, 500], prof)['r2'] > 0.9
    print('peaks ok')
