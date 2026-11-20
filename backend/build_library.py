"""Build Wavenum reference libraries from the raw downloads in databases/raw.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

Usage:  python backend/build_library.py [starter] [sgd] [rod] [cod]   (no args = all)
"""
import json
import re
import sys
import warnings
import zipfile
from multiprocessing import Pool
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import library as L  # noqa: E402
from sgd import read_sgdr  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'databases' / 'raw'
EXTRACT = ROOT / 'databases' / 'extracted'
MINERALS = L.LIB_DIR / '_minerals.json'  # name -> [formula, crystal system], built by `cod`

# ---------------------------------------------------------------- starter
# name, formula, crystal system, [(shift cm-1, relative intensity), ...]
STARTER = [
    ('Quartz', 'SiO2', 'trigonal', [(128, 25), (206, 25), (265, 5), (355, 8), (394, 4), (464, 100), (696, 3), (807, 4), (1082, 3), (1161, 4)]),
    ('Calcite', 'CaCO3', 'trigonal', [(156, 15), (282, 30), (713, 12), (1086, 100), (1436, 4), (1749, 3)]),
    ('Aragonite', 'CaCO3', 'orthorhombic', [(153, 20), (206, 25), (705, 10), (1085, 100), (1462, 3), (1574, 2)]),
    ('Dolomite', 'CaMg(CO3)2', 'trigonal', [(176, 20), (299, 35), (725, 10), (1098, 100), (1443, 4), (1758, 3)]),
    ('Magnesite', 'MgCO3', 'trigonal', [(213, 15), (330, 35), (738, 8), (1094, 100), (1445, 3), (1762, 3)]),
    ('Siderite', 'FeCO3', 'trigonal', [(184, 20), (287, 35), (731, 10), (1088, 100), (1734, 4)]),
    ('Hematite', 'Fe2O3', 'trigonal', [(226, 70), (245, 10), (292, 100), (411, 55), (498, 12), (612, 20), (1320, 45)]),
    ('Magnetite', 'Fe3O4', 'cubic', [(193, 8), (306, 15), (538, 20), (668, 100)]),
    ('Goethite', 'FeO(OH)', 'orthorhombic', [(243, 20), (299, 45), (385, 100), (479, 15), (550, 25), (685, 10)]),
    ('Pyrite', 'FeS2', 'cubic', [(343, 70), (379, 100), (430, 10)]),
    ('Gypsum', 'CaSO4.2H2O', 'monoclinic', [(414, 15), (493, 12), (618, 8), (670, 6), (1008, 100), (1135, 10), (3405, 20), (3494, 15)]),
    ('Anhydrite', 'CaSO4', 'orthorhombic', [(417, 12), (499, 15), (609, 8), (627, 12), (675, 10), (1017, 100), (1110, 6), (1128, 15), (1160, 6)]),
    ('Barite', 'BaSO4', 'orthorhombic', [(453, 20), (462, 25), (617, 10), (647, 6), (988, 100), (1084, 4), (1104, 4), (1140, 8), (1167, 5)]),
    ('Forsterite (Olivine)', 'Mg2SiO4', 'orthorhombic', [(226, 6), (304, 8), (433, 8), (545, 8), (608, 8), (824, 85), (856, 100), (882, 12), (920, 15), (965, 15)]),
    ('Enstatite', 'MgSiO3', 'orthorhombic', [(238, 15), (343, 40), (402, 15), (663, 60), (686, 80), (1012, 100), (1033, 45)]),
    ('Diopside', 'CaMgSi2O6', 'monoclinic', [(140, 15), (325, 30), (359, 15), (392, 35), (667, 90), (856, 10), (1013, 100), (1048, 10)]),
    ('Albite', 'NaAlSi3O8', 'triclinic', [(185, 20), (209, 15), (291, 35), (329, 10), (408, 12), (479, 60), (507, 100), (763, 8), (815, 6), (1098, 10)]),
    ('Orthoclase', 'KAlSi3O8', 'monoclinic', [(157, 30), (197, 15), (283, 30), (455, 25), (475, 50), (513, 100), (749, 8), (1123, 10)]),
    ('Muscovite', 'KAl2(AlSi3O10)(OH)2', 'monoclinic', [(198, 30), (263, 70), (407, 40), (702, 100), (754, 20), (913, 15), (1118, 10), (3627, 60)]),
    ('Biotite', 'K(Mg,Fe)3AlSi3O10(OH)2', 'monoclinic', [(190, 60), (550, 20), (680, 100), (730, 40), (770, 30), (1030, 15), (3660, 25)]),
    ('Rutile', 'TiO2', 'tetragonal', [(143, 20), (235, 30), (447, 95), (612, 100), (826, 5)]),
    ('Anatase', 'TiO2', 'tetragonal', [(144, 100), (197, 5), (399, 15), (515, 15), (639, 25)]),
    ('Graphite', 'C', 'hexagonal', [(1350, 20), (1581, 100), (2700, 45)]),
    ('Diamond', 'C', 'cubic', [(1332, 100)]),
    ('Zircon', 'ZrSiO4', 'tetragonal', [(202, 15), (214, 15), (225, 15), (357, 60), (439, 35), (975, 30), (1008, 100)]),
    ('Fluorapatite', 'Ca5(PO4)3F', 'hexagonal', [(430, 10), (447, 8), (581, 6), (591, 10), (608, 6), (964, 100), (1042, 6), (1053, 10), (1081, 6)]),
    ('Fluorite', 'CaF2', 'cubic', [(322, 100)]),
    # Halite has no first-order Raman modes; these are its weak, broad second-order bands.
    ('Halite', 'NaCl', 'cubic', [(235, 60), (300, 100), (350, 70)]),
    ('Talc', 'Mg3Si4O10(OH)2', 'monoclinic', [(194, 100), (361, 40), (432, 10), (676, 90), (1051, 10), (3677, 50)]),
    ('Kaolinite', 'Al2Si2O5(OH)4', 'triclinic', [(130, 60), (141, 50), (244, 15), (271, 25), (336, 20), (428, 25), (463, 30), (512, 15), (637, 15), (749, 15), (791, 15), (915, 20), (3620, 100), (3652, 30), (3668, 30), (3696, 70)]),
    ('Corundum', 'Al2O3', 'trigonal', [(378, 30), (418, 100), (432, 10), (451, 8), (578, 10), (645, 12), (751, 20)]),
]


