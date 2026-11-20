// Chemometrics tab: PCA scores / loadings and k-means grouping of the loaded spectra.
// Author: Kishan Tiwari
import Plotly from 'plotly.js-dist-min'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { TECH, api, dataOf, download, useStore } from './store'

type Res = { scores: number[][]; explained: number[]; x: number[]; loadings: number[][]; clusters: number[] | null; names: string[]; colors: string[] }
const usePca = create<{ res: Res | null; set: (r: Res | null) => void }>(set => ({ res: null, set: res => set({ res }) }))
const GROUP = ['#0d9488', '#e11d48', '#2563eb', '#d97706', '#7c3aed', '#16a34a', '#db2777', '#0891b2']

export function PcaCanvas() {
  const res = usePca(s => s.res)
  const dark = useStore(s => s.dark)
  const technique = useStore(s => s.technique)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    if (!res) return void Plotly.purge(ref.current)
    const fg = dark ? '#cbd5e1' : '#0f172a', grid = dark ? '#1e293b' : '#e2e8f0', bg = dark ? '#0b1220' : '#ffffff'
    const ax = { color: fg, gridcolor: grid, zerolinecolor: grid, showline: true, linecolor: fg, mirror: true }
    const pct = (i: number) => `PC${i + 1} (${(res.explained[i] * 100).toFixed(1)}%)`
    const data = [
      {
        x: res.scores.map(s => s[0]), y: res.scores.map(s => s[1] ?? 0), text: res.names, mode: 'markers+text', type: 'scatter',
        textposition: 'top center', textfont: { size: 10, color: fg }, hovertemplate: '%{text}<br>PC1 %{x:.3g}<br>PC2 %{y:.3g}<extra></extra>',
        marker: { size: 11, color: res.clusters ? res.clusters.map(c => GROUP[c % GROUP.length]) : res.colors, line: { color: fg, width: 1 } },
      },
      ...res.loadings.slice(0, 2).map((l, i) => ({ x: res.x, y: l, name: `PC${i + 1} loading`, xaxis: 'x2', yaxis: 'y2', line: { width: 1.3, color: GROUP[i + 1] } })),
    ]
    Plotly.react(ref.current, data, {
      paper_bgcolor: bg, plot_bgcolor: bg, font: { color: fg, size: 13 }, margin: { l: 70, r: 20, t: 20, b: 50 },
      showlegend: true, legend: { x: 1, xanchor: 'right', y: 0.36, bgcolor: 'rgba(0,0,0,0)' },
      xaxis: { ...ax, title: { text: pct(0) }, domain: [0, 1], anchor: 'y' }, yaxis: { ...ax, title: { text: pct(1) }, domain: [0.48, 1] },
      xaxis2: { ...ax, title: { text: TECH[technique].x }, anchor: 'y2', autorange: TECH[technique].reversed ? 'reversed' : true },
      yaxis2: { ...ax, title: { text: 'Loading' }, domain: [0, 0.36], anchor: 'x2' },
    }, { responsive: true, displaylogo: false })
  }, [res, dark, technique])

  return (
    <div className="relative h-full min-w-0 flex-1">
      <div ref={ref} className="absolute inset-0" />
      {!res && <div className="absolute inset-0 flex items-center justify-center text-slate-400">Run PCA from the Chemometrics tab (needs 3 or more spectra)</div>}
    </div>
  )
}

export default function PcaPanel() {
  const st = useStore()
  const { res, set } = usePca()
  const [norm, setNorm] = useState('snv')
  const [k, setK] = useState(0)
  const [busy, setBusy] = useState(false)
  const vis = st.spectra.filter(s => s.technique === st.technique && s.visible)

  const run = async () => {
    setBusy(true)
    try {
      const r = await api<Omit<Res, 'names' | 'colors'>>('/pca', { spectra: vis.map(dataOf).map(d => ({ x: d.x, y: d.y })), clusters: k, norm })
      set({ ...r, names: vis.map(s => s.name), colors: vis.map(s => s.color) })
    } catch (e) { st.fail(e) } finally { setBusy(false) }
  }
  const csv = () => res && download('pca_scores.csv', ['Spectrum,PC1,PC2,PC3,Cluster',
    ...res.scores.map((s, i) => [res.names[i].replace(/,/g, ' '), s[0], s[1] ?? '', s[2] ?? '', res.clusters ? res.clusters[i] + 1 : ''].join(','))].join('\n'), 'text/csv')

  return (
    <div className="space-y-2">
      <div className="card space-y-1.5 text-xs">
        <div className="label">Principal component analysis</div>
        <p className="text-slate-500">Uses the {vis.length} visible {TECH[st.technique].label} spectra after their pipelines, over their common x range.</p>
        <label className="flex items-center justify-between gap-2">Row scaling
          <select className="field !w-40" value={norm} onChange={e => setNorm(e.target.value)}>
            <option value="snv">SNV</option><option value="vector">Vector (L2)</option><option value="none">None</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">k-means groups (0 = off)
          <input type="number" min={0} max={8} className="field !w-20" value={k} onChange={e => setK(Math.max(0, Math.min(8, +e.target.value)))} />
        </label>
        <button className="btn btn-primary w-full" disabled={vis.length < 3 || busy} onClick={run}>{busy ? 'Computing…' : 'Run PCA'}</button>
      </div>
      {res && (
        <div className="card text-xs">
          <div className="mb-1 flex items-center"><span className="label flex-1">Scores</span><button className="btn" onClick={csv}>CSV</button></div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-right tabular-nums">
              <thead><tr className="text-slate-500"><th className="text-left font-medium">Spectrum</th><th className="font-medium">PC1</th><th className="font-medium">PC2</th>{res.clusters && <th className="font-medium">Grp</th>}</tr></thead>
              <tbody>{res.scores.map((s, i) => (
                <tr key={i} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="max-w-32 truncate text-left">{res.names[i]}</td><td>{s[0].toPrecision(3)}</td><td>{(s[1] ?? 0).toPrecision(3)}</td>
                  {res.clusters && <td><span className="inline-block h-2 w-2 rounded-full" style={{ background: GROUP[res.clusters[i] % GROUP.length] }} /> {res.clusters[i] + 1}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
