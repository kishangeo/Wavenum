"""Renishaw WiRE .wdf maps for the Map tab. Text maps and images are read in the browser (frontend/src/maps.ts).

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

Payload: uint32 header length, JSON header {name, axis, px, py, count}, padding to 4 bytes, float32 spectra.
"""
import json
import os
import struct
import tempfile

import numpy as np


def encode(name, axis, px, py, spectra):
    head = json.dumps(dict(name=name, axis=[float(v) for v in axis], px=[float(v) for v in px],
                           py=[float(v) for v in py], count=int(len(px)))).encode()
    pad = (4 - (4 + len(head)) % 4) % 4
    return struct.pack('<I', len(head)) + head + b' ' * pad + np.asarray(spectra, '<f4').tobytes()


def wdf_map(name, raw):
    from renishawWiRE import WDFReader
    fd, path = tempfile.mkstemp(suffix='.wdf')
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw)
        r = WDFReader(path)
        try:
            n, s = int(r.count), int(r.point_per_spectrum)
            spectra = np.asarray(r.spectra, float).reshape(-1, s)[:n]
            axis = np.asarray(r.xdata, float)[:s]
            px = np.asarray(getattr(r, 'xpos', None) if getattr(r, 'xpos', None) is not None else np.arange(n), float).ravel()[:n]
            py = np.asarray(getattr(r, 'ypos', None) if getattr(r, 'ypos', None) is not None else np.zeros(n), float).ravel()[:n]
            pz = getattr(r, 'zpos', None)
            if pz is not None and np.ptp(px) == 0 and np.ptp(py) == 0 and len(np.ravel(pz)) >= n:
                px = np.asarray(pz, float).ravel()[:n]  # depth scan: Z is the path coordinate
        finally:
            r.close()
    finally:
        os.unlink(path)
    if len(px) != n or len(py) != n:
        px, py = np.arange(n, dtype=float), np.zeros(n)
    return encode(name.rsplit('.', 1)[0], axis, px, py, spectra)


if __name__ == '__main__':  # self-check of the payload layout
    b = encode('t', [1, 2, 3], [0, 1], [0, 0], [[1, 2, 3], [4, 5, 6]])
    hl = struct.unpack_from('<I', b)[0]
    h = json.loads(b[4:4 + hl])
    off = 4 + hl + (4 - (4 + hl) % 4) % 4
    assert h['count'] == 2 and list(np.frombuffer(b[off:], '<f4')) == [1, 2, 3, 4, 5, 6]
    print('maps ok')