def build_starter():
    g = L.grid('raman')
    items = []
    for name, formula, system, peaks in STARTER:
        w = 30 if name == 'Halite' else 5  # Lorentzian HWHM, cm-1
        y = sum(i * w * w / ((g - c) ** 2 + w * w) for c, i in peaks)
        items.append(dict(name=name, formula=formula, system=system, info='synthetic profile', x=g, y=y))
    n = L.save_spectra('starter', 'Starter minerals (synthetic)', 'raman',
                       'Built-in synthetic Lorentzian profiles from characteristic literature peak positions.', items)
    print('starter', n)


# ---------------------------------------------------------------- spectragryph
# zip stem prefix -> (lib id, title, technique, citation)
SGD = {
    'RRUFF_Raman_DB_5185': ('rruff_raman_excellent', 'RRUFF Raman (excellent quality)', 'raman'),
    'RRUFF_Raman_DB_3087': ('rruff_raman', 'RRUFF Raman', 'raman'),
    'RRUFF_FTIR': ('rruff_ftir', 'RRUFF Infrared', 'ftir'),
    'CHSOS_Raman': ('chsos_raman_pigments', 'CHSOS pigments (Raman)', 'raman'),
    'UCL_Chemistry': ('ucl_raman_pigments', 'UCL pigments (Raman)', 'raman'),
    'SLoPP': ('slopp_raman_microplastics', 'SLoPP/SLoPP-E microplastics (Raman)', 'raman'),
    'Carbohydrates': ('carbohydrates_raman', 'Carbohydrates (Raman)', 'raman'),
    'PharmExcipients': ('pharm_excipients', 'Pharmaceutical excipients', 'raman'),
    'archaeometrielabor': ('archaeometrielabor', 'Archaeometrielabor', None),
    'Kimmel': ('kimmel_ftir', 'Kimmel Center archaeological IR', 'ftir'),
    'Primpke': ('primpke_ftir_microplastics', 'Primpke microplastics (FTIR)', 'ftir'),
    'SWGDRUG': ('swgdrug_ftir', 'SWGDRUG drugs (FTIR)', 'ftir'),
    'PSLC': ('pslc_ftir_polymers', 'PSLC polymers (FTIR)', 'ftir'),
}
SGD_CITE = 'Converted from the Spectragryph database collection (effemm2.de/spectragryph); original data owners as cited there.'


