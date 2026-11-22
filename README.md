<p align="center">
  <img src="frontend/public/logo.svg" alt="Wavenum logo" width="96" height="96">
</p>

<h1 align="center">Wavenum</h1>

<p align="center">
  Local-first Raman, FTIR and XRD processing, peak analysis and mineral identification.<br>
  Created by <a href="https://kishangeo.github.io/">Kishan Tiwari</a><br><br>
  <a href="https://doi.org/10.5281/zenodo.24421170"><img src="https://zenodo.org/badge/DOI/10.5281/zenodo.24421170.svg" alt="DOI 10.5281/zenodo.24421170"></a>
</p>

---

<p align="center">
  <img src="docs/screenshot.jpg" alt="Wavenum identifying a quartz Raman spectrum: processing pipeline on the left, mirror plot of sample against the quartz reference in the centre, ranked library matches on the right" width="100%">
  <br><em>A quartz Raman spectrum after despiking and baseline correction, identified against the libraries (mirror plot: sample above, reference below).</em>
</p>

Wavenum is a browser-based spectroscopy workbench with a small Python backend. It runs entirely on
your own computer: spectra are never uploaded anywhere. It was built for identifying minerals in
meteorites and rocks, and also works for pigments, polymers and other materials covered by the
bundled reference libraries.

## Features

