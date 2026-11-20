// Peak Analyzer tab: auto/manual peaks, profile fitting, peak table. Author: Kishan Tiwari
import { useEffect, useState } from 'react'
import { api, dataOf, download, useActive, useStore, type Fit, type FitRow, type Peak } from './store'

// Carbonaceous-matter Raman parameters from fitted D and G bands, with published thermometers.
// Equations checked against the papers:
//   Beyssac et al. (2002) J. Metamorph. Geol. 20, 859-871, eq. (1): T = -445 R2 + 641, R2 = D1/(G+D1+D2) areas
//   Kouketsu et al. (2014) Island Arc 23, 33-50, Eqs. 1-2 (Fig. 7): T = -2.15 FWHM-D1 + 478; T = -6.78 FWHM-D2 + 535
//   Busemann et al. (2007) MAPS 42, 1387-1416, Eq. (1): PMT = 931 - 5.10 GammaD + 0.0091 GammaD^2
function Carbon({ rows }: { rows: FitRow[] }) {
  const best = (lo: number, hi: number) => rows.filter(r => r.center >= lo && r.center <= hi).sort((p, q) => q.height - p.height)[0]
  const d = best(1300, 1400), g = best(1540, 1605)
  if (!d || !g) return null
  const d2 = rows.find(r => r.center > 1605 && r.center <= 1635 && r !== g)
  const r1 = d.height / g.height
  const r2 = d.area / (d.area + g.area + (d2?.area ?? 0))
  const tB = -445 * r2 + 641, tK = -2.15 * d.fwhm + 478, tK2 = d2 ? -6.78 * d2.fwhm + 535 : NaN, tPMT = 931 - 5.1 * d.fwhm + 0.0091 * d.fwhm ** 2
  const row = (label: string, v: string, note = '') => (
    <div className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums">{v} <span className="text-slate-500">{note}</span></span></div>
  )
  const inR = (t: number, lo: number, hi: number) => (t >= lo && t <= hi ? '' : '(outside calibration)')
  return (
    <div className="card space-y-0.5 text-xs">
      <div className="label">Carbon D / G bands</div>
      {row('D position / FWHM', `${d.center.toFixed(1)} / ${d.fwhm.toFixed(1)} cm⁻¹`)}
      {row('G position / FWHM', `${g.center.toFixed(1)} / ${g.fwhm.toFixed(1)} cm⁻¹`)}
      {row('R1 = I(D)/I(G)', r1.toFixed(3))}
      {row(`R2 = A(D)/A(D+G${d2 ? '+D2' : ''})`, r2.toFixed(3))}
      {row('T, Beyssac et al. 2002', `${tB.toFixed(0)} °C`, inR(tB, 330, 650))}
      {row('T, Kouketsu et al. 2014 (D1 width)', `${tK.toFixed(0)} °C`, inR(tK, 150, 400))}
      {d2 && row('T, Kouketsu et al. 2014 (D2 width)', `${tK2.toFixed(0)} °C`, inR(tK2, 150, 400))}
      {row('PMT, Busemann et al. 2007', `${tPMT.toFixed(0)} °C`)}
      <p className="pt-1 text-[11px] text-slate-500">Each thermometer is only valid with its own fitting protocol. <b>Beyssac 2002</b>: R2 = D1/(G+D1+D2) band areas from Voigt fits, 514.5 nm laser, regional metamorphism, 330–650 °C, ±50 °C. <b>Kouketsu 2014</b>: FWHM of D1 (±30 °C, preferred for 200–400 °C) and of D2 (±50 °C, better for 150–200 °C), applicable c. 150–400 °C while D1 is more intense than G. <b>Busemann 2007</b>: D-band width of chondritic insoluble organic matter, D and G fitted as two Lorentzians on a linear background, 532 nm laser, second-order polynomial fit (R² = 0.95). Here D2 is counted only if you fitted a separate component at 1605–1635 cm⁻¹.</p>
    </div>
  )
}

