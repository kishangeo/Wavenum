# Community minerals pack

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>

Reference peaks for minerals that are not yet in RRUFF or the Raman Open Database, mostly new
high-pressure (shock) minerals from meteorites, taken from the published papers. Wavenum draws each
entry as Lorentzian bands and searches it like any other library ("Community minerals (literature
peaks)" in the Mineral ID tab). Each match shows the source DOI.

## Adding a mineral

Add an entry to `minerals.json` and open a pull request:

```json
{
  "name": "Mineral name",
  "formula": "Chemical formula",
  "system": "crystal system",
  "technique": "raman",   (or "ftir", "xrd")
  "peaks": [[position_cm-1, relative_intensity_0_to_100], ...],
  "source": "doi:10.xxxx/xxxxx",
  "note": "Locality, sample, and anything a user should know (e.g. calculated, approximate intensities)."
}
```

`technique` is `raman`, `ftir` (band positions in cm-1) or `xrd` (peaks are
`[d-spacing in angstrom, relative intensity]`). Take positions from the paper's text or table, not by
guessing; say in `note` if intensities are approximate or the bands are calculated. A GitHub
workflow checks every entry and rebuilds the library when the pack changes.

## How updates reach users

- Website: the rebuilt library is deployed with the next update of the site.
- Desktop app and local install: **Download & build full libraries** (Mineral ID tab) fetches the
  latest pack from GitHub along with the newest RRUFF, ROD and COD data.
