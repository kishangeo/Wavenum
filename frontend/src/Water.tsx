// H2O from FTIR absorbance (Beer-Lambert), as in SpecXY/SpecDB (Gies et al. 2024, Eq. 9).
// Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
//
// c(ppm wt H2O) = 1e6 * M(H2O) * A_tot / (t * rho * eps)
//   A_tot: total integrated absorbance (cm^-2) = orientation factor x measured A; t: thickness (cm);
//   rho: density (g/L); eps: integrated molar absorption coefficient (L mol^-1 cm^-2).
// (The equation as printed in Gies et al. 2024 lost its division signs; this is the dimensionally consistent form.)
import { useState } from 'react'
import { metric, type SpecMap } from './maps'

const M_H2O = 18.01528

// eps in L mol^-1 cm^-2; density in g/cm3 (typical end-member values: edit for your sample)
export const CALIBRATIONS = [
  { id: 'lr97', name: 'Any mineral: Libowitzky & Rossman 1997 (wavenumber-dependent)', eps: NaN, rho: 3.3 },
  { id: 'cpx', name: 'Clinopyroxene: Bell et al. 1995', eps: 38300, rho: 3.3 },
  { id: 'opx', name: 'Orthopyroxene: Bell et al. 1995', eps: 80600, rho: 3.3 },
  { id: 'grt', name: 'Garnet (pyrope): Bell et al. 1995', eps: 6700, rho: 3.58 },
  { id: 'ol03', name: 'Olivine: Bell et al. 2003', eps: 28450, rho: 3.32 },
  { id: 'ol12', name: 'Olivine: Withers et al. 2012', eps: 45200, rho: 3.32 },
  { id: 'pl', name: 'Plagioclase: Johnson & Rossman 2003', eps: 107000, rho: 2.7 },
  { id: 'user', name: 'User-defined ε', eps: 10000, rho: 3.0 },
]
const ORIENT = [
  { f: 1, name: 'Sum of 3 polarised directions (×1)' },
  { f: 3, name: 'Isotropic mineral, one spectrum (×3)' },
  { f: 3, name: 'Unpolarised, randomly oriented grains (×3, approx.)' },
]

/** Libowitzky & Rossman (1997) Am. Mineral. 82, 1111-1115: eps_i = 246.6 (3753 - mean wavenumber). */
export const epsLR97 = (nu: number) => 246.6 * (3753 - nu)

/** ppm H2O per cm^-2 of measured integrated absorbance. */
export const ppmFactor = (thicknessUm: number, rhoGcm3: number, eps: number, orient: number) =>
  (1e6 * M_H2O * orient) / ((thicknessUm * 1e-4) * (rhoGcm3 * 1000) * eps)

/** Integrated absorbance over [x1, x2] above a straight baseline, and the absorbance-weighted mean wavenumber. */
function band(x: number[], y: number[], x1: number, x2: number) {
  const n = x.length
  const m: SpecMap = { name: '', technique: 'ftir', nx: 1, ny: 1, x: [0], y: [0], axis: Float64Array.from(x), cube: Float32Array.from(y) }
  const area = metric(m, 'area', x1, x2)[0]
  let w = 0, wx = 0
  const lo = Math.min(x1, x2), hi = Math.max(x1, x2)
  for (let k = 0; k < n; k++) if (x[k] >= lo && x[k] <= hi && y[k] > 0) { w += y[k]; wx += y[k] * x[k] }
  return { area, nu: w > 0 ? wx / w : (lo + hi) / 2 }
}

type Props = {
  /** Peaks tab: the active spectrum (x ascending) and optional fitted peak areas. */
  spectrum?: { x: number[]; y: number[] }
  fitAreas?: { center: number; area: number }[]
  /** Map tab: receives the ppm-per-absorbance factor to use as the map calibration C. */
  onFactor?: (c: number, window: [number, number]) => void
}

