"""Wavenum local API. Run:  python backend/main.py   (serves the built UI on http://127.0.0.1:8765)

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
"""
import os
import sys
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analysis  # noqa: E402
import library  # noqa: E402
import maps  # noqa: E402
import matching  # noqa: E402
import peaks as pk  # noqa: E402
import processing  # noqa: E402

app = FastAPI(title='Wavenum')
# On a hosted deployment (Vercel sets VERCEL=1) the filesystem is read-only and shared:
# building or importing libraries is only possible when Wavenum runs on your own computer.
READ_ONLY = bool(os.environ.get('VERCEL') or os.environ.get('WAVENUM_READ_ONLY'))
READ_ONLY_MSG = 'Not available in the hosted version: run Wavenum on your own computer to build or import libraries'
DIST = Path(__file__).resolve().parent.parent / 'frontend' / 'dist'
EXAMPLES = Path(__file__).resolve().parent.parent / 'samples' / 'examples'


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


class McReq(FitReq):
    runs: int = 100
    max_shift: float = 5.0
    seed: int = 1


@app.post('/api/peaks/mc')
def mc_fit(r: McReq):
    if not 2 <= r.runs <= 1000:
        raise HTTPException(400, 'Runs must be between 2 and 1000')
    return _guard(pk.mc_fit, r.x, r.y, r.centers, r.profile, r.xmin, r.xmax, r.runs, r.max_shift, r.seed)


@app.post('/api/map/wdf')
async def map_wdf(file: UploadFile = File(...)):
    """Renishaw map -> binary payload (see maps.py); text maps are read in the browser."""
    try:
        return Response(maps.wdf_map(file.filename, await file.read()), media_type='application/octet-stream')
    except Exception as e:
        raise HTTPException(400, f'Could not read {file.filename} as a Renishaw map: {e}')


@app.get('/api/config')
def config():
    return dict(read_only=READ_ONLY, desktop=False)


@app.get('/api/stats')
def stats():
    return library.stats()


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


# --- bundled example files for learning the app
@app.get('/api/examples')
def examples():
    import json
    p = EXAMPLES / 'examples.json'
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else []


@app.get('/api/examples/{name}')
def example_file(name: str):
    p = (EXAMPLES / name).resolve()
    if p.parent != EXAMPLES.resolve() or not p.is_file():
        raise HTTPException(404, 'No such example file')
    return FileResponse(p)


# --- download + build the full reference libraries in the background
_build = dict(running=False, step='', done=0, total=0, log=[], error=None)


def _run_build():
    import build_library as B
    import download_databases as D
    steps = [('Downloading Spectragryph / RRUFF collections', D.spectragryph), ('Downloading Raman Open Database', D.rod),
             ('Downloading COD mineral structures', D.cod), ('Building starter library', B.build_starter), ('Building FTIR starter library', B.build_starter_ftir),
             ('Computing XRD patterns (COD)', B.build_cod), ('Building Spectragryph / RRUFF libraries', B.build_sgd),
             ('Building Raman Open Database library', B.build_rod)]
    try:
        for i, (name, fn) in enumerate(steps):
            _build.update(step=name, done=i, total=len(steps))
            fn()
            _build['log'].append(f'{name}: done')
        _build.update(step='Finished', done=len(steps))
    except Exception as e:  # report to the UI instead of dying silently in the thread
        _build['error'] = f'{_build["step"]}: {e}'
    finally:
        _build['running'] = False


@app.post('/api/libraries/build')
def build_libraries():
    if READ_ONLY:
        raise HTTPException(403, READ_ONLY_MSG)
    if _build['running']:
        raise HTTPException(409, 'A build is already running')
    _build.update(running=True, step='Starting', done=0, total=7, log=[], error=None)
    threading.Thread(target=_run_build, daemon=True).start()
    return _build


@app.get('/api/libraries/build/status')
def build_status():
    return _build


class ImportReq(BaseModel):
    folder: str
    technique: str = 'raman'
    title: Optional[str] = None


@app.post('/api/libraries/import')
def import_library(r: ImportReq):
    if READ_ONLY:
        raise HTTPException(403, READ_ONLY_MSG)
    return _guard(library.import_folder, r.folder, r.technique, r.title)


if DIST.exists():
    app.mount('/', StaticFiles(directory=DIST, html=True), name='ui')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8765)
