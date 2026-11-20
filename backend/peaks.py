"""Peak finding and Gaussian / Lorentzian / Voigt fitting.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
"""
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


def fit(x, y, centers, profile='lorentzian', xmin=None, xmax=None):
    """Fit one profile per centre plus a linear background over [xmin, xmax]."""
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
        p = mod.make_params()
        p[f'p{i}_center'].set(c, min=c - max(3 * sig, 5 * step), max=c + max(3 * sig, 5 * step))
        p[f'p{i}_sigma'].set(sig, min=step / 4, max=span / 2)
        p[f'p{i}_amplitude'].set(h * sig * 2.5, min=0)
        pars.update(p)
        model = model + mod
    res = model.fit(y, pars, x=x)
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
    for prof in ('gaussian', 'voigt'):
        assert fit(xs, ys, [464, 500], prof)['r2'] > 0.9
    print('peaks ok')
