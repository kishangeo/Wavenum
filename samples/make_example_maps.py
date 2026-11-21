"""Generate the synthetic example maps in samples/examples (Raman map + matching element maps).

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
A 40 x 30 pixel area (2 um steps): a quartz grain with a hematite inclusion in a calcite matrix,
with a fluorescence background that varies across the area, and Poisson-like noise.
"""
from pathlib import Path

import numpy as np

out = Path(__file__).resolve().parent / 'examples'
rng = np.random.default_rng(7)
nx, ny, step = 40, 30, 2.0
xs, ys = np.arange(nx) * step, np.arange(ny) * step
shift = np.arange(100, 1301, 4.0)


def lor(c, h, w):
    return h / (1 + ((shift - c) / (w / 2)) ** 2)


quartz = lor(128, 35, 8) + lor(206, 30, 14) + lor(264, 8, 10) + lor(355, 10, 10) + lor(464, 100, 8) + lor(808, 6, 12) + lor(1160, 5, 12)
calcite = lor(156, 20, 10) + lor(282, 35, 11) + lor(713, 14, 6) + lor(1086, 100, 5)
hematite = lor(226, 60, 9) + lor(245, 10, 9) + lor(292, 100, 14) + lor(411, 45, 18) + lor(498, 10, 18) + lor(612, 22, 24) + lor(1320, 40, 60)

X, Y = np.meshgrid(xs, ys)  # rows = Y from the bottom
q = 1 / (1 + np.exp((np.hypot((X - 30) / 1.3, Y - 32) - 17) / 1.2))        # quartz grain (soft edge)
h = 1 / (1 + np.exp((np.hypot(X - 52, Y - 24) - 4.5) / 0.8))               # hematite inclusion in the grain
q = q * (1 - h)
c = np.clip(1 - q - h, 0, 1)                                              # calcite matrix

rows = []
for iy in range(ny):
    for ix in range(nx):
        fl = 40 + 0.6 * X[iy, ix] + 0.3 * Y[iy, ix] + 25 * np.exp(-((shift - 900) / 700) ** 2)
        sig = 400 * q[iy, ix] * quartz + 350 * c[iy, ix] * calcite + 300 * h[iy, ix] * hematite + fl
        sig = sig + rng.normal(0, np.sqrt(np.maximum(sig, 1)) * 0.6)
        rows.append([xs[ix], ys[iy], *sig])
head = '\t'.join(['X (um)', 'Y (um)'] + [f'{v:.0f}' for v in shift])
with open(out / 'raman_map_quartz_calcite.txt', 'w', newline='\n') as f:
    f.write('# Wavenum example map: synthetic Raman map, 40 x 30 pixels, 2 um steps. Columns: X, Y, then one column per Raman shift (cm-1).\n')
    f.write(head + '\n')
    for r in rows:
        f.write(f'{r[0]:.0f}\t{r[1]:.0f}\t' + '\t'.join(f'{v:.0f}' for v in r[2:]) + '\n')

# element maps (wt% oxide), like EPMA / EDS exports: rows from the top of the image
si = 99.5 * q + 0.3 * c + 0.5 * h + rng.normal(0, 0.6, q.shape)
ca = 55.8 * c + 0.1 * q + rng.normal(0, 0.5, q.shape)
fe = 98 * h + 0.2 * (q + c) + rng.normal(0, 0.4, q.shape)
for name, v in (('SiO2', si), ('CaO', ca), ('Fe2O3', fe)):
    np.savetxt(out / f'element_map_{name}.csv', np.clip(v, 0, None)[::-1], delimiter=',', fmt='%.2f')
print('written', sorted(p.name for p in out.glob('*map*')))