export default function Water({ spectrum, fitAreas, onFactor }: Props) {
  const [cal, setCal] = useState('cpx')
  const [eps, setEps] = useState(10000)
  const [rho, setRho] = useState(3.3)
  const [t, setT] = useState(100)
  const [orient, setOrient] = useState(0)
  const [win, setWin] = useState<[number, number]>([3000, 3800])
  const c = CALIBRATIONS.find(k => k.id === cal)!
  const pick = (id: string) => { const k = CALIBRATIONS.find(q => q.id === id)!; setCal(id); setRho(k.rho); if (id === 'user') setEps(k.eps) }
  const b = spectrum ? band(spectrum.x, spectrum.y, win[0], win[1]) : null
  const nu = b?.nu ?? (win[0] + win[1]) / 2
  const e = cal === 'lr97' ? epsLR97(nu) : cal === 'user' ? eps : c.eps
  const k = ppmFactor(t, rho, e, ORIENT[orient].f)
  const ok = Number.isFinite(k) && k > 0
  const num = (label: string, v: number, set: (n: number) => void, step = 'any') => (
    <label className="text-xs">{label}<input className="field" type="number" step={step} value={v} onChange={ev => set(+ev.target.value)} /></label>
  )
  const fitSum = fitAreas?.filter(p => p.center >= Math.min(...win) && p.center <= Math.max(...win)).reduce((s, p) => s + p.area, 0)

  return (
    <div className="card space-y-1.5">
      <div className="label">H₂O content (Beer–Lambert)</div>
      <select className="field" value={cal} onChange={ev => pick(ev.target.value)}>
        {CALIBRATIONS.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-1">
        {num('Band from (cm⁻¹)', win[0], v => setWin([v, win[1]]))}
        {num('to (cm⁻¹)', win[1], v => setWin([win[0], v]))}
        {num('Thickness (µm)', t, setT)}
        {num('Density (g/cm³)', rho, setRho)}
        {cal === 'user' ? num('ε (L mol⁻¹ cm⁻²)', eps, setEps) : (
          <div className="text-xs">ε (L mol⁻¹ cm⁻²)<div className="field tabular-nums">{Number.isFinite(e) ? e.toFixed(0) : '–'}</div></div>
        )}
      </div>
      <select className="field" value={orient} onChange={ev => setOrient(+ev.target.value)}>
        {ORIENT.map((o, i) => <option key={i} value={i}>{o.name}</option>)}
      </select>
      {cal === 'lr97' && <p className="text-[11px] text-slate-500">ε = 246.6 (3753 − ν̄) with ν̄ = {nu.toFixed(0)} cm⁻¹ {spectrum ? '(absorbance-weighted mean of the band)' : '(window centre; use the band mean)'}.</p>}
      {b && ok && (
        <div className="space-y-0.5 text-xs tabular-nums">
          <div className="flex justify-between"><span>Integrated absorbance</span><span>{b.area.toFixed(2)} cm⁻²</span></div>
          <div className="flex justify-between font-medium"><span>H₂O</span><span>{(k * b.area).toFixed(0)} ppm wt</span></div>
          {fitSum !== undefined && fitSum > 0 && (
            <div className="flex justify-between"><span>From fitted peaks in band</span><span>{fitSum.toFixed(2)} cm⁻² → {(k * fitSum).toFixed(0)} ppm</span></div>
          )}
        </div>
      )}
      {onFactor && (
        <button className="btn w-full" disabled={!ok} onClick={() => onFactor(k, win)}>
          Make H₂O map (area {Math.min(...win)}–{Math.max(...win)} × {ok ? k.toPrecision(4) : '–'} ppm per cm⁻²)
        </button>
      )}
      <p className="text-[11px] text-slate-500">
        c = 10⁶ · M(H₂O) · f · A / (t · ρ · ε), on absorbance spectra with the background removed. Check that ε suits your mineral and
        band range; densities are typical values (SpecXY, Gies et al. 2024, Eq. 9).
      </p>
    </div>
  )
}
