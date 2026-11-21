"""Instrument / exchange file readers. Each returns dict(columns=[...], data=[[x...],[y...]]).

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

Text tables (.txt .csv .xy .xye .dat .asc .dpt .prn, RRUFF .txt) and .xlsx are handled in processing.py.
Here: JCAMP-DX (.jdx .dx .jcm), Galactic/Thermo SPC (.spc), Nicolet OMNIC (.spa), Bruker OPUS
(.0 .1 ...), Renishaw WiRE (.wdf), Agilent (.asp), PANalytical (.xrdml), Rigaku (.ras),
Bruker/Siemens (.uxd) and crystal structures (.cif -> computed powder pattern).
Files holding several spectra (maps, multi-file SPC) yield the first one.
"""
import os
import re
import struct
import tempfile
import xml.etree.ElementTree as ET

import numpy as np


def _xy(x, y, xname='x', yname='y'):
    x, y = np.asarray(x, float), np.asarray(y, float)
    ok = np.isfinite(x) & np.isfinite(y)
    if ok.sum() < 3:
        raise ValueError('No usable data points in file')
    return dict(columns=[xname, yname], data=[x[ok].tolist(), y[ok].tolist()])


def _with_tempfile(raw, suffix, fn):
    """Some reader libraries only take a path."""
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw)
        return fn(path)
    finally:
        os.unlink(path)


def read_jcamp(raw):
    import jcamp
    d = jcamp.read(raw.decode('latin-1').splitlines())
    if 'x' not in d or 'y' not in d:
        raise ValueError('JCAMP file has no XY data block')
    return _xy(d['x'], d['y'], str(d.get('xunits', 'x')), str(d.get('yunits', 'y')))


def read_spc(raw):
    """Galactic SPC, new format (version byte 0x4B). Old 0x4D files are not supported."""
    ftflgs, fversn, _, fexp, fnpts, ffirst, flast, fnsub = struct.unpack_from('<BBBbidd i', raw, 0)
    if fversn != 0x4B:
        raise ValueError(f'Unsupported SPC version {fversn:#x} (only new-format 0x4B)')
    pos = 512
    xyxys, txvals, y16 = ftflgs & 0x40, ftflgs & 0x80, ftflgs & 0x01
    x = None
    if txvals and not xyxys:
        x = np.frombuffer(raw, '<f4', fnpts, pos)
        pos += 4 * fnpts
    subexp = struct.unpack_from('<b', raw, pos + 1)[0]
    n = fnpts
    if xyxys:
        n = struct.unpack_from('<i', raw, pos + 16)[0]
    pos += 32
    if xyxys:
        x = np.frombuffer(raw, '<f4', n, pos)
        pos += 4 * n
    exp = subexp if (ftflgs & 0x04) or xyxys else fexp
    if exp == -128:  # 0x80: IEEE float Y
        y = np.frombuffer(raw, '<f4', n, pos).astype(float)
    elif y16:
        y = np.frombuffer(raw, '<i2', n, pos) * 2.0 ** (exp - 16)
    else:
        y = np.frombuffer(raw, '<i4', n, pos) * 2.0 ** (exp - 32)
    if x is None:
        x = np.linspace(ffirst, flast, n)
    return _xy(x, y)


