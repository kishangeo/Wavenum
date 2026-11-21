"""Wavenum reference-library storage: one <id>.json (+ <id>.npy for spectra) per library.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

Spectral libraries (raman, ftir) are resampled onto a fixed per-technique grid and
stored as a uint8 matrix (each row scaled to its own max). XRD libraries store
peak lists only (2-theta for Cu K-alpha, relative intensity).
"""
import json
import re
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks

LIB_DIR = Path(__file__).resolve().parent.parent / 'databases' / 'library'

# technique -> (start, stop, step) of the common grid
GRIDS = {'raman': (50.0, 4000.0, 2.0), 'ftir': (400.0, 4000.0, 2.0)}


def grid(technique):
    a, b, s = GRIDS[technique]
    return np.arange(a, b + s / 2, s)


def to_grid(x, y, technique):
    """Resample one spectrum onto the technique grid. Returns (row uint8, lo, hi) or None."""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    ok = np.isfinite(x) & np.isfinite(y)
    x, y = x[ok], y[ok]
    if len(x) < 10:
        return None
    o = np.argsort(x)
    x, y = x[o], y[o]
    g = grid(technique)
    inside = (g >= x[0]) & (g <= x[-1])
    if inside.sum() < 20:
        return None
    v = np.zeros(len(g))
    v[inside] = np.interp(g[inside], x, y)
    v[inside] -= v[inside].min()
    m = v.max()
    if m <= 0:
        return None
    return np.round(v / m * 255).astype(np.uint8), float(g[inside][0]), float(g[inside][-1])


def top_peaks(row, technique, n=15):
    """[[position, relative intensity 0-100], ...] for the strongest peaks of a grid row."""
    y = row.astype(float) / 255
    idx, pr = find_peaks(y, prominence=0.03, distance=3)
    keep = np.argsort(pr['prominences'])[::-1][:n]
    g = grid(technique)
    return sorted([[float(g[idx[k]]), round(float(y[idx[k]]) * 100, 1)] for k in keep])


def save_spectra(lib_id, title, technique, citation, items):
    """items: iterable of dict(name, x, y, formula?, system?, info?)."""
    rows, entries = [], []
    for it in items:
        r = to_grid(it['x'], it['y'], technique)
        if r is None:
            continue
        row, lo, hi = r
        rows.append(row)
        entries.append(dict(name=it['name'], formula=it.get('formula', ''), system=it.get('system', ''),
                            info=it.get('info', ''), lo=lo, hi=hi, peaks=top_peaks(row, technique)))
    if not rows:
        return 0
    LIB_DIR.mkdir(parents=True, exist_ok=True)
    np.save(LIB_DIR / f'{lib_id}.npy', np.vstack(rows))
    meta = dict(id=lib_id, title=title, technique=technique, citation=citation, kind='spectra', entries=entries)
    (LIB_DIR / f'{lib_id}.json').write_text(json.dumps(meta), encoding='utf-8')
    return len(rows)


def save_peaks(lib_id, title, technique, citation, entries):
    """entries: list of dict(name, formula, system, info, peaks=[[pos, I], ...])."""
    LIB_DIR.mkdir(parents=True, exist_ok=True)
    meta = dict(id=lib_id, title=title, technique=technique, citation=citation, kind='peaks', entries=entries)
    (LIB_DIR / f'{lib_id}.json').write_text(json.dumps(meta), encoding='utf-8')
    return len(entries)


_cache = {}


def load(lib_id):
    """Returns (meta, matrix or None), cached by file mtime."""
    p = LIB_DIR / f'{lib_id}.json'
    mt = p.stat().st_mtime
    if lib_id not in _cache or _cache[lib_id][0] != mt:
        meta = json.loads(p.read_text(encoding='utf-8'))
        npy = LIB_DIR / f'{lib_id}.npy'
        _cache[lib_id] = (mt, meta, np.load(npy) if npy.exists() else None)
    return _cache[lib_id][1], _cache[lib_id][2]


