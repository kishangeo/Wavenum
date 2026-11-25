# Changelog

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

## 0.12.2 (2026-11-25)
- Mineral ID keeps its library list when you switch tabs and come back (it showed 0 entries).
- Library browser: a slow reply to an earlier search no longer replaces the results of the current one.
- Monte Carlo deconvolution sends fewer fits per request when many peaks are marked, so runs with 10 peaks finish on the website.
- Header: shorter reference-data summary on mid-width screens, so the theme button no longer wraps in XRD mode.
- New example: carbonaceous matter Raman (D and G bands) to try the carbon geothermometers.
- UCL pigment names lose their trailing semicolons; release binaries no longer contain local build paths.

## 0.12.1 (2026-11-25)
- specDB .mat files are read in the browser on the website (no upload; the hosted site rejected these large files), switch to FTIR and plot the first spectrum at once; the picker offers the rest.

## 0.12.0 (2026-11-25)
- Import specDB MATLAB FTIR databases (.mat v7.3): pick any or all of the stored spectra; spot maps load as their mean.
- Vercel Web Analytics on the website only (the desktop app makes no analytics calls); privacy policy updated.

## 0.11.1 (2026-11-24)
- Desktop app: Google Tag Manager is loaded on the website only, so the desktop app makes no analytics calls.
- Privacy policy states the website's Google Analytics use; Privacy link in the Help window.

## 0.11.0 (2026-11-24)
- Digitizer: axis-calibration labels (Xmin, Xmax, Ymin, Ymax) stay on one line with their icons.
- Phones: the Raman / XRD / FTIR switch gets its own full-width row under the logo, theme and Help buttons, and tool tab
  labels stay on one line.
- Desktop app: the installer now carries every reference library (RRUFF Raman and FTIR, pigments, microplastics,
  polymers, drugs and the others, besides ROD and COD XRD), so nothing has to be downloaded or built after installing.
- Desktop app: exports (figures, CSV, presets, sessions) open a Save As dialog to choose the folder and name, and links (website, release
  notes, manual) open in the system browser. Before, both did nothing.
- Tablets: the header fits on one line (the tagline shows on wide screens only).
- Desktop app packaged for the Microsoft Store; privacy policy page (/privacy.html).

## 0.10.2 (2026-11-23)
- Plot toolbar moved to a vertical column in its own margin, so it no longer overlaps the legend (spectrum, PCA and map
  plots). Exported figures are unchanged.

## 0.10.1 (2026-11-23)
- Interface refresh: white header, segmented technique switch, panels separated by hairline gaps, one corner radius,
  softer buttons and cards, system UI font.
- Accessibility: visible keyboard focus rings, tool tabs announced as tabs, error messages read out by screen readers,
  help window as a proper modal, dark scrollbars and menus in dark mode, reduced motion respected.

## 0.10.0 (2026-11-23)
- Match weights with peaks only now score the peaks of every library entry (before, the candidates were not ranked first, so
  the result was arbitrary).
- Mixture check rewritten: candidate phases come from the sample and from what each of the three best single phases leaves
  unexplained, every pair is scored like a single reference, and a mixture is flagged only when both phases have their own
  peaks in the spectrum. In tests it names both phases more often and flags far fewer pure spectra.
- Community pack: XRD patterns for reidite, hemleyite and elgoresyite, calculated from Crystallography Open Database structures.

## 0.9.1 (2026-11-22)
- CIF files load on the website: the atomic scattering table now ships with the backend.
- Google Search Console verification.

## 0.9.0 (2026-11-22)
- robots.txt and sitemap.xml for search engines.
- CIF files load on the website and without pymatgen: a built-in reader (backend/crystal.py, a port of the
  desktop app's) computes the powder pattern, giving the same peaks as pymatgen.
- Community minerals pack (databases/community): new meteorite shock minerals from published Raman peaks
  (wangdaodeite, akimotoite, hemleyite, majorite, calculated poirierite), the El Ali meteorite phosphates (elaliite,
  elkinstantonite, olsenite) and recent minerals from Eur. J. Mineral. (ellinaite, nannoniite, moabite, silesiaite,
  kenoargentotetrahedrite-(Zn), batoniite, belmonteite) and shock minerals from the type descriptions (tissintite, ahrensite,
  donwilhelmsite, zagamiite, reidite, xieite, liebermannite, lingunite, kopernikite): 24 Raman entries, each with
  its source DOI.
- The community pack also takes XRD entries (d-spacings; kopernikite from its published structure) and FTIR entries.
- Download & build full libraries also fetches the latest community pack; a GitHub workflow checks new entries
  and rebuilds the library.

## 0.8.1 (2026-11-22)
- Monte Carlo fits run in batches of 10 with a progress bar, so the hosted site no longer times out.
- Example maps can be opened from the Data panel's example list; PCA labels keep the end of long names;
  the legend no longer sits under the plot toolbar; pipeline delete buttons use an icon.

## 0.8.0 (2026-11-21)
- Layout for phones and tablets: one panel at a time on phones (Data, Plot, Tools bar), plot beside a side panel on
  tablets; popovers stay on screen; no Plotly toolbar on touch screens.

## 0.7.1 (2026-11-21)
- Include the user manual (frontend/public/manual.html), which 0.7.0 left out of the repository because of
  an over-broad ignore rule.

## 0.7.0 (2026-11-21)
- H₂O quantification from FTIR (Beer–Lambert, after SpecXY/SpecDB) for spectra, fitted peaks and maps, with
  published absorption coefficients for pyroxenes, garnet, olivine and plagioclase and the Libowitzky &
  Rossman (1997) general calibration.
- User manual (20 sections) in the app under Help, saved as PDF from the print dialog; also at /manual.html.
- Version number in the header, linking to the release notes.
- The header shows the reference data searched for the current technique: spectra, distinct phases and libraries.
- Map layers without any values (e.g. a band window outside the axis) are refused with a message.

## 0.6.0 (2026-11-21)
- Monte Carlo peak deconvolution after SpecXY: repeated fits from random starts with a per-peak maximum shift,
  mean ± sd per parameter, histograms and a CSV of all runs.
- CITATION.cff, Zenodo metadata and this changelog.

## 0.5.0 (2026-11-21)
- Map tab: Raman, FTIR, XRD and element maps; intensity, area, ratio, position, FWHM and quality maps;
  calculator, masks, k-means classes, region means and line profiles; Renishaw .wdf maps.
- Figure export as PNG, JPG, TIFF, EPS, SVG or PDF at a chosen DPI; curve selector.
- New despike that keeps narrow real peaks; FTIR starter library; plot refresh and interface fixes.

## 0.4.0 (2026-11-21)
- Vercel deployment with a read-only hosted mode.

## 0.3.1 (2026-11-21)
- Screenshot in the README.

## 0.3.0 (2026-11-21)
- Example files for every supported format, with an Examples menu.

## 0.2.0 (2026-11-21)
- In-app download and build of the reference libraries; fixes to ROD parsing, CIF tags and the XRD wavelength.

## 0.1.1 (2026-11-21)
- Area normalization on NumPy 2; digitizer PDFs rendered with pdf.js.

## 0.1.0 (2026-11-21)
- First public release.
