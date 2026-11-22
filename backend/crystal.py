"""CIF reading and powder X-ray diffraction patterns without pymatgen.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

Port of wavenum-core/src/crystal.rs, which follows pymatgen's CifParser (symmetry expansion, site
merging, occupancy rules) and XRDCalculator (tabulated atomic scattering factors, Lorentz-polarisation
factor, peaks merged within 1e-5 degrees, scaled to 100). The scattering-factor table
(wavenum-core/src/data/atomic_scattering_params.json) is from pymatgen (MIT licence, (c) Materials
Virtual Lab). Used where pymatgen is not installed (e.g. the hosted website).
"""
import json
import math
from pathlib import Path

import numpy as np

ELEMENTS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr '
            'Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt '
            'Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc '
            'Lv Ts Og').split()
Z = {e: i + 1 for i, e in enumerate(ELEMENTS)} | {'D': 1, 'T': 1}
_SCAT = None
SITE_TOL = 1e-4


def _scattering():
    global _SCAT
    if _SCAT is None:
        here = Path(__file__).resolve().parent
        for p in (here / 'atomic_scattering_params.json', here.parent / 'wavenum-core' / 'src' / 'data' / 'atomic_scattering_params.json'):
            if p.exists():
                _SCAT = json.loads(p.read_text(encoding='utf-8'))
                break
        else:
            raise ValueError('atomic scattering table not found')
    return _SCAT


# ---------------------------------------------------------------- minimal CIF reader

def _tokenize(text):
    out, lines, i = [], text.splitlines(), 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if line.startswith(';'):  # semicolon text field
            s = [line[1:]]
            while i < len(lines) and not lines[i].startswith(';'):
                s.append(lines[i])
                i += 1
            i += 1
            out.append('\n'.join(s).strip())
            continue
        j, n = 0, len(line)
        while j < n:
            c = line[j]
            if c.isspace():
                j += 1
            elif c == '#':
                break
            elif c in '\'"':
                k = j + 1
                while k < n and not (line[k] == c and (k + 1 == n or line[k + 1].isspace())):
                    k += 1
                out.append(line[j + 1:k])
                j = k + 1
            else:
                k = j
                while k < n and not line[k].isspace():
                    k += 1
                out.append(line[j:k])
                j = k
    return out


def parse_cif(text):
    """First data block: (items dict, loops [(tags, rows)]), tags lower-case."""
    tok, items, loops, i, started = _tokenize(text), {}, [], 0, False
    while i < len(tok):
        t, low = tok[i], tok[i].lower()
        if low.startswith('data_'):
            if started:
                break
            started = True
            i += 1
        elif low == 'loop_':
            i += 1
            tags = []
            while i < len(tok) and tok[i].startswith('_'):
                tags.append(tok[i].lower())
                i += 1
            vals = []
            while i < len(tok) and not tok[i].startswith('_') and tok[i].lower() != 'loop_' and not tok[i].lower().startswith('data_'):
                vals.append(tok[i])
                i += 1
            if tags:
                loops.append((tags, [vals[k:k + len(tags)] for k in range(0, len(vals) - len(tags) + 1, len(tags))]))
        elif t.startswith('_'):
            items[low] = tok[i + 1] if i + 1 < len(tok) else ''
            i += 2
        else:
            i += 1
    if not started and not items:
        raise ValueError('Not a CIF file')
    return items, loops


def _column(items, loops, tag):
    for tags, rows in loops:
        if tag in tags:
            k = tags.index(tag)
            return [r[k] if k < len(r) else '' for r in rows]
    return [items[tag]] if tag in items else None