def _technique(xlabel):
    s = xlabel.lower()
    if 'raman' in s:
        return 'raman'
    if 'wavenumber' in s or '1/cm' in s or 'cm-1' in s:
        return 'ftir'
    return None


def _mineral_meta():
    return json.loads(MINERALS.read_text(encoding='utf-8')) if MINERALS.exists() else {}


def _rruff_name(title):
    """'Abelsonite__R070007__Raman__532__0__unoriented__...' -> ('Abelsonite', 'R070007 532 nm unoriented')."""
    p = title.split('__')
    if len(p) < 2:
        return title.strip(), ''
    info = p[1]
    if len(p) > 5 and p[2] == 'Raman':
        info += f' {p[3]} nm {p[5]}'
    return p[0].strip(), info


def build_sgd():
    minerals = _mineral_meta()
    for z in sorted((RAW / 'spectragryph').glob('*.zip')):
        key = next((k for k in SGD if z.name.startswith(k)), None)
        if key is None:
            continue  # reflectance / XRF / LIBS / UV-Vis sets: kept raw, not a raman/ftir/xrd library
        lib_id, title, tech = SGD[key]
        out = EXTRACT / 'spectragryph'
        try:
            with zipfile.ZipFile(z) as zf:
                zf.extractall(out)
                sgdr = next(out / n for n in zf.namelist() if n.lower().endswith('.sgdr'))
        except zipfile.BadZipFile:
            print('SKIP (incomplete download):', z.name)
            continue
        by_tech = {}
        for r in read_sgdr(sgdr):
            t = {2: 'ftir', 3: 'raman'}.get(r['method']) or tech or _technique(r['xlabel'])
            if t is None:
                continue
            name, info = (_rruff_name(r['title']) if lib_id.startswith('rruff') else (r['title'], ''))
            f, s = minerals.get(name.lower(), ['', ''])
            # RRUFF records carry the ideal formula, '##CHEMISTRY=Ca_2_(Mg,Fe^2+^)_5_...', in a
            # 50-character field: use it when it fits, else the COD formula for that mineral.
            m = re.search(r'##CHEMISTRY=(\S+)', r['xlabel'])
            if m and (len(r['xlabel']) < 50 or not f):
                f = re.sub(r'[_^]', '', m.group(1))
            by_tech.setdefault(t, []).append(dict(name=name, info=info, formula=f, system=s, x=r['x'], y=r['y']))
        for t, items in by_tech.items():
            lid = lib_id if len(by_tech) == 1 else f'{lib_id}_{t}'
            print(lid, L.save_spectra(lid, title, t, SGD_CITE, items))


# ---------------------------------------------------------------- ROD
def _cif_tag(text, tag):
    m = re.search(r'^' + re.escape(tag) + r'[ \t]+(.+)$', text, re.M)
    return m.group(1).strip().strip("'\"") if m else ''


