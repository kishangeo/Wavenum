"""Reader for Spectragryph spectral database files (.sgdr).

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

The format is undocumented; the layout below was worked out from the files.
  file header: str16 'SGSpecDB', ..., int32 K @0x12 (category fields per record), int32 count @0x16
  per record:  int32 idx, str16 tag, K x int32 category indexes (first = method:
               0 UV-VIS, 1 NIR, 2 FTIR, 3 Raman, ...), then a record header and n float64 Y.
  record header (offsets from record start):
    0x000 ShortString[255] source path     0x100 ShortString[255] title
    0x233 ShortString[50]  x-axis label / comment
    ... float64 x0, dx ... three float64 -1.0, int32 n, a few ints/pointers, then Y.
The numeric part moves between file versions, so n is found by its signature (three -1.0
doubles in front of it). File format (float64 @0x0A): 32 -> Y starts 0x30 after n;
64 -> Y starts 0x38 after n and is followed by four string lists (per-record metadata).
X is uniform: x[i] = x0 + i*dx.
"""
import struct
import numpy as np

NEG3 = struct.pack('<3d', -1.0, -1.0, -1.0)
WIN = 0x460  # the numeric header always ends within this many bytes of the record start


def _sstr(b, o):
    n = b[o]
    return b[o + 1:o + 1 + n].decode('latin-1', 'replace')


def _locate(b, s):
    """Find (offset of n, n, x0, dx) in the record header starting at s, or None."""
    o = s + 0x340
    while True:
        o = b.find(NEG3, o, s + WIN)
        if o < 0:
            return None
        p = o + 24
        n = struct.unpack_from('<i', b, p)[0]
        if 2 <= n <= 2_000_000:
            z1, z2, one = struct.unpack_from('<3d', b, p - 0x30)
            x0, dx = struct.unpack_from('<2d', b, p - (0x50 if (one == 1.0 and z1 == 0 and z2 == 0) else 0x28))
            if np.isfinite(x0) and np.isfinite(dx) and dx != 0 and abs(x0) < 1e7 and abs(dx) < 1e5:
                return p, n, x0, dx
        o += 1


def read_sgdr(path):
    """Yield dicts {title, xlabel, method, x, y, path} for every spectrum in the file."""
    b = open(path, 'rb').read()
    assert b[2:10] == b'SGSpecDB', 'not a Spectragryph database'
    k_cat, count = struct.unpack_from('<2i', b, 0x12)

    def start(p):  # record start for a record whose idx field is at p
        if p + 6 > len(b):
            return None
        s = p + 6 + struct.unpack_from('<H', b, p + 4)[0] + 4 * k_cat
        return s if s + 0x3A0 < len(b) else None

    fmt = struct.unpack_from('<d', b, 0x0A)[0]
    gap = 0x30 if fmt <= 32 else 0x38  # distance from n to the first Y value
    p, out = 0x1A, 0
    while True:
        s = start(p)
        loc = _locate(b, s) if s is not None else None
        if loc is None:
            if out < count - 1:  # the header count is off by one in some files
                raise ValueError(f'{path}: lost sync at record {out} (offset {p:#x})')
            return
        n_at, n, x0, dx = loc
        method = struct.unpack_from('<i', b, s - 4 * k_cat)[0] if k_cat else -1
        yield dict(method=method, title=_sstr(b, s + 0x100), path=_sstr(b, s), xlabel=_sstr(b, s + 0x233),
                   x=x0 + dx * np.arange(n), y=np.frombuffer(b, '<f8', n, n_at + gap))
        out += 1
        p = n_at + gap + 8 * n
        if fmt > 32:  # newer files: four string lists (uint16 count, then uint16-length strings)
            for _ in range(4):
                if p + 2 > len(b):
                    return
                c = struct.unpack_from('<H', b, p)[0]
                p += 2
                for _ in range(c):
                    p += 2 + struct.unpack_from('<H', b, p)[0]


if __name__ == '__main__':
    import sys
    recs = list(read_sgdr(sys.argv[1]))
    print(len(recs), 'spectra')
    for r in recs[:4] + recs[-2:]:
        print(f"m={r['method']} {r['title'][:50]!r:54} {r['xlabel'][:20]!r:22} n={len(r['x'])} "
              f"x={r['x'][0]:.1f}..{r['x'][-1]:.1f} y={r['y'].min():.3g}..{r['y'].max():.3g}")
