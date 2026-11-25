Wavenum Sample Test Pack
========================

Included synthetic, spec-compliant sample files:
1. quartz_raman.csv             - 2-column CSV (Quartz Raman with fluorescence baseline + 1 cosmic ray spike at 950 cm-1)
2. calcite_rruff_raman.txt      - RRUFF-style ASCII .txt file with metadata headers (Calcite Raman)
3. multi_minerals_raman.xlsx    - Multi-column Excel workbook (Quartz, Calcite, Hematite) to test column selection
4. quartz_powder_xrd.xy         - 2-column Powder XRD pattern (10-80 deg 2-theta, Cu K-alpha)
5. calcite_ftir_descending.jdx  - Standard JCAMP-DX FTIR spectrum (descending 4000 -> 400 cm-1)
6. quartz_sample.xrdml          - PANalytical XRDML XML scan file (Alpha-Quartz)
7. alpha_quartz.cif             - Crystallographic Information File (.cif) for Alpha-Quartz (P 32 2 1)
8. hematite_raman_figure.png    - Clean spectrum image for testing the Plot Digitizer
9. hematite_raman_figure.pdf    - Clean 1-page PDF spectrum figure for testing PDF Digitizer
10. graphite_cm_raman.csv      - Synthetic carbonaceous matter Raman (D1, G, D2 bands) for the carbon geothermometers

Note on Proprietary Binary Vendor Formats (.wdf, .0 OPUS, .spa, .spc):
Because proprietary binary instrument files have complex vendor-specific headers, test those with real instrument files from open-source test suites (links provided in chat).