def cif_num(s):
    s = (s or '').split('(')[0].strip()
    if s in ('', '?', '.'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_symbol(sym):
    """pymatgen CifParser._parse_symbol"""
    for k, v in (('Hw', 'H'), ('Ow', 'O'), ('Wat', 'O'), ('wat', 'O'), ('OH2', ''), ('OH', ''), ('NO3', 'N')):
        if sym.startswith(k):
            return v
    if len(sym) >= 2 and sym[:2].title() in Z:
        return sym[:2].title()
    if sym[:1].upper() in Z:
        return sym[:1].upper()
    w = ''
    for ch in sym.lstrip('w'):
        if not ch.isascii() or not ch.isalpha():
            break
        w += ch
    return w if w[:1].isupper() else None


def _implicit_h(sym):
    return 2.0 if sym.startswith(('Wat', 'wat')) else 1.0 if sym.startswith('O-H') else 0.0


def _parse_op(s):
    """'-x+1/2, y, -z+1/2' -> (3x3 rotation, translation)."""
    s = ''.join(c for c in s if not c.isspace() and c != "'").lower()
    parts = s.split(',')
    if len(parts) != 3:
        return None
    rot, tr = np.zeros((3, 3)), np.zeros(3)
    for r, p in enumerate(parts):
        sign, num = 1.0, ''

        def flush():
            nonlocal num
            if num:
                a, _, b = num.partition('/')
                tr[r] += sign * (float(a) / float(b) if b else float(a))
                num = ''
        try:
            for c in p:
                if c in '+-':
                    flush()
                    sign = -1.0 if c == '-' else 1.0
                elif c in 'xyz':
                    coef = float(num) if num else 1.0
                    num = ''
                    rot[r, 'xyz'.index(c)] += sign * coef
                    sign = 1.0
                elif c != '*':
                    num += c
            flush()
        except ValueError:
            return None
    return rot, tr


def _pbc_match(a, b, tol=SITE_TOL):
    d = np.asarray(a) - np.asarray(b)
    return bool(np.all(np.abs(d - np.round(d)) < tol))


def _system_from_number(n):
    for hi, name in ((2, 'triclinic'), (15, 'monoclinic'), (74, 'orthorhombic'), (142, 'tetragonal'),
                     (167, 'trigonal'), (194, 'hexagonal'), (230, 'cubic')):
        if 1 <= n <= hi:
            return name
    return ''


def crystal_from_cif(text):
    """dict(mineral, formula, system, cell [a b c alpha beta gamma], sites [(frac xyz, [(element, occupancy)])])"""
    items, loops = parse_cif(text)
    g = lambda t: cif_num(items.get(t))  # noqa: E731
    cell = [g(t) for t in ('_cell_length_a', '_cell_length_b', '_cell_length_c', '_cell_angle_alpha', '_cell_angle_beta', '_cell_angle_gamma')]
    if any(v is None for v in cell):
        raise ValueError('Cannot determine lattice: missing or incomplete _cell_length/_cell_angle data')
    ops = []
    for tag in ('_symmetry_equiv_pos_as_xyz', '_space_group_symop_operation_xyz', '_symmetry_equiv_pos_as_xyz_', '_space_group_symop_operation_xyz_'):
        col = _column(items, loops, tag)
        if col:
            ops = [o for o in map(_parse_op, col) if o]
            if ops:
                break
    ops = ops or [(np.eye(3), np.zeros(3))]
    labels = _column(items, loops, '_atom_site_label')
    if not labels:
        raise ValueError('CIF has no atom sites')
    types, occ = _column(items, loops, '_atom_site_type_symbol'), _column(items, loops, '_atom_site_occupancy')
    fx, fy, fz = (_column(items, loops, f'_atom_site_fract_{a}') for a in 'xyz')
    if not (fx and fy and fz):
        raise ValueError('CIF has no fractional coordinates')
    asym = []  # [coord, {element: occupancy}] with symmetry-equivalent entries merged
    for i, label in enumerate(labels):
        raw = types[i] if types and i < len(types) and types[i] not in ('', '?', '.') else label
        sym = _parse_symbol(raw)
        if not sym:
            continue
        o = cif_num(occ[i]) if occ and i < len(occ) else None
        o = 1.0 if o is None else o
        if o <= 0:
            continue  # pymatgen skips unoccupied sites
        xyz = [cif_num(c[i]) if i < len(c) else None for c in (fx, fy, fz)]
        if None in xyz:
            raise ValueError(f'Site {label} has no numeric coordinates')
        comp = {sym: max(o, 1e-8)}
        h = _implicit_h(raw)
        if h:
            comp['H'] = comp.get('H', 0) + h
        match = next((k for rot, tr in ops for k, (c, _) in enumerate(asym) if _pbc_match(rot @ xyz + tr, c)), None)
        if match is None:
            asym.append([np.array(xyz), comp])
        else:
            for s, v in comp.items():
                asym[match][1][s] = asym[match][1].get(s, 0) + v
    for _, comp in asym:  # O with implicit hydrogens scatters as O (the hydrogens are not placed)
        if len(comp) == 2 and 'O' in comp and 'H' in comp:
            del comp['H']
    groups = {}
    for c, comp in asym:
        key = ','.join(sorted(f'{s}:{o:.10f}' for s, o in comp.items()))
        groups.setdefault(key, (comp, []))[1].append(c)
    sites = []
    for comp, coords in groups.values():
        total = sum(comp.values())
        species = [(s, o / total if total > 1 else o) for s, o in comp.items()]
        kept = []
        for c in coords:
            for rot, tr in ops:
                img = rot @ c + tr
                img = img - np.floor(img)
                if not any(_pbc_match(img, k) for k in kept):
                    kept.append(img)
        sites += [(k, species) for k in kept]
    if not sites:
        raise ValueError('CIF structure has no sites')
    unq = lambda s: (s or '').strip('\'"').strip()  # noqa: E731
    system = unq(items.get('_space_group_crystal_system') or items.get('_symmetry_cell_setting')).lower()
    if system in ('', '?'):
        n = cif_num(items.get('_space_group_it_number') or items.get('_symmetry_int_tables_number')) or 0
        system = _system_from_number(int(n))
    system = 'trigonal' if system == 'rhombohedral' else system
    return dict(mineral=' '.join(unq(items.get('_chemical_name_mineral')).split()),
                formula=' '.join(unq(items.get('_chemical_formula_sum')).split()), system=system, cell=cell, sites=sites)


# ---------------------------------------------------------------- powder pattern

def _lattice_matrix(c):
    a, b, cc = c[:3]
    al, be, ga = (math.radians(v) for v in c[3:])
    gs = math.acos(max(-1.0, min(1.0, (math.cos(al) * math.cos(be) - math.cos(ga)) / (math.sin(al) * math.sin(be)))))
    return np.array([[a * math.sin(be), 0, a * math.cos(be)], [-b * math.sin(al) * math.cos(gs), b * math.sin(al) * math.sin(gs), b * math.cos(al)], [0, 0, cc]])


def xrd_pattern(cr, wavelength=1.54184, tt_min=4.0, tt_max=90.0):
    """[(two_theta, intensity scaled to 100)] sorted by angle, like pymatgen's XRDCalculator."""
    table = _scattering()
    m = _lattice_matrix(cr['cell'])
    rl = np.linalg.inv(m).T  # crystallographic reciprocal lattice (rows)
    min_r, max_r = (math.sin(math.radians(t / 2)) * 2 / wavelength for t in (tt_min, tt_max))
    nmax = [int(math.floor(max_r * np.linalg.norm(m[i]))) + 1 for i in range(3)]
    groups = {}
    for frac, species in cr['sites']:
        for s, o in species:
            if s not in table:
                raise ValueError(f'Unable to calculate XRD pattern as there is no scattering coefficients for {s}.')
            groups.setdefault(s, []).append((frac, o))
    grp = [(Z.get(s, 0), np.array(table[s]), np.array([f for f, _ in v]), np.array([o for _, o in v])) for s, v in groups.items()]
    h, k, l = np.meshgrid(*(np.arange(-n, n + 1) for n in nmax), indexing='ij')
    hkl = np.stack([h.ravel(), k.ravel(), l.ravel()], 1)
    hkl = hkl[(hkl[:, 0] > 0) | ((hkl[:, 0] == 0) & (hkl[:, 1] > 0)) | ((hkl[:, 0] == 0) & (hkl[:, 1] == 0) & (hkl[:, 2] > 0))]
    gl = np.linalg.norm(hkl @ rl, axis=1)
    keep = (gl <= max_r + 1e-8) & (gl >= min_r)
    hkl, gl = hkl[keep], gl[keep]
    order = np.lexsort((-hkl[:, 2], -hkl[:, 1], -hkl[:, 0], gl))  # Rust/pymatgen order: by |g|, then -h, -k, -l
    hkl, gl = hkl[order], gl[order]
    s2 = (gl / 2) ** 2
    f = np.zeros(len(gl), complex)
    for z, coeff, fr, occ in grp:
        fs = z - 41.78214 * s2 * (coeff[:, 0][None, :] * np.exp(-coeff[:, 1][None, :] * s2[:, None])).sum(1)
        f += fs * (occ[None, :] * np.exp(2j * np.pi * (hkl @ fr.T))).sum(1)
    theta = np.arcsin(np.clip(wavelength * gl / 2, -1, 1))
    inten = 2 * np.abs(f) ** 2 * (1 + np.cos(2 * theta) ** 2) / (np.sin(theta) ** 2 * np.cos(theta))
    tt = np.degrees(2 * theta)
    peaks = {}
    for b, i, t in zip(np.round(tt / 1e-5).astype(np.int64), inten, tt):
        if b in peaks:
            peaks[b][0] += i
        else:
            peaks[b] = [i, t]
    if not peaks:
        return []
    mx = max(v[0] for v in peaks.values())
    if mx <= 0:
        return []
    return [(t, i / mx * 100) for _, (i, t) in sorted(peaks.items()) if i / mx * 100 > 1e-3]


def cif_profile(text, wavelength=1.54184):
    """A CIF file as a continuous Cu K-alpha profile on 4-90 degrees two-theta."""
    pat = xrd_pattern(crystal_from_cif(text), wavelength)
    x = np.arange(4, 90, 0.02)
    if not pat:
        return x, np.zeros_like(x)
    c, i = np.array(pat).T
    return x, (i[:, None] * np.exp(-0.5 * ((x[None, :] - c[:, None]) / 0.06) ** 2)).sum(0)


if __name__ == '__main__':  # self-check: halite, the same case as the Rust test
    NACL = ('data_halite\n_cell_length_a 5.6402(3)\n_cell_length_b 5.6402\n_cell_length_c 5.6402\n_cell_angle_alpha 90\n'
            '_cell_angle_beta 90\n_cell_angle_gamma 90\n_symmetry_Int_Tables_number 225\nloop_\n_symmetry_equiv_pos_as_xyz\n'
            'x,y,z\nx,1/2+y,1/2+z\n1/2+x,y,1/2+z\n1/2+x,1/2+y,z\nloop_\n_atom_site_label\n_atom_site_fract_x\n'
            '_atom_site_fract_y\n_atom_site_fract_z\nNa 0 0 0\nCl 0.5 0.5 0.5\n')
    c = crystal_from_cif(NACL)
    assert len(c['sites']) == 8 and c['system'] == 'cubic'
    p = xrd_pattern(c, 1.5406)
    best = max(p, key=lambda q: q[1])
    assert abs(best[0] - 31.70) < 0.02, best
    assert any(abs(q[0] - 27.36) < 0.03 and q[1] < 20 for q in p)
    print('crystal ok')