def build_rod():
    items = []
    for p in sorted((RAW / 'rod').glob('*.rod')):
        text = p.read_text(encoding='utf-8', errors='replace')
        m = re.search(r'_raman_spectrum\.raman_shift\s+_raman_spectrum\.intensity\s+((?:[-+0-9.eE]+[ \t]+[-+0-9.eE]+\s*\n?)+)', text)
        if not m:
            continue
        xy = np.array(m.group(1).split(), float).reshape(-1, 2)
        name = _cif_tag(text, '_chemical_name_mineral') or _cif_tag(text, '_chemical_name_common') \
            or _cif_tag(text, '_chemical_name_systematic') or _cif_tag(text, '_chemical_formula_sum') or p.stem
        laser = _cif_tag(text, '_raman_measurement_device.excitation_laser_wavelength')
        items.append(dict(name=name, formula=_cif_tag(text, '_chemical_formula_sum'),
                          system=_cif_tag(text, '_space_group_crystal_system'),
                          info=f'ROD {p.stem}' + (f', {laser} nm' if laser else ''), x=xy[:, 0], y=xy[:, 1]))
    n = L.save_spectra('rod_raman', 'Raman Open Database (ROD)', 'raman',
                       'Raman Open Database, solsa.crystallography.net/rod (CC0). El Mendili et al., J. Appl. Cryst. 52 (2019) 618.', items)
    print('rod_raman', n)


# ---------------------------------------------------------------- COD minerals -> XRD
def _sg_system(n):
    for lim, name in ((2, 'triclinic'), (15, 'monoclinic'), (74, 'orthorhombic'), (142, 'tetragonal'),
                      (167, 'trigonal'), (194, 'hexagonal'), (230, 'cubic')):
        if n <= lim:
            return name
    return ''


def _xrd_one(path):
    from pymatgen.analysis.diffraction.xrd import XRDCalculator
    from pymatgen.io.cif import CifParser
    warnings.filterwarnings('ignore')
    try:
        text = Path(path).read_text(encoding='utf-8', errors='replace')
        name = _cif_tag(text, '_chemical_name_mineral')
        if not name:
            return None
        s = CifParser(path, occupancy_tolerance=100).parse_structures(primitive=False)[0]
        if len(s) > 400:  # ponytail: skips very large cells (slow); raise if those minerals matter
            return None
        pat = XRDCalculator('CuKa').get_pattern(s, two_theta_range=(4, 90))
        k = np.argsort(pat.y)[::-1][:40]
        peaks = sorted([round(float(pat.x[i]), 3), round(float(pat.y[i]), 1)] for i in k if pat.y[i] >= 1)
        try:
            system = _sg_system(s.get_space_group_info()[1])
        except Exception:
            system = ''
        return dict(name=name, formula=_cif_tag(text, '_chemical_formula_sum'), system=system,
                    info=f'COD {Path(path).stem}', peaks=peaks)
    except Exception:
        return None


def build_cod():
    files = [str(p) for p in sorted((RAW / 'cod_amcsd').glob('*.cif'))]
    with Pool() as pool:
        res = []
        for i, r in enumerate(pool.imap(_xrd_one, files, chunksize=20)):
            if r:
                res.append(r)
            if i % 1000 == 0:
                print(f'  cod {i}/{len(files)} ok={len(res)}', flush=True)
    n = L.save_peaks('cod_minerals_xrd', 'COD minerals (AMCSD-derived), computed powder XRD', 'xrd',
                     'Crystallography Open Database (CC0), entries 9000000-9017999 (American Mineralogist Crystal '
                     'Structure Database). Patterns computed for Cu K-alpha with pymatgen.', res)
    minerals = {}
    for r in res:
        minerals.setdefault(r['name'].lower(), [r['formula'], r['system']])
    MINERALS.write_text(json.dumps(minerals), encoding='utf-8')
    print('cod_minerals_xrd', n, 'distinct minerals', len(minerals))


if __name__ == '__main__':
    steps = dict(starter=build_starter, cod=build_cod, sgd=build_sgd, rod=build_rod)
    for name in (sys.argv[1:] or list(steps)):
        steps[name]()
