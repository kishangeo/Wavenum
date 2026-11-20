"""Wavenum local API. Run:  python backend/main.py   (serves the built UI on http://127.0.0.1:8765)

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
"""
import base64
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis  # noqa: E402
import library  # noqa: E402
import matching  # noqa: E402
import peaks as pk  # noqa: E402
import processing  # noqa: E402

app = FastAPI(title='Wavenum')
DIST = Path(__file__).resolve().parent.parent / 'frontend' / 'dist'


def _guard(fn, *a, **k):
    try:
        return fn(*a, **k)
    except (ValueError, KeyError, IndexError, FileNotFoundError, AssertionError) as e:
        raise HTTPException(400, str(e))


@app.post('/api/parse')
async def parse(file: UploadFile = File(...)):
    return _guard(processing.parse_file, file.filename, await file.read())


class ProcessReq(BaseModel):
    x: list[float]
    y: list[float]
    steps: list[dict]


@app.post('/api/process')
def process(r: ProcessReq):
    return _guard(processing.run_pipeline, r.x, r.y, r.steps)


class FindReq(BaseModel):
    x: list[float]
    y: list[float]
    prominence: float = 0.05
    height: float = 0.0
    distance: float = 10.0


@app.post('/api/peaks/find')
def find(r: FindReq):
    return _guard(pk.find, r.x, r.y, r.prominence, r.height, r.distance)


class FitReq(BaseModel):
    x: list[float]
    y: list[float]
    centers: list[float]
    profile: str = 'lorentzian'
    xmin: Optional[float] = None
    xmax: Optional[float] = None


@app.post('/api/peaks/fit')
def fit(r: FitReq):
    return _guard(pk.fit, r.x, r.y, r.centers, r.profile, r.xmin, r.xmax)


@app.get('/api/libraries')
def libraries():
    return library.list_libraries()


class MatchReq(BaseModel):
    x: list[float]
    y: list[float]
    technique: str
    libraries: list[str]
    tolerance: float = 8.0
    weights: list[float] = [0.4, 0.2, 0.4]
    mixture: bool = False
    peaks: Optional[list[list[float]]] = None
    wavelength: float = matching.CU_KA
    n: int = 10
    auto_baseline: bool = False


@app.post('/api/match')
def match(r: MatchReq):
    return _guard(matching.match, r.x, r.y, r.technique, r.libraries, r.tolerance, r.weights, r.mixture,
                  r.peaks, r.wavelength, r.n, r.auto_baseline)


@app.get('/api/libraries/search')
def library_search(q: str, technique: str):
    return library.search(q, technique)


@app.get('/api/libraries/entry')
def library_entry(lib: str, k: int):
    return _guard(library.entry, lib, k)


class PcaReq(BaseModel):
    spectra: list[dict]
    clusters: int = 0
    norm: str = 'snv'


@app.post('/api/pca')
def pca(r: PcaReq):
    return _guard(analysis.pca, r.spectra, r.clusters, r.norm)


class ImportReq(BaseModel):
    folder: str
    technique: str = 'raman'
    title: Optional[str] = None


@app.post('/api/libraries/import')
def import_library(r: ImportReq):
    return _guard(library.import_folder, r.folder, r.technique, r.title)


@app.post('/api/pdf')
async def pdf_page(file: UploadFile = File(...), page: int = 1):
    """Render one PDF page to PNG for the digitizer."""
    import fitz
    try:
        doc = fitz.open(stream=await file.read(), filetype='pdf')
        png = doc[max(0, min(page, len(doc)) - 1)].get_pixmap(dpi=150).tobytes('png')
    except Exception as e:
        raise HTTPException(400, f'Could not read PDF: {e}')
    return dict(pages=len(doc), image='data:image/png;base64,' + base64.b64encode(png).decode())


if DIST.exists():
    app.mount('/', StaticFiles(directory=DIST, html=True), name='ui')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8765)