def read_spa(raw):
    """Nicolet OMNIC .spa: section table at 304 (16-byte entries: uint16 type, uint32 offset, uint32 size).
    Type 2 = spectrum header (points @+4, first/last x @+16/+20), type 3 = float32 intensities."""
    n_sec = struct.unpack_from('<H', raw, 294)[0]
    hdr = data = None
    for i in range(n_sec):
        typ, off, size = struct.unpack_from('<HII', raw, 304 + 16 * i)
        if typ == 2 and hdr is None:
            hdr = off
        if typ == 3 and data is None:
            data = (off, size)
    if hdr is None or data is None:
        raise ValueError('Not a readable OMNIC .spa file')
    n = struct.unpack_from('<I', raw, hdr + 4)[0]
    first, last = struct.unpack_from('<ff', raw, hdr + 16)
    n = min(n, data[1] // 4)
    return _xy(np.linspace(first, last, n), np.frombuffer(raw, '<f4', n, data[0]), 'Wavenumber', 'Intensity')


def read_opus(raw):
    def go(path):
        from brukeropus import read_opus as _read
        f = _read(path)
        if not f.is_opus:
            raise ValueError('Not a Bruker OPUS file')
        keys = list(f.all_data_keys)
        # absorbance, Raman, transmittance, reflectance, then single-channel sample spectrum
        key = next((k for k in ('a', 'ra', 't', 'r', 'sm') if k in keys),
                   next((k for k in keys if not k.startswith('ig')), None))
        if key is None:
            raise ValueError('No spectrum block found in OPUS file')
        d = getattr(f, key)
        return _xy(d.x, d.y, 'Wavenumber', getattr(d, 'label', key))
    return _with_tempfile(raw, '.0', go)


def read_wdf(raw):
    def go(path):
        from renishawWiRE import WDFReader
        r = WDFReader(path)
        try:
            s = np.asarray(r.spectra, float)
            s = s.reshape(-1, s.shape[-1])
            # first spectrum that is not all zero (depth series can start with an empty one); maps -> Map tab
            k = next((i for i in range(len(s)) if np.any(s[i] != 0)), 0)
            return _xy(r.xdata, s[k], 'Raman shift', 'Counts')
        finally:
            r.close()
    return _with_tempfile(raw, '.wdf', go)


def read_asp(raw):
    """Agilent .asp: point count, first x, last x, three more header lines, then one Y per line."""
    v = [float(t) for t in raw.decode('latin-1').split()]
    n = int(v[0])
    return _xy(np.linspace(v[1], v[2], n), v[6:6 + n], 'Wavenumber', 'Intensity')


def read_xrdml(raw):
    root = ET.fromstring(raw)
    ns = re.match(r'\{.*\}', root.tag)
    ns = ns.group(0) if ns else ''
    y_el = root.find(f'.//{ns}intensities')
    if y_el is None:
        y_el = root.find(f'.//{ns}counts')
    y = np.array(y_el.text.split(), float)
    for pos in root.iter(f'{ns}positions'):
        if pos.get('axis') == '2Theta':
            lst = pos.find(f'{ns}listPositions')
            if lst is not None:
                x = np.array(lst.text.split(), float)
            else:
                x = np.linspace(float(pos.find(f'{ns}startPosition').text), float(pos.find(f'{ns}endPosition').text), len(y))
            return _xy(x, y, '2theta', 'Counts')
    raise ValueError('No 2Theta axis in XRDML file')


def read_ras(raw):
    """Rigaku .ras: 'x y attenuation' rows between *RAS_INT_START and *RAS_INT_END."""
    m = re.search(r'\*RAS_INT_START(.*?)\*RAS_INT_END', raw.decode('latin-1'), re.S)
    if not m:
        raise ValueError('No intensity block in .ras file')
    a = np.array([ln.split()[:3] for ln in m.group(1).strip().splitlines()], float)
    return _xy(a[:, 0], a[:, 1] * (a[:, 2] if a.shape[1] > 2 else 1), '2theta', 'Counts')


def read_uxd(raw):
    """Bruker/Siemens UXD: '_START', '_STEPSIZE' keywords then counts (or 2theta/count pairs)."""
    text = raw.decode('latin-1')
    kv = dict(re.findall(r'^_(\w+)\s*=\s*([-\d.eE+]+)', text, re.M))
    rows = [ln.split() for ln in text.splitlines() if ln.strip() and ln.strip()[0] in '-.0123456789']
    v = np.array([float(t) for r in rows for t in r])
    if rows and len(rows[0]) == 2 and all(len(r) == 2 for r in rows):
        return _xy(v[0::2], v[1::2], '2theta', 'Counts')
    return _xy(float(kv['START']) + float(kv['STEPSIZE']) * np.arange(len(v)), v, '2theta', 'Counts')


def read_cif(raw):
    """Crystal structure -> computed Cu K-alpha powder pattern (pymatgen), as a profile."""
    try:
        import pymatgen  # noqa: F401  (optional: pip install -r requirements-xrd.txt)
    except ImportError:
        raise ValueError('Loading CIF files needs pymatgen (pip install -r requirements-xrd.txt); '
                         'it is not installed on this server')

    def go(path):
        import warnings
        from pymatgen.analysis.diffraction.xrd import XRDCalculator
        from pymatgen.io.cif import CifParser
        warnings.filterwarnings('ignore')
        s = CifParser(path, occupancy_tolerance=100).parse_structures(primitive=False)[0]
        pat = XRDCalculator('CuKa').get_pattern(s, two_theta_range=(4, 90))
        x = np.arange(4, 90, 0.02)
        y = (np.asarray(pat.y)[:, None] * np.exp(-0.5 * ((x[None, :] - np.asarray(pat.x)[:, None]) / 0.06) ** 2)).sum(0)
        return _xy(x, y, '2theta (Cu Ka, computed)', 'Intensity')
    return _with_tempfile(raw, '.cif', go)


READERS = {'.jdx': read_jcamp, '.dx': read_jcamp, '.jcm': read_jcamp, '.jcamp': read_jcamp, '.spc': read_spc,
           '.spa': read_spa, '.wdf': read_wdf, '.asp': read_asp, '.xrdml': read_xrdml, '.ras': read_ras,
           '.uxd': read_uxd, '.cif': read_cif}


def reader_for(name):
    ext = os.path.splitext(name.lower())[1]
    if re.fullmatch(r'\.\d+', ext):  # Bruker OPUS files are numbered: .0, .1, ...
        return read_opus
    return READERS.get(ext)


if __name__ == '__main__':  # self-check against the sample files, if present
    import sys
    from pathlib import Path
    d = Path(__file__).resolve().parent.parent / 'samples' / 'formats'
    for p in sorted(d.glob('*')):
        fn = reader_for(p.name)
        if fn is None:
            continue
        r = fn(p.read_bytes())
        x, y = np.array(r['data'])
        assert len(x) > 50 and np.ptp(y) > 0, p.name
        print(f'{p.name:32} n={len(x):6} x={x.min():.1f}..{x.max():.1f} y={y.min():.3g}..{y.max():.3g} {r["columns"]}')
    # synthetic round-trips for formats without a sample file
    xr = b'<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/1.5"><xrdMeasurement><scan><dataPoints>' \
         b'<positions axis="2Theta" unit="deg"><startPosition>10</startPosition><endPosition>20</endPosition></positions>' \
         b'<intensities unit="counts">1 2 3 9 3 2 1 1 1 1 1</intensities></dataPoints></scan></xrdMeasurement></xrdMeasurements>'
    r = read_xrdml(xr)
    assert r['data'][0][3] == 13 and r['data'][1][3] == 9
    r = read_ras(b'*RAS_INT_START\n10.0 5 1\n10.1 7 2\n10.2 6 1\n*RAS_INT_END\n')
    assert r['data'][1] == [5, 14, 6]
    r = read_uxd(b'_STEPSIZE = 0.5\n_START = 10\n_COUNTS\n1 2 3 4\n5 6\n')
    assert r['data'][0][-1] == 12.5 and r['data'][1][-1] == 6
    print('formats ok')