// Olivine Fo from the ~820 / ~850 cm-1 doublet: Kuebler et al. (2006) GCA 70, 6201-6222,
// Eqs. (1)-(3) with the Table 4 coefficients (transcribed from the paper, signs checked against the PDF).
// Fo = 100 Mg/(Mg+Fe+Mn), molar. x1 = DB1 position, x2 = DB2 position.
export function olivineFo(x1: number, x2: number) {
  return {
    db1: -484679.04514555 + 1172.7260643126 * x1 - 0.70922596841326 * x1 * x1,
    db2: -38847.125692649 + 86.908635300809 * x2 - 0.04838169365694 * x2 * x2,
    both: -206232.988995287 + 80.190397775029 * x1 + 399.350231139156 * x2 - 0.0424363912074934 * x1 * x1 - 0.235797345103088 * x2 * x2,
  }
}

function Olivine({ peaks }: { peaks: { x: number; y: number }[] }) {
  const best = (lo: number, hi: number) => peaks.filter(p => p.x >= lo && p.x <= hi).sort((p, q) => q.y - p.y)[0]
  const p1 = best(812, 828), p2 = best(834, 860)
  if (!p1 || !p2) return null
  const fo = olivineFo(p1.x, p2.x)
  const out = p1.x < 815 || p1.x > 824.7 || p2.x < 837.4 || p2.x > 856.7
  const row = (label: string, v: string, note = '') => (
    <div className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums">{v} <span className="text-slate-500">{note}</span></span></div>
  )
  return (
    <div className="card space-y-0.5 text-xs">
      <div className="label">Olivine doublet → Fo (Kuebler et al. 2006)</div>
      {row('DB1 / DB2 position', `${p1.x.toFixed(1)} / ${p2.x.toFixed(1)} cm⁻¹`)}
      {row('Fo, two-peak (Eq. 3)', fo.both.toFixed(0), '± 10')}
      {row('Fo, DB1 only (Eq. 1)', fo.db1.toFixed(0), 'better for Fe-rich')}
      {row('Fo, DB2 only (Eq. 2)', fo.db2.toFixed(0), 'better for Mg-rich')}
      {out && <p className="text-amber-600 dark:text-amber-400">Peak position outside the calibration data (DB1 815.0–824.7, DB2 837.4–856.7 cm⁻¹): result is an extrapolation.</p>}
      <p className="pt-1 text-[11px] text-slate-500">Fo = 100·Mg/(Mg+Fe+Mn). The calibration assumes peak positions accurate to about ±0.5 cm⁻¹, so calibrate the x axis (e.g. Si 520.7 cm⁻¹) and fit the doublet rather than reading raw maxima. Only shown when both peaks are present; other minerals with bands here will give meaningless values.</p>
    </div>
  )
}

