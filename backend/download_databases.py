"""Download the open reference databases Wavenum indexes into databases/raw.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

Usage:  python backend/download_databases.py [spectragryph] [rod] [cod]   (no args = all)
Then:   python backend/build_library.py

Sources (about 450 MB in total; re-running skips files that are already complete):
  spectragryph  22 archives from https://www.effemm2.de/spectragryph/down_databases.html, including the
                RRUFF Raman (5,185 + 3,087) and RRUFF infrared (882) sets
  rod           every entry of the Raman Open Database, https://solsa.crystallography.net/rod/ (CC0)
  cod           Crystallography Open Database entries 9000000-9017999, the AMCSD-derived mineral
                structures, https://www.crystallography.net/cod/ (CC0)
"""
import re
import sys
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / 'databases' / 'raw'
UA = {'User-Agent': 'Wavenum database downloader'}

SPECTRAGRYPH = 'https://www.effemm2.de/spectragryph/databases/'
SG_FILES = [
    'RRUFF_Raman_DB_5185excellent_entries_2017_01', 'RRUFF_Raman_DB_3087entries_02', 'RRUFF_FTIR_DB_882entries_01',
    'CHSOS_Raman_pigments_database_123entries', 'CHSOS_Reflectance_pigments_database_70entries',
    'CHSOS_XRF_pigments_59entries', 'Carbohydrates_Raman_Database_24entries',
    'Elements_Minerals_XRF_Database_95entries', 'JPL_ASTER_allSections_2409spectra',
    'Kimmel_Center_IR_spectra_library_363entries', 'LIBS_reference%20materials', 'PSLC_database_144entries',
    'PharmExcipients_75_entries', 'PhotochemCAD_abs_fl_166_org_compounds', 'Primpke_FTIR_Microplastics_380_entries',
    'SLoPP_Raman_microplastics_276entries', 'SWGDRUG_624_entries', 'UCL_Chemistry_RamanLibrary_55pigments',
    'USGS_splib06_Minerals_881spectra', 'USGS_splib07_Minerals_1275spectra', 'USGS_splib07_allSections_2456spectra',
    'archaeometrielabor_db03',
]
ROD_LIST = 'https://solsa.crystallography.net/rod/result.php?format=urls&text='
ROD_ENTRY = 'https://solsa.crystallography.net/rod/{}.rod'
COD_ENTRY = 'http://www.crystallography.net/cod/{}.cif'
COD_RANGE = range(9000000, 9018000)


def fetch(url, dest, timeout=600):
    """Download url to dest via a temporary file. Returns True on success, False if the server has no such file."""
    tmp = dest.with_suffix(dest.suffix + '.part')
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r, open(tmp, 'wb') as f:
            while chunk := r.read(1 << 16):
                f.write(chunk)
    except urllib.error.HTTPError as e:
        tmp.unlink(missing_ok=True)
        if e.code == 404:
            return False
        raise
    tmp.replace(dest)
    return True


def _zip_ok(p):
    try:
        with zipfile.ZipFile(p) as z:
            return z.testzip() is None
    except (zipfile.BadZipFile, OSError):
        return False


def spectragryph():
    out = RAW / 'spectragryph'
    out.mkdir(parents=True, exist_ok=True)

    def one(name):
        dest = out / (name.replace('%20', '_') + '.zip')
        if dest.exists() and _zip_ok(dest):
            return f'ok (already have) {dest.name}'
        fetch(SPECTRAGRYPH + name + '.zip', dest, timeout=7200)
        return ('ok ' if _zip_ok(dest) else 'CORRUPT, re-run to retry ') + dest.name

    with ThreadPoolExecutor(4) as pool:
        for msg in pool.map(one, SG_FILES):
            print(' ', msg, flush=True)


def _many(urls_and_dests, workers=8):
    todo = [(u, d) for u, d in urls_and_dests if not d.exists()]
    done = 0
    with ThreadPoolExecutor(workers) as pool:
        for i, ok in enumerate(pool.map(lambda ud: fetch(*ud, timeout=180), todo)):
            done += ok
            if i % 500 == 0:
                print(f'  {i}/{len(todo)}', flush=True)
    return done


def rod():
    out = RAW / 'rod'
    out.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(ROD_LIST, headers=UA), timeout=300) as r:
        ids = sorted(set(re.findall(r'(\d+)\.rod', r.read().decode('latin-1'))))
    print(f'  ROD lists {len(ids)} entries')
    n = _many([(ROD_ENTRY.format(i), out / f'{i}.rod') for i in ids])
    print(f'  downloaded {n} new, {len(list(out.glob("*.rod")))} on disk')


def cod():
    out = RAW / 'cod_amcsd'
    out.mkdir(parents=True, exist_ok=True)
    n = _many([(COD_ENTRY.format(i), out / f'{i}.cif') for i in COD_RANGE])
    print(f'  downloaded {n} new, {len(list(out.glob("*.cif")))} on disk (gaps in the ID range are normal)')


if __name__ == '__main__':
    steps = dict(spectragryph=spectragryph, rod=rod, cod=cod)
    for name in (sys.argv[1:] or list(steps)):
        print(name, flush=True)
        steps[name]()
