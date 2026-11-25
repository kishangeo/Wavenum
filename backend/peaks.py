"""Peak finding and Gaussian / Lorentzian / Voigt fitting.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
"""

import time

import numpy as np
from lmfit.models import GaussianModel, LinearModel, LorentzianModel, VoigtModel
from scipy.optimize import leastsq
from scipy.signal import find_peaks, peak_widths
from scipy.special import wofz

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


def _shape(profile, x, c, s, a):
    """lmfit's Gaussian / Lorentzian / Voigt (gamma = sigma) with amplitude = area."""
    if profile == 'gaussian':
        return a / (s * np.sqrt(2 * np.pi)) * np.exp(-((x - c) ** 2) / (2 * s * s))
    if profile == 'lorentzian':
        return a / np.pi * s / ((x - c) ** 2 + s * s)
    return a * wofz((x - c + 1j * s) / (s * np.sqrt(2))).real / (s * np.sqrt(2 * np.pi))


def _height_fwhm(profile, s, a):
    if profile == 'gaussian':
        return a / (s * np.sqrt(2 * np.pi)), 2.3548200 * s
    if profile == 'lorentzian':
        return a / (np.pi * s), 2 * s
    return a * wofz(1j / np.sqrt(2)).real / (s * np.sqrt(2 * np.pi)), 1.0692 * s + np.sqrt(0.8664 * s * s + 5.545083 * s * s)


def _mc_run(job):
    """One Monte Carlo run, the same model and bounds as fit() but straight on scipy: lmfit's per-call
    overhead was ~95% of the time of these many small fits."""
    xs, ys, cs, profile, starts, max_shift = job
    try:
        n = len(cs)
        step = float(np.median(np.diff(xs)))
        span = xs[-1] - xs[0]
        lo, hi, p0 = [-np.inf, -np.inf], [np.inf, np.inf], [0.0, float(ys.min())]
        for c, (c0, sig, h) in zip(cs, starts):
            sig = min(max(sig, step / 4), span / 2)
            lo += [c - max_shift, step / 4, 0]
            hi += [c + max_shift, span / 2, np.inf]
            p0 += [min(max(c0, c - max_shift), c + max_shift), sig, h * sig * 2.5]

        def model(p):
            return p[0] * xs + p[1] + sum(_shape(profile, xs, *p[2 + 3 * i:5 + 3 * i]) for i in range(n))

        def jac(p):  # exact derivatives: one model call per step instead of ~30
            J = np.empty((len(xs), len(p)))
            J[:, 0], J[:, 1] = xs, 1
            for i in range(n):
                c, sg, a = p[2 + 3 * i:5 + 3 * i]
                d = xs - c
                if profile == 'gaussian':
                    g = np.exp(-d * d / (2 * sg * sg)) / (sg * np.sqrt(2 * np.pi))
                    J[:, 2 + 3 * i], J[:, 3 + 3 * i], J[:, 4 + 3 * i] = a * g * d / sg ** 2, a * g * (d * d / sg ** 3 - 1 / sg), g
                elif profile == 'voigt':  # w'(z) = -2 z w(z) + 2i / sqrt(pi)
                    z = (d + 1j * sg) / (sg * np.sqrt(2))
                    w = wofz(z)
                    dw = -2 * z * w + 2j / np.sqrt(np.pi)
                    k = 1 / (sg * np.sqrt(2 * np.pi))
                    J[:, 2 + 3 * i] = a * k * (dw * (-1 / (sg * np.sqrt(2)))).real
                    J[:, 3 + 3 * i] = a * k * ((dw * (-d / (sg * sg * np.sqrt(2)))).real - w.real / sg)
                    J[:, 4 + 3 * i] = k * w.real
                else:
                    D = d * d + sg * sg
                    J[:, 2 + 3 * i], J[:, 3 + 3 * i], J[:, 4 + 3 * i] = a / np.pi * sg * 2 * d / D ** 2, a / np.pi * (d * d - sg * sg) / D ** 2, sg / (np.pi * D)
            return J

        # lmfit's method: Levenberg-Marquardt on unbounded variables u, bounds by the MINUIT transforms
        # (lo + (sin u + 1)(hi - lo)/2, or lo - 1 + sqrt(u^2 + 1) for a lower bound only). The trust-region
        # solvers with hard bounds stopped in poorer minima about half the time.
        lo, hi = np.array(lo), np.array(hi)
        two, one = np.isfinite(lo) & np.isfinite(hi), np.isfinite(lo) & ~np.isfinite(hi)

        def par(u):
            q = u.copy()
            q[two] = lo[two] + (np.sin(u[two]) + 1) * (hi[two] - lo[two]) / 2
            q[one] = lo[one] - 1 + np.sqrt(u[one] ** 2 + 1)
            return q

        def dpar(u):
            g = np.ones_like(u)
            g[two] = np.cos(u[two]) * (hi[two] - lo[two]) / 2
            g[one] = u[one] / np.sqrt(u[one] ** 2 + 1)
            return g

        q0 = np.array(p0, float)
        u0 = q0.copy()
        u0[two] = np.arcsin(np.clip(2 * (q0[two] - lo[two]) / (hi[two] - lo[two]) - 1, -1, 1))
        u0[one] = np.sqrt(np.maximum(q0[one] - lo[one] + 1, 1) ** 2 - 1)
        u = leastsq(lambda u: model(par(u)) - ys, u0, Dfun=lambda u: jac(par(u)) * dpar(u),
                    maxfev=100 * (len(p0) + 1), full_output=True)[0]  # full_output: no warning at maxfev
        p = par(u)
        best = model(p)
        ss_tot = float(((ys - ys.mean()) ** 2).sum()) or 1.0
        r2 = 1 - float(((ys - best) ** 2).sum()) / ss_tot
        table = []
        for i in range(n):
            c, sg, a = p[2 + 3 * i:5 + 3 * i]
            h, fw = _height_fwhm(profile, sg, a)
            table.append(dict(center=float(c), height=float(h), fwhm=float(fw), area=float(a), r2=r2))
        bg = p[0] * xs + p[1]
        return dict(x=xs.tolist(), fit=best.tolist(), residual=(ys - best).tolist(), background=bg.tolist(),
                    components=[(_shape(profile, xs, *p[2 + 3 * i:5 + 3 * i]) + bg).tolist() for i in range(n)],
                    table=table, r2=r2, profile=profile)
    except Exception:
        return None