**Data in and out**
- Drag-and-drop loading of text tables (`.txt .csv .xy .dat …`, delimiter and header detection, column picker),
  Excel, JCAMP-DX, Thermo SPC, Nicolet SPA, Bruker OPUS, Agilent ASP, PANalytical XRDML, Rigaku RAS,
  Bruker UXD, Renishaw WDF and CIF (loaded as a computed powder pattern). See [File formats](#file-formats).
- Plot digitizer: extract a spectrum from a PNG/JPG or a PDF page with four-point axis calibration.
- Example files for learning: **Open an example file…** in the sidebar loads Raman, FTIR and XRD examples
  in each common format (CSV, RRUFF text, Excel, JCAMP-DX, `.xy`, XRDML, CIF) plus figures for the digitizer
  (`samples/examples`).
- Export processed data (`.csv`/`.txt`), peak tables, PCA scores, and publication figures as PNG, JPG,
  TIFF, EPS, SVG or PDF (vector) at 150–1200 DPI, with the size in mm (journal column presets), font,
  labels, ticks and legend. The DPI is written into PNG, JPG and TIFF files.
- **Curve selector:** choose which curves are shown (each spectrum, baseline, fit, components, residual,
  reference, peak markers); the plot and the exported figure follow the selection.
- Save and reopen a whole workspace as a `.wavenum.json` session.

**Processing** — a non-destructive pipeline per spectrum: every step can be toggled, reordered, undone,
saved as a JSON preset and batch-applied to all spectra.
- Crop, cosmic-ray despiking (paired up/down jumps in the modified z-score, so narrow real peaks are kept), baseline (ALS, airPLS, iterative polynomial, rubberband,
  with baseline overlay), Savitzky–Golay or moving-average smoothing, normalization (min–max, vector,
  area, SNV), derivatives, unit conversion (transmittance ↔ absorbance, nm → Raman shift), resampling,
  x-axis calibration shift.
- Overlay or stacked views; average spectra; scaled spectral subtraction.

**Peaks**
- Automatic peak finding (prominence, height, distance) plus click-to-add/remove.
- Gaussian, Lorentzian and Voigt fitting with components, residuals and a table of centre, height,
  FWHM, area and R²; XRD d-spacings.
- **Monte Carlo deconvolution** (after SpecXY, Gies et al. 2024): the fit is repeated up to 1,000 times from
  random starting positions, widths and heights, with each peak limited to a maximum shift. It reports mean ± sd
  of position, FWHM, area and height over the runs within a chosen R² of the best, a histogram per peak and
  parameter, and a CSV of every run, so you can see how well each parameter is constrained.
- **Olivine composition** from the ~820/850 cm⁻¹ doublet (Kuebler et al. 2006).
- **Carbonaceous-matter thermometry** from fitted D and G bands (Beyssac et al. 2002; Kouketsu et al. 2014;
  Busemann et al. 2007), with each calibration's fitting protocol shown alongside.

**Identification**
- Library search scored by cosine similarity, Pearson correlation and shift-tolerant peak matching
  (adjustable weights and tolerance), with a mirror plot of sample against reference.
- Automatic baseline correction of the search copy, so raw spectra can be searched directly.
- Two-component mixture check (non-negative least squares on the residual).
- **Cross-technique identification:** load Raman, FTIR and/or XRD data of the same sample and list the
  phases supported by more than one technique.
- Library browser: look up any reference by mineral name or formula and overlay it.
- Import your own folders of RRUFF-style `.txt` spectra as additional libraries.

**H₂O quantification** (FTIR; after SpecXY/SpecDB, Gies et al. 2024, Eq. 9)
- Beer–Lambert water content from the integrated O–H absorbance of a spectrum or of fitted peaks:
  c = 10⁶ · M(H₂O) · f · A / (t · ρ · ε), with thickness, density and orientation factor (sum of three
  polarised spectra, isotropic, or unpolarised random grains).
- Absorption coefficients: Libowitzky & Rossman 1997 (wavenumber-dependent, any mineral), Bell et al. 1995
  (clinopyroxene, orthopyroxene, garnet), Bell et al. 2003 and Withers et al. 2012 (olivine), Johnson &
  Rossman 2003 (plagioclase), or your own ε.
- On FTIR maps the same calibration turns an integrated-absorbance map into a ppm H₂O map.

**Chemometrics** — PCA scores and loadings with optional k-means grouping.

**Maps** (Map tab, after SpecXY; Gies et al. 2024, [doi:10.1016/j.cageo.2024.105626](https://doi.org/10.1016/j.cageo.2024.105626))
- Load Raman, FTIR or XRD maps from text (wide `X, Y, spectrum…`, long `X, Y, shift, intensity`, or the SpecXY
  matrix with the signal axis in column 1), Renishaw `.wdf` maps, line and depth scans, and element maps
  (EPMA, EDS, LA-ICP-MS value grids or images) as layers of the same area.
- Map types: intensity at a position, band area with a linear baseline, ratio and log ratio of two
  bands, band position, FWHM and a signal quality index; calibration factor and 0–1 normalisation.
- Map calculator (A + − × ÷ B), masks by value range, k-means classes of the spectra with class means
  sent to the workspace, pixel spectra, region means and line profiles, CSV export of every layer.
- An example Raman map with matching SiO₂, CaO and Fe₂O₃ element maps is in **Open an example map…**.

## User manual

The full manual is built into the app: click **Help** in the header (it can be saved as a PDF from there).
It is also on the website at [wavenum.vercel.app/manual.html](https://wavenum.vercel.app/manual.html) and in
this repository as [`frontend/public/manual.html`](frontend/public/manual.html).

The header shows the version and how much reference data Wavenum is searching for the selected technique
(spectra, distinct phase names and libraries), counted from the libraries actually installed.

## Installation

Requirements: Python 3.10 or newer, and Node.js 18 or newer (only to build the interface).

```bash
git clone https://github.com/kishangeo/Wavenum.git
cd Wavenum

python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-xrd.txt   # optional: building the COD XRD library (pymatgen); .cif files load without it

cd frontend
npm ci
npm run build
cd ..
```

## Running

```bash
python backend/main.py
```

Then open <http://127.0.0.1:8765>. On Windows, `run.bat` starts the server and opens the browser.

## Deploying to Vercel

The repository includes a `vercel.json`, so it can be imported into [Vercel](https://vercel.com) as is: the
interface is built into static files and the Python backend runs as a function (`app.py`). The hosted version
differs from running Wavenum on your own computer:

- **Spectra are sent to the server** for processing, so it is no longer local-only. Use your own computer for
  unpublished data.
- It is read-only: *Download & build full libraries* and folder *Import* are switched off, and only the
  libraries in the repository (ROD, the COD-derived XRD patterns and the Raman and FTIR starter sets) are available.

To try the same read-only mode locally, set `WAVENUM_READ_ONLY=1` before starting the server.

## Reference libraries

The repository ships with the libraries whose licences allow redistribution, so identification works
straight after installation:

| Technique | Library | Entries | Licence |
|---|---|---|---|
| Raman | Raman Open Database (ROD) | 1,131 | CC0 |
| Raman | Starter minerals (synthetic profiles at literature peak positions) | 31 | MIT (this project) |
| Raman | [Community minerals](databases/community/README.md): recently described minerals (meteorite shock phases, El Ali phosphates and others) from published Raman peaks, source DOI per entry | 24 | MIT (this project) |
| XRD | [Community minerals](databases/community/README.md): d-spacings from published structures | 1 | MIT (this project) |
| FTIR | Starter minerals (synthetic profiles at RRUFF infrared band positions) | 38 | MIT (this project) |
| XRD | COD mineral structures 9000000–9017999 (AMCSD-derived), powder patterns computed for Cu Kα (1.54184 Å) | 14,343 (4,107 minerals) | CC0 |

The full set adds about 10,000 more spectra, including the RRUFF Raman and infrared collections. These
are not redistributed here. Click **Mineral ID → Download & build full libraries** in the app, or run
(about 450 MB; files already downloaded are reused). Running it again updates the libraries: new Raman Open
Database entries and the latest [community minerals pack](databases/community/README.md) are fetched.

```bash
python backend/download_databases.py
python backend/build_library.py
```

| Technique | Library | Entries |
|---|---|---|
| Raman | RRUFF Raman (excellent quality) | 5,185 |
| Raman | RRUFF Raman | 3,087 |
| Raman | CHSOS pigments, UCL pigments, SLoPP/SLoPP-E microplastics, carbohydrates, pharmaceutical excipients | 613 |
| FTIR | RRUFF infrared | 882 |
| FTIR | Kimmel Center, Primpke microplastics, SWGDRUG, PSLC polymers, Archaeometrielabor | 1,546 |

These come from the [Spectragryph database collection](https://www.effemm2.de/spectragryph/down_databases.html)
(RRUFF as a 2017 snapshot), read with a reverse-engineered `.sgdr` reader (`backend/sgd.py`).
Newer RRUFF data can be added with *Mineral ID → Import* pointing at an unzipped RRUFF folder.

Please cite the original data owners when you publish matches: RRUFF (Lafuente et al. 2015),
ROD (El Mendili et al. 2019), COD (Gražulis et al. 2009), AMCSD (Downs & Hall-Wallace 2003), and the
owners listed on the Spectragryph page for the other collections.

## File formats

| Format | Extensions | Tested |
|---|---|---|
| Delimited text, RRUFF text | `.txt .csv .xy .xye .dat .asc .dpt .prn` | yes |
| Excel | `.xlsx` | yes |
| JCAMP-DX | `.jdx .dx .jcm .jcamp` | yes, real file |
| Thermo / Galactic SPC | `.spc` (new format) | yes, real file |
| Nicolet OMNIC | `.spa` | yes, real file |
| Bruker OPUS | `.0 .1 …` | yes, real file |
| Agilent | `.asp` | yes, real file |
| Crystal structure | `.cif` | yes |
| PANalytical | `.xrdml` | synthetic input only |
| Rigaku | `.ras` | synthetic input only |
| Bruker / Siemens | `.uxd` | synthetic input only |
| Renishaw WiRE | `.wdf` (single spectra, maps, line and depth scans) | yes, real files |

Files containing several spectra load the first non-empty one in the workspace; open them in the Map tab to use all of them. Old-format SPC, Horiba, WITec, Bruker
`.raw/.brml` and PerkinElmer `.sp` are not supported; export those to text or JCAMP-DX.
Sample files and bug reports for any format are welcome.

## Calibrations used

| Calculator | Equation | Source |
|---|---|---|
| Olivine Fo | Eqs. (1)–(3), Table 4 coefficients; ±10 Fo for the two-peak form | Kuebler, Jolliff, Wang & Haskin (2006), *GCA* 70, 6201–6222, [doi:10.1016/j.gca.2006.07.035](https://doi.org/10.1016/j.gca.2006.07.035) |
| CM temperature (R2) | T = −445·R2 + 641; 330–650 °C, ±50 °C | Beyssac et al. (2002), *J. Metamorph. Geol.* 20, 859–871, [doi:10.1046/j.1525-1314.2002.00408.x](https://doi.org/10.1046/j.1525-1314.2002.00408.x) |
| CM temperature (D1, D2 width) | T = −2.15·FWHM-D1 + 478; T = −6.78·FWHM-D2 + 535; c. 150–400 °C | Kouketsu et al. (2014), *Island Arc* 23, 33–50, [doi:10.1111/iar.12057](https://doi.org/10.1111/iar.12057) |
| Chondrite PMT | PMT = 931 − 5.10·ΓD + 0.0091·ΓD² | Busemann, Alexander & Nittler (2007), *MAPS* 42, 1387–1416, [doi:10.1111/j.1945-5100.2007.tb00581.x](https://doi.org/10.1111/j.1945-5100.2007.tb00581.x) |

Each thermometer is valid only with the fitting protocol of its paper (band model, profile, laser);
the interface summarises these next to the result.

## Known limitations

- Library spectra are stored on a 2 cm⁻¹ grid as 8-bit intensities: ample for matching, not for quantitative work.
- XRD references are ideal powder patterns (no preferred orientation, fixed peak width); cells with more than
  400 atoms are skipped.
- Mixture fractions are spectral weights, not modal abundances.
- The digitizer assumes linear axes.
- EPS figures are embedded high-resolution images; use PDF or SVG for vector output.
- Maps are held in memory in the browser (a 100 × 100 map of 1,000-point spectra uses about 40 MB).
- Each spectrum belongs to the technique selected when it was loaded.

## Development

| Path | Contents |
|---|---|
| `backend/main.py` | FastAPI app; serves the built interface |
| `app.py`, `vercel.json` | Vercel entry point and build configuration |
| `backend/processing.py` | text parsing and the preprocessing pipeline |
| `backend/formats.py` | instrument file readers |
| `backend/peaks.py` | peak finding and fitting |
| `backend/matching.py` | library matching and mixture check |
| `backend/library.py` | library storage, search and folder import |
| `backend/analysis.py` | PCA and k-means |
| `backend/sgd.py` | Spectragryph `.sgdr` reader |
| `backend/download_databases.py`, `build_library.py` | fetch and index the reference data |
| `frontend/` | React, TypeScript, Tailwind CSS and Plotly interface |

Self-checks: `python backend/processing.py`, `peaks.py`, `formats.py` and `analysis.py` each print `ok`.
For interface work run `npm run dev` in `frontend/` (it proxies `/api` to the backend on port 8765).

## Citing Wavenum

If Wavenum helps your research, please cite it as:

> Tiwari, K. (2026). *Wavenum: local-first Raman, FTIR and XRD processing and mineral identification* (version 0.9.0).
> Zenodo. https://doi.org/10.5281/zenodo.24421170

This DOI always resolves to the latest version; each release also has its own DOI on Zenodo
(0.6.0: [10.5281/zenodo.24421171](https://doi.org/10.5281/zenodo.24421171); 0.7.1: [10.5281/zenodo.24421683](https://doi.org/10.5281/zenodo.24421683); 0.8.0: [10.5281/zenodo.24424618](https://doi.org/10.5281/zenodo.24424618); 0.8.1: [10.5281/zenodo.24433269](https://doi.org/10.5281/zenodo.24433269); 0.9.0: [10.5281/zenodo.24434188](https://doi.org/10.5281/zenodo.24434188)). [CITATION.cff](CITATION.cff) has the details.

## Licence

Code: MIT, see [LICENSE](LICENSE). Bundled reference data keep their own licences (see above).

Contact: Kishan Tiwari, kishantiwari@iitkgp.ac.in · <https://kishangeo.github.io/>
