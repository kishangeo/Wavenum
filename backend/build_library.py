"""Build Wavenum reference libraries from the raw downloads in databases/raw.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

Usage:  python backend/build_library.py [community] [starter] [sgd] [rod] [cod]   (no args = all)
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


# FTIR starter set: positions and relative absorbances of the strongest bands (>= 10 %) of the most
# representative RRUFF infrared spectrum (medoid of all spectra of that mineral) (Lafuente et al. 2015), drawn as synthetic Lorentzian profiles.
# Generated from the RRUFF infrared library; RRUFF IDs in the 4th field.
STARTER_FTIR = [
    ('Quartz', 'O2 Si', 'trigonal', 'R050125-1', [(454, 84.7), (694, 29.4), (776, 62.0), (1054, 100.0), (1162, 44.7)]),
    ('Calcite', 'C Ca O3', 'trigonal', 'R050307-1', [(712, 17.6), (872, 47.5), (1394, 100.0)]),
    ('Aragonite', 'C Ca O3', 'orthorhombic', 'R040078-1', [(700, 12.2), (712, 17.6), (856, 51.8), (1082, 15.7), (1446, 100.0)]),
    ('Dolomite', 'C2 Ca Mg O6', 'trigonal', 'R050241-1', [(728, 26.3), (880, 54.9), (1434, 100.0)]),
    ('Magnesite', 'C Mg O3', 'trigonal', 'R050443-1', [(402, 28.6), (748, 25.1), (880, 47.1), (1430, 100.0)]),
    ('Siderite', 'C Fe O3', 'trigonal', 'R040034-1', [(402, 18.4), (738, 28.6), (864, 54.1), (1406, 100.0)]),
    ('Rhodochrosite', 'C Mn O3', 'trigonal', 'R040133-1', [(726, 32.9), (860, 58.4), (1398, 100.0)]),
    ('Cerussite', 'C O3 Pb', 'orthorhombic', 'R050011-1', [(676, 51.8), (836, 52.2), (1050, 43.1), (1372, 100.0), (3986, 27.1)]),
    ('Gypsum', 'Ca H4 O6 S', 'monoclinic', 'R040029-1', [(458, 16.9), (598, 34.1), (668, 28.2), (1104, 100.0), (1620, 23.1), (3404, 53.7), (3532, 42.0)]),
    ('Anhydrite', 'Ca O4 S', 'orthorhombic', 'R040012-1', [(592, 52.2), (610, 31.4), (674, 38.4), (1096, 100.0)]),
    ('Baryte', 'Ba O4 S', 'orthorhombic', 'R040036-1', [(604, 67.5), (632, 29.0), (982, 45.9), (1062, 100.0)]),
    ('Celestine', 'O4 S Sr', 'orthorhombic', 'R040007-1', [(604, 67.5), (640, 31.0), (992, 55.3), (1068, 100.0)]),
    ('Talc', 'H2 Mg3 O12 Si4', 'monoclinic', 'R050058-1', [(406, 65.9), (460, 42.4), (666, 56.9), (986, 100.0), (3674, 33.7)]),
    ('Muscovite', 'Al3 H2 K O12 Si3', 'monoclinic', 'R050080-1', [(454, 91.8), (528, 85.1), (648, 56.9), (980, 100.0), (3630, 22.7)]),
    ('Phlogopite', 'Al F H K Mg3 O11 Si3', 'monoclinic', 'R050068-1', [(444, 100.0), (610, 69.4), (644, 70.6), (974, 96.5), (1000, 96.1)]),
    ('Albite', 'Al Na O8 Si3', 'triclinic', 'R040068-1', [(416, 55.3), (462, 37.3), (530, 41.2), (586, 43.9), (648, 27.8), (722, 26.7), (744, 29.4), (760, 29.4), (788, 23.9), (984, 100.0), (1096, 47.5), (1148, 42.7)]),
    ('Orthoclase', 'Al K O8 Si3', 'monoclinic', 'R050185-1', [(414, 62.7), (542, 40.0), (578, 45.9), (640, 23.1), (724, 27.8), (992, 100.0)]),
    ('Microcline', 'Al0.93 K O8 Si3.07', 'triclinic', 'R050054-1', [(416, 63.1), (536, 34.9), (578, 42.4), (648, 22.4), (726, 32.2), (768, 27.1), (996, 100.0), (1134, 42.7)]),
    ('Anorthite', 'Al2 Ca O8 Si2', 'triclinic', 'R060082-1', [(538, 68.6), (574, 72.5), (740, 34.5), (932, 100.0)]),
    ('Forsterite', 'Fe0.2 Mg1.8 O4 Si', 'orthorhombic', 'R040018-1', [(410, 99.2), (468, 45.5), (502, 74.5), (606, 32.2), (836, 68.6), (878, 100.0), (980, 46.3)]),
    ('Enstatite', 'Ca0.052 Mg1.948 O6 Si2', 'orthorhombic', 'R050644-1', [(446, 94.9), (496, 91.0), (540, 58.4), (644, 38.8), (690, 32.5), (724, 32.9), (854, 90.2), (922, 100.0), (1008, 52.9), (1058, 69.0), (3360, 12.2), (3952, 13.7)]),
    ('Diopside', 'Ca Mg O6 Si2', 'monoclinic', 'R070123-1', [(468, 91.4), (502, 80.8), (630, 34.9), (672, 24.7), (858, 100.0), (960, 79.6), (1064, 82.7)]),
    ('Tremolite', 'Ca2 H2 Mg5 O24 Si8', 'monoclinic', 'R050498-1', [(414, 75.3), (442, 100.0), (508, 67.5), (662, 18.0), (686, 24.3), (756, 36.1), (916, 87.8), (950, 94.1), (1038, 40.8)]),
    ('Epidote', 'Al2 Ca2 Fe H O13 Si3', 'monoclinic', 'R050131-1', [(452, 72.9), (512, 82.7), (644, 70.2), (878, 90.2), (946, 87.8), (1036, 40.4), (1078, 39.2), (3354, 21.6)]),
    ('Almandine', 'Al2 Ca0.12 Fe2.58 Mg0.27 O12 Si3', 'cubic', 'R040076-1', [(440, 89.4), (472, 72.9), (568, 54.5), (862, 100.0), (894, 83.5), (960, 85.1)]),
    ('Pyrope', 'Al2 Mg3 O12 Si3', 'cubic', 'R050112-1', [(454, 100.0), (476, 90.6), (570, 64.7), (860, 93.3), (896, 82.7), (962, 82.0)]),
    ('Zircon', 'O4 Si Zr', 'tetragonal', 'R050286-1', [(430, 58.0), (608, 61.6), (868, 100.0), (3566, 20.4), (3780, 21.6), (3986, 22.0)]),
    ('Fluorapatite', 'Ca5 F O12 P3', 'hexagonal', 'R050529-1', [(470, 12.9), (566, 85.1), (600, 65.9), (864, 21.6), (964, 38.8), (1024, 100.0), (1424, 17.6)]),
    ('Hematite', 'Fe2 O3', 'trigonal', 'R050300-1', [(422, 89.0), (428, 88.2), (514, 90.6), (3992, 100.0)]),
    ('Goethite', 'Fe H O2', 'orthorhombic', 'R050142-1', [(450, 80.0), (562, 39.2), (798, 58.4), (892, 39.6), (1654, 39.6), (1774, 39.6), (3072, 95.3), (3998, 67.5)]),
    ('Rutile', 'Al0.011 Cr0.012 Fe0.008 H0.108 Nb0.011 O2 Ti0.96', 'tetragonal', 'R050031-1', [(492, 100.0), (3986, 97.3), (3996, 97.3)]),
    ('Corundum', 'Al2 O3', 'trigonal', 'R040096-1', [(446, 93.3), (494, 45.1), (556, 98.4), (592, 100.0), (636, 89.8)]),
    ('Antigorite', 'H79 Mg48 O147 Si34', 'monoclinic', 'R070228-1', [(436, 94.1), (446, 94.1), (556, 61.6), (616, 78.8), (984, 100.0), (3670, 37.3)]),
    ('Brucite', 'H2 Mg O2', 'trigonal', 'R040077-1', [(402, 56.1), (3690, 100.0)]),
    ('Beryl', 'Al2.15 Be2.58 Ca0.02 Cs0.09 Fe0.01 H2 K0.05 Li0.39 Mg0.02 Na0.21 O18.55 Si5.88', 'hexagonal', 'R050121-1', [(428, 97.3), (492, 83.1), (518, 82.4), (590, 65.1), (652, 52.2), (676, 81.2), (740, 48.2), (806, 58.8), (950, 100.0), (1014, 48.2), (1200, 69.4)]),
    ('Topaz', 'Al2 H2 O6 Si', 'orthorhombic', 'R050176-1', [(452, 94.1), (480, 80.8), (524, 59.2), (558, 50.2), (616, 96.5), (706, 18.4), (868, 100.0), (1000, 28.6), (1164, 12.2)]),
    ('Malachite', 'C H2 Cu2 O5', 'monoclinic', 'R050508-1', [(426, 69.0), (504, 68.6), (524, 67.8), (572, 53.3), (712, 46.7), (748, 64.7), (774, 40.4), (818, 96.1), (872, 60.4), (1044, 68.2), (1382, 100.0), (1488, 59.6)]),
    ('Azurite', 'C2 H2 Cu3 O8', 'monoclinic', 'R050638-1', [(402, 31.8), (446, 42.4), (492, 24.3), (768, 21.2), (814, 43.5), (832, 43.9), (950, 35.3), (1092, 10.2), (1406, 100.0), (1462, 47.5), (1492, 39.6), (3426, 43.5)]),
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


COMMUNITY = ROOT / 'databases' / 'community' / 'minerals.json'


def build_community():
    """Community minerals pack (databases/community/minerals.json).

    Raman and FTIR entries: literature band positions drawn as Lorentzians. XRD entries: peaks are
    [d-spacing in angstrom, relative intensity], stored as 2-theta for Cu K-alpha like the COD library.
    """
    pack = json.loads(COMMUNITY.read_text(encoding='utf-8'))
    spectra, xrd = dict(raman=[], ftir=[]), []
    for m in pack['minerals']:
        missing = {'name', 'formula', 'system', 'technique', 'peaks', 'source'} - set(m)
        assert not missing, f"{m.get('name')}: missing {sorted(missing)}"
        t = m['technique']
        assert t in ('raman', 'ftir', 'xrd'), f"{m['name']}: technique must be raman, ftir or xrd"
        lo, hi = (0.7, 50) if t == 'xrd' else (50, 4000)
        assert m['peaks'] and all(len(p) == 2 and lo <= p[0] <= hi for p in m['peaks']), f"{m['name']}: bad peaks"
        info = f"{m['source']} | {m.get('note', '')}".strip(' |')
        if t == 'xrd':
            pk = sorted([round(float(2 * np.degrees(np.arcsin(1.54184 / (2 * d)))), 3), float(i)] for d, i in m['peaks'] if d > 0.78)
            xrd.append(dict(name=m['name'], formula=m['formula'], system=m['system'], info=info, peaks=pk))
            continue
        g = L.grid(t)
        w = 8 if t == 'raman' else 16  # Lorentzian HWHM, cm-1: shock phases give broad Raman bands; infrared bands are broader
        y = sum(i * w * w / ((g - c) ** 2 + w * w) for c, i in m['peaks'])
        spectra[t].append(dict(name=m['name'], formula=m['formula'], system=m['system'], x=g, y=y, info=info))
    cite = 'Wavenum community pack: published peak positions; source DOI per entry.'
    n = L.save_spectra('community_raman', 'Community minerals (literature peaks)', 'raman', cite, spectra['raman'])
    if spectra['ftir']:
        n += L.save_spectra('community_ftir', 'Community minerals (literature FTIR bands)', 'ftir', cite, spectra['ftir'])
    if xrd:
        n += L.save_peaks('community_xrd', 'Community minerals (literature d-spacings)', 'xrd', cite, xrd)
    print('community', n)
    return n


def build_starter_ftir():
    g = L.grid('ftir')
    items = []
    for name, formula, system, rruff_id, peaks in STARTER_FTIR:
        w = 16  # Lorentzian HWHM, cm-1 (infrared bands are broader than Raman bands)
        y = sum(i * w * w / ((g - c) ** 2 + w * w) for c, i in peaks)
        items.append(dict(name=name, formula=formula, system=system, info=f'synthetic, after RRUFF {rruff_id}', x=g, y=y))
    n = L.save_spectra('starter_ftir', 'Starter minerals (synthetic FTIR)', 'ftir',
                       'Synthetic Lorentzian profiles at band positions of RRUFF infrared spectra (Lafuente et al. 2015).', items)
    print('starter_ftir', n)


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
            name, info = (_rruff_name(r['title']) if lib_id.startswith('rruff') else (r['title'].strip().rstrip(';').strip(), ''))
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
    """Value of a CIF data item; also when it sits on the next line(s), quoted or as a ;-delimited field."""
    m = re.search(r'^' + re.escape(tag) + r'[ \t]*(.*)$', text, re.M)
    if not m:
        return ''
    v = m.group(1).strip()
    if not v:
        rest = text[m.end():].lstrip('\r\n')
        if rest.startswith(';'):
            v = rest[1:].split('\n;', 1)[0]
        else:
            v = rest.split('\n', 1)[0]
    return ' '.join(v.strip().strip("'\"").split())


def _rod_spectrum(text):
    """(shift, intensity) rows of the _raman_spectrum loop, whatever other columns it has
    (some entries also carry _raman_spectrum.raw_intensity)."""
    m = re.search(r'loop_\s+((?:_raman_spectrum\.\S+\s+)+)', text)
    if not m:
        return None
    tags = m.group(1).split()
    if '_raman_spectrum.raman_shift' not in tags or '_raman_spectrum.intensity' not in tags:
        return None
    vals = []
    for tok in text[m.end():].split():
        try:
            vals.append(float(tok))
        except ValueError:
            break
    rows = np.array(vals[:len(vals) // len(tags) * len(tags)]).reshape(-1, len(tags))
    if len(rows) < 2:
        return None
    return rows[:, [tags.index('_raman_spectrum.raman_shift'), tags.index('_raman_spectrum.intensity')]]


def build_rod():
    items = []
    for p in sorted((RAW / 'rod').glob('*.rod')):
        text = p.read_text(encoding='utf-8', errors='replace')
        xy = _rod_spectrum(text)
        if xy is None:
            continue
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
    steps = dict(community=build_community, starter=build_starter, starter_ftir=build_starter_ftir, cod=build_cod, sgd=build_sgd, rod=build_rod)
    for name in (sys.argv[1:] or list(steps)):
        steps[name]()