def mc_fit(x, y, centers, profile='lorentzian', xmin=None, xmax=None, runs=100, max_shift=5.0, seed=1, base=True, budget=None):
    """Monte Carlo peak deconvolution (after SpecXY, Gies et al. 2024): repeat the fit from random starts
    (centre within +-max_shift, width x0.5-2, height x0.5-1.5) and return every run plus the best fit, so the
    spread of equally good solutions can be seen. Run 0 uses the ordinary start values; base=False skips it
    (later batches of a run split over several requests). budget: stop starting new runs after this many
    seconds and return the runs done so far (the website's requests have a time limit)."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    m = (x >= (xmin if xmin is not None else -np.inf)) & (x <= (xmax if xmax is not None else np.inf))
    xs, ys = x[m], y[m]
    first = fit(xs, ys, centers, profile, max_shift=max_shift) if base else None
    cs = sorted(c for c in centers if len(xs) and xs[0] <= c <= xs[-1])
    if not cs:
        raise ValueError('No peaks inside the fit range')
    step = float(np.median(np.diff(xs)))
    span = xs[-1] - xs[0]
    rng = np.random.default_rng(seed)
    jobs = []
    for _ in range(int(runs) - (1 if base else 0)):
        starts = []
        for c in cs:
            gaps = [abs(c - o) for o in cs if o != c]
            sig = min(max(3 * step, span / 50), (min(gaps) / 2 if gaps else span))
            c0 = c + rng.uniform(-max_shift, max_shift)
            h = max(float(np.interp(c0, xs, ys) - ys.min()), 1e-9)
            starts.append((c0, sig * rng.uniform(0.5, 2), h * rng.uniform(0.5, 1.5)))
        jobs.append((xs, ys, cs, profile, starts, max_shift))
    t0 = time.monotonic()
    results = []
    for j in jobs:  # ~0.1-3 s each; worker processes cost more than they save
        if budget and results and time.monotonic() - t0 > budget:
            break
        results.append(_mc_run(j))
    out = [dict(r2=first['r2'], table=first['table'])] if first else []
    best = first
    for r in results:
        if r is None:
            continue
        out.append(dict(r2=r['r2'], table=r['table']))
        if best is None or r['r2'] > best['r2']:
            best = r
    if best is None:
        raise ValueError('No Monte Carlo run converged')
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
    nb = mc_fit(xs, ys, [462, 502], 'lorentzian', runs=5, max_shift=6, seed=2, base=False)
    assert len(nb['runs']) == 5 and nb['best']['r2'] > 0.99
    print('peaks ok')
    # fast Monte Carlo path converges for every profile
    for prof in ('gaussian', 'lorentzian', 'voigt'):
        r = _mc_run((xs, ys, [464.0, 500.0], prof, [(463.0, 4.0, 90.0), (501.0, 6.0, 40.0)], 6))
        assert r and r['r2'] > 0.95, prof
