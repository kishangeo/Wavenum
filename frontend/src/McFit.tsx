// Monte Carlo peak deconvolution (after SpecXY, Gies et al. 2024, doi:10.1016/j.cageo.2024.105626):
// the fit is repeated from random starts and the spread of equally good solutions is shown.
// Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
import Plotly from 'plotly.js-dist-min'
import { useEffect, useRef, useState } from 'react'
import { api, dataOf, download, inTauri, useStore, type Fit, type FitRow, type Spectrum } from './store'

type Mc = { best: Fit; runs: { r2: number; table: FitRow[] }[]; centers: number[]; max_shift: number }
const PARAMS = [['center', 'Position'], ['fwhm', 'FWHM'], ['area', 'Area'], ['height', 'Height']] as const
type Param = (typeof PARAMS)[number][0]

const stats = (v: number[]) => {
  const m = v.reduce((s, a) => s + a, 0) / v.length
  const sd = Math.sqrt(v.reduce((s, a) => s + (a - m) ** 2, 0) / Math.max(1, v.length - 1))
  return { m, sd, lo: Math.min(...v), hi: Math.max(...v) }
}
const f = (v: number) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(2) : v.toFixed(2))

export default function McFit({ a, profile, range }: { a: Spectrum; profile: string; range: [string, string] }) {
  const st = useStore()
  const [runs, setRuns] = useState(100)
  const [shift, setShift] = useState(st.technique === 'xrd' ? 0.2 : 5)
  const [tol, setTol] = useState(0.001) // keep runs with R² >= best − tol
  const [peak, setPeak] = useState(0)
  const [param, setParam] = useState<Param>('center')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [res, setRes] = useState<{ id: string; mc: Mc } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const mc = res?.id === a.id ? res.mc : null
  const bestR2 = mc ? Math.max(...mc.runs.map(r => r.r2)) : 0
  const kept = mc ? mc.runs.filter(r => r.r2 >= bestR2 - tol) : []

  // Website: each request must finish within the host's time limit, so the runs go out in batches,
  // a few at once. Desktop: one call uses every CPU core.
  const run = async () => {
    setBusy(true)
    setDone(0)
    try {
      const d = dataOf(a)
      const body = { x: d.x, y: d.y, centers: a.peaks.map(p => p.x), profile, max_shift: shift,
        xmin: range[0] === '' ? null : +range[0], xmax: range[1] === '' ? null : +range[1] }
      // each request stops after `budget` seconds and returns the runs it finished; ask again until all are done
      const batch = inTauri ? runs : Math.ceil(runs / 3)
      const got: Mc[] = []
      let asked = 0, n = 0, seed = 1
      const worker = async () => {
        while (asked < runs) {
          const k = Math.min(batch, runs - asked)
          const i = got.length, base = asked === 0  // the first request also holds the default-start fit
          asked += k
          got.push(undefined as unknown as Mc)
          got[i] = await api<Mc>('/peaks/mc', { ...body, runs: Math.max(base ? 2 : 1, k), seed: seed++, base, budget: inTauri ? null : 20 })
          asked -= k - got[i].runs.length  // runs the budget cut off go back in the queue
          setDone(n += got[i].runs.length)
          if (!got[i].runs.length) throw new Error('No Monte Carlo run converged')
        }
      }
      // ponytail: 3 requests in flight; the host may run them on one instance, so more only slows each
      await Promise.all(Array.from({ length: Math.min(3, Math.ceil(runs / batch)) }, worker))
      // request 0 comes first, so run 1 is always the default-start fit
      const r: Mc = { ...got[0], runs: got.flatMap(g => g.runs).slice(0, runs), best: got.reduce((p, g) => (g.best.r2 > p.best.r2 ? g : p)).best }
      setRes({ id: a.id, mc: r })
      setPeak(0)
      st.patch(a.id, { fit: r.best })
    } catch (e) { st.fail(e) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!ref.current) return
    if (!mc || !kept.length) { Plotly.purge(ref.current); return }
    const fg = st.dark ? '#cbd5e1' : '#334155'
    const ax = { color: fg, gridcolor: st.dark ? '#1e293b' : '#e2e8f0', zeroline: false }
    Plotly.react(ref.current, [{
      type: 'histogram', x: kept.map(r => r.table[peak]?.[param]), marker: { color: '#0d9488' }, nbinsx: 20,
      hovertemplate: '%{x}<br>%{y} runs<extra></extra>',
    }], {
      paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { size: 10, color: fg }, height: 170,
      margin: { l: 34, r: 6, t: 6, b: 30 }, bargap: 0.05,
      xaxis: { ...ax, title: { text: PARAMS.find(p => p[0] === param)![1] } }, yaxis: { ...ax, title: { text: 'Runs' } },
    }, { displayModeBar: false, responsive: true })
  }, [mc, kept.length, peak, param, st.dark])

  const csv = () => {
    if (!mc) return
    const head = ['run', 'r2', ...mc.centers.flatMap((_, i) => PARAMS.map(p => `peak${i + 1}_${p[0]}`))]
    const rows = mc.runs.map((r, k) => [k + 1, r.r2, ...r.table.flatMap(t => PARAMS.map(p => t[p[0]]))].join(','))
    download(`${a.name}_monte_carlo.csv`, [head.join(','), ...rows].join('\n'), 'text/csv')
  }

  return (
    <div className="card space-y-1.5">
      <div className="label">Monte Carlo deconvolution</div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        <label>Runs <input className="field" type="number" min={2} max={1000} value={runs} onChange={e => setRuns(Math.max(2, Math.min(1000, +e.target.value || 2)))} /></label>
        <label>Max. shift ± <input className="field" type="number" min={0} step="any" value={shift} onChange={e => setShift(Math.max(0, +e.target.value))} /></label>
      </div>
      <button className="btn btn-primary w-full" disabled={!a.peaks.length || busy} onClick={run}>{busy ? `Running fits… ${done} / ${runs}` : `Run ${runs} fits`}</button>
      {busy && <div className="h-1 rounded bg-slate-200 dark:bg-slate-800"><div className="h-1 rounded bg-teal-500 transition-all" style={{ width: `${(100 * done) / runs}%` }} /></div>}
      <p className="text-[11px] text-slate-500">
        Repeats the fit from random starts (position within ± max. shift of each marked peak, width ×0.5–2, height ×0.5–1.5); each peak may
        move at most ± max. shift. The best fit is drawn; the spread shows how well each parameter is constrained (SpecXY, Gies et al. 2024).
      </p>
      {mc && (
        <>
          <label className="flex items-center gap-1 text-xs">
            Keep runs with R² ≥ best −
            <select className="field !w-24" value={tol} onChange={e => setTol(+e.target.value)}>
              {[0.0001, 0.001, 0.01, 0.05, 1].map(v => <option key={v} value={v}>{v === 1 ? 'all' : v}</option>)}
            </select>
          </label>
          <p className="text-xs text-slate-500">{kept.length} of {mc.runs.length} runs kept · best R² {bestR2.toFixed(5)}</p>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-right text-xs tabular-nums">
              <thead><tr className="text-slate-500"><th className="px-1 text-left font-medium">Peak</th>{PARAMS.map(p => <th key={p[0]} className="px-1 font-medium">{p[1]} ± sd</th>)}</tr></thead>
              <tbody>
                {mc.centers.map((_, i) => (
                  <tr key={i} className={'cursor-pointer border-t border-slate-200 dark:border-slate-800 ' + (i === peak ? 'bg-teal-50 dark:bg-teal-950' : '')} onClick={() => setPeak(i)}>
                    <td className="px-1 text-left">{i + 1}</td>
                    {PARAMS.map(p => {
                      const s = stats(kept.map(r => r.table[i][p[0]]))
                      return <td key={p[0]} className="px-1" title={`range ${f(s.lo)} – ${f(s.hi)}`}>{f(s.m)} ± {f(s.sd)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-1">
            <select className="field" value={peak} onChange={e => setPeak(+e.target.value)}>
              {mc.centers.map((c, i) => <option key={i} value={i}>Peak {i + 1} (~{c.toFixed(1)})</option>)}
            </select>
            <select className="field" value={param} onChange={e => setParam(e.target.value as Param)}>
              {PARAMS.map(p => <option key={p[0]} value={p[0]}>{p[1]}</option>)}
            </select>
          </div>
          <div ref={ref} />
          <button className="btn w-full" onClick={csv}>All runs (.csv)</button>
        </>
      )}
    </div>
  )
}