def list_libraries():
    out = []
    for p in sorted(LIB_DIR.glob('[!_]*.json')):
        # read only the header cheaply: load() caches, and the files are local
        meta, _ = load(p.stem)
        out.append(dict(id=meta['id'], title=meta['title'], technique=meta['technique'],
                        kind=meta['kind'], citation=meta['citation'], n=len(meta['entries'])))
    return out


def stats():
    """Reference data per technique: spectra, libraries and distinct phase names (shown in the interface)."""
    out = {}
    for lib in list_libraries():
        t = out.setdefault(lib['technique'], dict(spectra=0, libraries=0, phases=set()))
        t['spectra'] += lib['n']
        t['libraries'] += 1
        t['phases'].update(e['name'].strip().lower() for e in load(lib['id'])[0]['entries'])
    return {k: dict(v, phases=len(v['phases'])) for k, v in out.items()}


def search(q, technique, limit=60):
    """Entries whose name or formula contains q (case-insensitive)."""
    q = q.strip().lower()
    out = []
    if not q:
        return out
    for lib in list_libraries():
        if lib['technique'] != technique:
            continue
        meta, _ = load(lib['id'])
        for k, e in enumerate(meta['entries']):
            if q in e['name'].lower() or q in e['formula'].lower().replace(' ', ''):
                out.append(dict(lib=lib['id'], k=k, name=e['name'], formula=e['formula'], system=e['system'],
                                info=e['info'], library=lib['title']))
    out.sort(key=lambda r: (not r['name'].lower().startswith(q), r['name'].lower()))
    return out[:limit]


def entry(lib_id, k):
    """One reference as a plottable spectrum: dict(name, x, y)."""
    meta, M = load(lib_id)
    e = meta['entries'][k]
    if meta['kind'] == 'spectra':
        g = grid(meta['technique'])
        m = (g >= e['lo']) & (g <= e['hi'])
        return dict(name=e['name'], x=g[m].tolist(), y=(M[k][m] / 255).round(4).tolist())
    p = np.array(e['peaks'], float).reshape(-1, 2)  # XRD sticks -> profile
    x = np.arange(4, 90, 0.02)
    y = (p[:, 1, None] * np.exp(-0.5 * ((x[None, :] - p[:, 0, None]) / 0.06) ** 2)).sum(0)
    return dict(name=e['name'], x=x.round(3).tolist(), y=y.round(3).tolist())


# ---------- RRUFF .txt folder import (user libraries) ----------

def read_rruff_txt(path):
    """RRUFF text file: '##KEY=value' header lines then 'x, y' rows."""
    hdr, xs, ys = {}, [], []
    for line in Path(path).read_text(encoding='latin-1').splitlines():
        if line.startswith('##'):
            k, _, v = line[2:].partition('=')
            hdr[k.strip().upper()] = v.strip()
            continue
        parts = re.split(r'[,\s;]+', line.strip())
        if len(parts) >= 2:
            try:
                xs.append(float(parts[0]))
                ys.append(float(parts[1]))
            except ValueError:
                pass
    name = hdr.get('NAMES') or Path(path).stem.split('__')[0]
    formula = re.sub(r'[_^]', '', hdr.get('IDEAL CHEMISTRY', ''))
    return dict(name=name, formula=formula, info=hdr.get('RRUFFID', Path(path).stem), x=xs, y=ys)


def import_folder(folder, technique, title=None):
    folder = Path(folder)
    if not folder.is_dir():
        raise ValueError(f'Not a folder: {folder}')
    files = sorted(folder.rglob('*.txt'))
    if not files:
        raise ValueError('No .txt files found in that folder')
    lib_id = 'user_' + re.sub(r'\W+', '_', folder.name).strip('_').lower()
    n = save_spectra(lib_id, title or f'{folder.name} (imported)', technique,
                     f'Imported from {folder}', (read_rruff_txt(f) for f in files))
    return dict(id=lib_id, n=n)