export default function Peaks() {
  const st = useStore()
  const a = useActive()
  const xrd = st.technique === 'xrd'
  const [prom, setProm] = useState(0.05)
  const [height, setHeight] = useState(0)
  const [dist, setDist] = useState(xrd ? 0.3 : 10)
  const [auto, setAuto] = useState(false)
  const [profile, setProfile] = useState('lorentzian')
  const [range, setRange] = useState<[string, string]>(['', ''])
  const [busy, setBusy] = useState(false)

  const find = async () => {
    if (!a) return
    try {
      const d = dataOf(a)
      st.patch(a.id, { peaks: await api<Peak[]>('/peaks/find', { x: d.x, y: d.y, prominence: prom, height, distance: dist }), fit: undefined })
    } catch (e) { st.fail(e) }
  }
  // live preview while dragging sliders
  useEffect(() => {
    if (!auto) return
    const t = setTimeout(find, 80)
    return () => clearTimeout(t)
  }, [prom, height, dist, auto, a?.proc])

  if (!a) return <p className="text-xs text-slate-500">Load a spectrum to analyse peaks.</p>

  const fit = async () => {
    setBusy(true)
    try {
      const d = dataOf(a)
      const r = await api<Fit>('/peaks/fit', {
        x: d.x, y: d.y, centers: a.peaks.map(p => p.x), profile,
        xmin: range[0] === '' ? null : +range[0], xmax: range[1] === '' ? null : +range[1],
      })
      st.patch(a.id, { fit: r })
    } catch (e) { st.fail(e) } finally { setBusy(false) }
  }

  const head = a.fit ? ['Center', 'Intensity', 'FWHM', 'Area', 'R²'] : ['Center', 'Intensity', 'FWHM']
  const rows: number[][] = a.fit
    ? a.fit.table.map(r => [r.center, r.height, r.fwhm, r.area, r.r2])
    : a.peaks.map(p => [p.x, p.y, p.fwhm ?? NaN])
  if (xrd) {  // Bragg d-spacing, Cu Kα1
    head.push('d (Å)')
    rows.forEach(r => r.push(1.5406 / (2 * Math.sin((r[0] * Math.PI) / 360))))
  }
  const text = (sep: string) => [head.join(sep), ...rows.map(r => r.map(v => (Number.isNaN(v) ? '' : v)).join(sep))].join('\n')
  const fmt = (v: number, i: number) => (Number.isNaN(v) ? '–' : head[i] === 'R²' || head[i] === 'd (Å)' ? v.toFixed(4) : Math.abs(v) >= 1e6 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(2) : v.toFixed(2))
  const slider = (label: string, v: number, set: (n: number) => void, min: number, max: number, step: number) => (
    <label className="block text-xs">
      <span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-slate-500">{v}</span></span>
      <input type="range" className="w-full accent-teal-600" min={min} max={max} step={step} value={v} onChange={e => { set(+e.target.value); setAuto(true) }} />
    </label>
  )

  return (
    <div className="space-y-2">
      <div className="card space-y-1.5">
        <div className="label">Auto peak finder</div>
        {slider('Prominence (fraction of range)', prom, setProm, 0.005, 0.5, 0.005)}
        {slider('Minimum height (fraction of range)', height, setHeight, 0, 0.9, 0.01)}
        {slider(`Minimum distance (${xrd ? '°' : 'cm⁻¹'})`, dist, setDist, xrd ? 0.05 : 1, xrd ? 5 : 100, xrd ? 0.05 : 1)}
        <div className="flex gap-1">
          <button className="btn btn-primary flex-1" onClick={find}>Find peaks</button>
          <button className="btn" onClick={() => { setAuto(false); st.patch(a.id, { peaks: [], fit: undefined }) }}>Clear</button>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={st.peakEdit} onChange={e => { setAuto(false); st.set({ peakEdit: e.target.checked }) }} />
          Manual edit: click the spectrum to add / remove a peak
        </label>
      </div>

      <div className="card space-y-1.5">
        <div className="label">Peak fitting / deconvolution</div>
        <select className="field" value={profile} onChange={e => setProfile(e.target.value)}>
          <option value="lorentzian">Lorentzian</option><option value="gaussian">Gaussian</option><option value="voigt">Voigt</option>
        </select>
        <div className="flex items-center gap-1 text-xs">
          Region <input className="field" placeholder="min" value={range[0]} onChange={e => setRange([e.target.value, range[1]])} />
          – <input className="field" placeholder="max" value={range[1]} onChange={e => setRange([range[0], e.target.value])} />
        </div>
        <button className="btn btn-primary w-full" disabled={!a.peaks.length || busy} onClick={fit}>{busy ? 'Fitting…' : `Fit ${a.peaks.length} peak(s)`}</button>
        <p className="text-[11px] text-slate-500">Fits every marked peak inside the region (blank = whole spectrum) plus a linear background.</p>
      </div>

      {st.technique === 'raman' && a.fit && <Carbon rows={a.fit.table} />}
      {st.technique === 'raman' && <Olivine peaks={a.fit ? a.fit.table.map(r => ({ x: r.center, y: r.height })) : a.peaks} />}

      <div className="card">
        <div className="mb-1 flex items-center gap-1">
          <span className="label flex-1">Peak table ({rows.length})</span>
          <button className="btn" disabled={!rows.length} onClick={() => navigator.clipboard.writeText(text('\t'))}>Copy</button>
          <button className="btn" disabled={!rows.length} onClick={() => download(`${a.name}_peaks.csv`, text(','), 'text/csv')}>CSV</button>
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-right text-xs tabular-nums">
            <thead><tr className="text-slate-500">{head.map(h => <th key={h} className="px-1 font-medium">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, k) => <tr key={k} className="border-t border-slate-200 dark:border-slate-800">{r.map((v, i) => <td key={i} className="px-1">{fmt(v, i)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
