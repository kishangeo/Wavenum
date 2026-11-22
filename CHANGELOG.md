# Changelog

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

## Unreleased
- Community minerals pack (databases/community): new meteorite shock minerals from published Raman peaks
  (wangdaodeite, akimotoite, hemleyite, majorite, calculated poirierite), the El Ali meteorite phosphates (elaliite,
  elkinstantonite, olsenite) and recent minerals from Eur. J. Mineral. (ellinaite, nannoniite, moabite, silesiaite,
  kenoargentotetrahedrite-(Zn), batoniite, belmonteite): and shock minerals from the type descriptions (tissintite, ahrensite,
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
