"""Chemometrics on the loaded spectra: PCA scores/loadings and k-means grouping.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
"""
import numpy as np
from scipy.cluster.vq import kmeans2


def pca(spectra, clusters=0, norm='snv'):
    """spectra: list of dict(x, y). All are interpolated onto their common x range first."""
    if len(spectra) < 3:
        raise ValueError('PCA needs at least 3 spectra')
    xs = [np.asarray(s['x'], float) for s in spectra]
    lo, hi = max(x.min() for x in xs), min(x.max() for x in xs)
    if hi <= lo:
        raise ValueError('The spectra have no common x range')
    step = float(np.median(np.abs(np.diff(xs[0])))) or 1.0
    g = np.linspace(lo, hi, int(min(4000, max(50, (hi - lo) / step))))
    rows = []
    for s, x in zip(spectra, xs):
        o = np.argsort(x)
        rows.append(np.interp(g, x[o], np.asarray(s['y'], float)[o]))
    A = np.array(rows)
    if norm == 'snv':
        A = (A - A.mean(1, keepdims=True)) / (A.std(1, keepdims=True) + 1e-12)
    elif norm == 'vector':
        A = A / (np.linalg.norm(A, axis=1, keepdims=True) + 1e-12)
    A = A - A.mean(0)
    U, S, Vt = np.linalg.svd(A, full_matrices=False)
    k = min(3, len(S))
    scores = U[:, :k] * S[:k]
    var = S ** 2 / ((S ** 2).sum() or 1.0)
    labels = None
    if 1 < clusters <= len(spectra):
        labels = kmeans2(scores, clusters, minit='++', seed=0)[1].tolist()
    return dict(scores=scores.tolist(), explained=var[:k].tolist(), x=g.tolist(),
                loadings=Vt[:k].tolist(), clusters=labels)


if __name__ == '__main__':  # self-check: two obvious groups separate on PC1
    x = np.linspace(100, 1000, 500)
    rng = np.random.default_rng(0)
    a = [dict(x=x, y=np.exp(-((x - 300) / 10) ** 2) + rng.normal(0, 0.01, 500)) for _ in range(4)]
    b = [dict(x=x, y=np.exp(-((x - 700) / 10) ** 2) + rng.normal(0, 0.01, 500)) for _ in range(4)]
    r = pca(a + b, clusters=2)
    pc1 = np.array(r['scores'])[:, 0]
    assert (pc1[:4] > 0).all() != (pc1[4:] > 0).all() and r['explained'][0] > 0.9
    assert len(set(r['clusters'][:4])) == 1 and r['clusters'][0] != r['clusters'][4]
    print('analysis ok')
