// Centre canvas: Plotly chart, view modes, curve selector, data and figure export. Author: Kishan Tiwari
import Plotly from 'plotly.js-dist-min'
import { useEffect, useRef, useState } from 'react'
import FigureExport from './FigureExport'
import { ChevronDown } from './icons'
import { TECH, dataOf, download, extent, useStore, type Spectrum } from './store'

type S = ReturnType<typeof useStore.getState>
export type Curve = { key: string; label: string; color: string; shown: boolean; spectrumId?: string }

export const ptToPx = (pt: number) => (pt * 96) / 72 // Plotly sizes text in CSS pixels

/** Every curve the current view can draw, with whether it is shown. Spectra use their own visibility;
 *  derived curves (baseline, fit, …) use the hidden-curves list. */
export function curvesOf(st: S): Curve[] {
  const hidden = new Set(st.hiddenCurves)
  const active = st.spectra.find(s => s.id === st.activeId && s.technique === st.technique)
  const match = st.tab === 'id' && st.selMatch != null ? st.matches[st.selMatch] : null
  const c = (key: string, label: string, color: string): Curve => ({ key, label, color, shown: !hidden.has(key) })
  if (match && active) {
    return [
      { key: `spec:${active.id}`, label: active.name, color: active.color, shown: true, spectrumId: active.id },
      c('ref', `${match.name} (reference)`, '#f59e0b'), c('guides', 'Matched-peak guide lines', '#94a3b8'),
    ]
  }
  const out: Curve[] = st.spectra.filter(s => s.technique === st.technique)
    .map(s => ({ key: `spec:${s.id}`, label: s.name, color: s.color, shown: s.visible, spectrumId: s.id }))
  if (active?.visible) {
    if (st.showBaseline && active.proc?.baseline) out.push(c('prebase', 'Before baseline', '#94a3b8'), c('baseline', 'Baseline', '#f59e0b'))
    if (active.fit) out.push(c('fit', 'Fit (sum)', '#64748b'), c('comps', 'Fitted components', '#8b5cf6'), c('resid', 'Residual panel', '#ef4444'))
    if (active.peaks.length) out.push(c('peaks', 'Peak markers and labels', active.color))
  }
  return out
}

// Pure: state -> Plotly figure. `print` forces a white publication theme.
export function figure(st: S, print: boolean) {
  const tech = TECH[st.technique]
  const dark = st.dark && !print
  const fg = dark ? '#cbd5e1' : '#0f172a', grid = dark ? '#1e293b' : '#e2e8f0', bg = dark ? '#0b1220' : '#ffffff'
  const show = new Map(curvesOf(st).map(c => [c.key, c.shown]))
  const on = (k: string) => show.get(k) !== false
  const active = st.spectra.find(s => s.id === st.activeId && s.technique === st.technique)
  const match = st.tab === 'id' && st.selMatch != null ? st.matches[st.selMatch] : null
  const data: any[] = [], shapes: any[] = [], annotations: any[] = []
  let residual = false
  const fontPx = ptToPx(st.fig.size)

  if (match && active) {
    // Mirror plot: sample up, reference inverted, guide lines at matched peaks.
    const d = dataOf(active)
    const [lo, top] = extent(d.y), r = top - lo || 1
    data.push({ x: d.x, y: d.y.map(v => (v - lo) / r), name: active.name, meta: `spec:${active.id}`, line: { color: active.color, width: 1.5 } })
    if (on('ref')) data.push({ x: match.ref.x, y: match.ref.y.map(v => -v), name: `${match.name} (reference)`, meta: 'ref', line: { color: '#f59e0b', width: 1.5 } })
    if (on('guides'))
      for (const [sx, rx] of match.pairs)
        shapes.push({ type: 'line', x0: sx, x1: rx, y0: 1, y1: on('ref') ? -1 : 0, line: { color: dark ? '#64748b' : '#94a3b8', width: 1, dash: 'dot' } })
    shapes.push({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: fg, width: 1 } })
  } else {
    const vis = st.spectra.filter(s => s.visible && s.technique === st.technique)
    let offset = 0
    for (const s of vis) {
      const d = dataOf(s)
      const [lo, hi] = extent(d.y)
      const off = st.plotMode === 'stacked' ? offset - lo : 0
      offset += (hi - lo) * 1.08
      data.push({ x: d.x, y: off ? d.y.map(v => v + off) : d.y, name: s.name, meta: `spec:${s.id}`, line: { color: s.color, width: s.id === st.activeId ? 1.8 : 1.2 } })
      if (s.id !== st.activeId) continue
      if (st.showBaseline && s.proc?.baseline) {
        const b = s.proc.baseline
        if (on('prebase')) data.push({ x: b.x, y: b.input.map(v => v + off), name: 'before baseline', meta: 'prebase', line: { color: '#94a3b8', width: 1 } })
        if (on('baseline')) data.push({ x: b.x, y: b.y.map(v => v + off), name: 'baseline', meta: 'baseline', line: { color: '#f59e0b', width: 1.5, dash: 'dash' } })
      }
      if (s.fit) {
        if (on('comps'))
          s.fit.components.forEach((c, i) => data.push({
            x: s.fit!.x, y: c.map(v => v + off), name: `peak ${i + 1}`, meta: 'comps', showlegend: false,
            line: { width: 1, color: '#8b5cf6' }, fill: i === 0 ? 'none' : 'tonexty', fillcolor: 'rgba(139,92,246,0.12)', hoverinfo: 'skip',
          }))
        if (on('fit')) data.push({ x: s.fit.x, y: s.fit.fit.map(v => v + off), name: `fit (R² ${s.fit.r2.toFixed(4)})`, meta: 'fit', line: { color: fg, width: 1.5, dash: 'dash' } })
        if (on('resid')) {
          data.push({ x: s.fit.x, y: s.fit.residual, name: 'residual', meta: 'resid', yaxis: 'y2', line: { color: '#ef4444', width: 1 } })
          residual = true
        }
      }
      if (s.peaks.length && on('peaks'))
        data.push({
          x: s.peaks.map(p => p.x), y: s.peaks.map(p => p.y + off), mode: 'markers+text', name: 'peaks', meta: 'peaks', showlegend: false,
          text: s.peaks.map(p => p.x.toFixed(st.technique === 'xrd' ? 2 : 0)), textposition: 'top center',
          textfont: { size: fontPx * 0.8, color: fg }, marker: { color: s.color, size: 7, symbol: 'triangle-down' }, cliponaxis: false,
        })
    }
  }

  const axis = {
    color: fg, gridcolor: grid, zeroline: false, showline: true, linecolor: fg, mirror: true, automargin: true,
    ticks: st.fig.ticks, tickcolor: fg, showspikes: !print, spikemode: 'across', spikethickness: 1, spikedash: 'dot', spikecolor: fg,
  }
  // uirevision keeps the user's zoom across redraws; it must change whenever the plotted data change,
  // otherwise Plotly keeps stale axis ranges (e.g. after switching normalization on).
  const sig = st.spectra.filter(s => s.technique === st.technique)
    .map(s => `${s.id}:${s.visible}:${JSON.stringify(s.pipeline.map(p => [p.enabled, p.params]))}:${s.peaks.length}:${s.fit?.r2 ?? ''}:${s.proc ? 1 : 0}`).join('|')
  const layout = {
    paper_bgcolor: bg, plot_bgcolor: bg, font: { family: st.fig.font, size: fontPx, color: fg },
    margin: { l: 70, r: 20, t: 20, b: 55 }, showlegend: st.fig.legend && data.some(t => t.showlegend !== false),
    legend: { x: 1, xanchor: 'right', y: 1, bgcolor: 'rgba(0,0,0,0)' },
    hovermode: 'x', shapes, annotations,
    uirevision: `${st.technique}|${match ? 'mirror' : st.plotMode}|${st.showBaseline}|${st.hiddenCurves.join(',')}|${sig}`,
    // with a residual panel the x axis (ticks, title) sits under that panel, not between the two
    xaxis: { ...axis, title: { text: st.fig.xLabel || tech.x }, autorange: tech.reversed ? 'reversed' : true, anchor: residual ? 'y2' : 'y' },
    yaxis: { ...axis, title: { text: match ? 'Normalized intensity' : st.fig.yLabel || tech.y }, domain: residual ? [0.24, 1] : [0, 1] },
    ...(residual ? { yaxis2: { ...axis, domain: [0, 0.18], title: { text: 'Resid.' }, showspikes: false } } : {}),
  }
  return { data, layout }
}

function toCsv(s: Spectrum, sep: string) {
  const d = dataOf(s)
  return ['x' + sep + 'y', ...d.x.map((x, i) => x + sep + d.y[i])].join('\n')
}

/** Show or hide one curve; spectra use their visibility flag, derived curves the hidden list. */
export function toggleCurve(key: string) {
  const st = useStore.getState()
  if (key.startsWith('spec:')) {
    const s = st.spectra.find(x => x.id === key.slice(5))
    if (s) st.patch(s.id, { visible: !s.visible })
    return
  }
  const h = new Set(st.hiddenCurves)
  h.has(key) ? h.delete(key) : h.add(key)
  st.set({ hiddenCurves: [...h] })
}

function Curves() {
  const st = useStore()
  const [open, setOpen] = useState(false)
  const curves = curvesOf(st)
  if (!curves.length) return null
  return (
    <div className="relative">
      <button className="btn" onClick={() => setOpen(o => !o)} title="Choose what is drawn (and exported)">
        Curves ({curves.filter(c => c.shown).length}/{curves.length}) <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="card absolute right-0 z-30 mt-1 max-h-96 w-72 space-y-0.5 overflow-y-auto text-xs shadow-lg">
          <div className="mb-1 flex gap-1">
            <button className="btn flex-1" onClick={() => curves.filter(c => !c.shown).forEach(c => toggleCurve(c.key))}>Show all</button>
            <button className="btn flex-1" onClick={() => curves.filter(c => c.shown && !c.spectrumId).forEach(c => toggleCurve(c.key))}>Hide extras</button>
          </div>
          {curves.map(c => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800">
              <input type="checkbox" checked={c.shown} onChange={() => toggleCurve(c.key)} />
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.color }} />
              <span className="truncate">{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Plot() {
  const ref = useRef<HTMLDivElement>(null)
  const st = useStore()
  const active = st.spectra.find(s => s.id === st.activeId && s.technique === st.technique)

  const lastTech = useRef(st.technique)
  useEffect(() => {
    const { data, layout } = figure(st, false)
    // Plotly keeps a stale axis range when autorange flips between 'reversed' and true,
    // so start from a clean plot whenever the technique changes.
    if (lastTech.current !== st.technique) Plotly.purge(ref.current!)
    lastTech.current = st.technique
    Plotly.react(ref.current!, data, layout, { responsive: true, displaylogo: false, scrollZoom: true })
  }, [st.spectra, st.activeId, st.technique, st.dark, st.plotMode, st.showBaseline, st.matches, st.selMatch, st.tab, st.fig, st.hiddenCurves])

  useEffect(() => {
    const el = ref.current as any
    // Manual peak editing: click near a marker removes it, elsewhere adds one at the local maximum.
    const onClick = (ev: any) => {
      const s = useStore.getState()
      const a = s.spectra.find(x => x.id === s.activeId && x.technique === s.technique)
      if (!a || !s.peakEdit || s.tab !== 'peaks') return
      const cx = ev.points[0].x as number
      const d = dataOf(a)
      const span = Math.abs(d.x[d.x.length - 1] - d.x[0])
      const tol = span / 150
      const near = a.peaks.find(p => Math.abs(p.x - cx) <= tol)
      if (near) return s.patch(a.id, { peaks: a.peaks.filter(p => p !== near) })
      let best = -1
      d.x.forEach((x, i) => { if (Math.abs(x - cx) <= tol && (best < 0 || d.y[i] > d.y[best])) best = i })
      if (best >= 0) s.patch(a.id, { peaks: [...a.peaks, { x: d.x[best], y: d.y[best] }].sort((p, q) => p.x - q.x) })
    }
    // Legend clicks go through the curve selector, so the display, the selector and exports agree.
    const onLegend = (ev: any) => {
      const key = ev.data?.[ev.curveNumber]?.meta
      if (key) toggleCurve(key)
      return false
    }
    el.on?.('plotly_click', onClick)
    el.on?.('plotly_legendclick', onLegend)
    el.on?.('plotly_legenddoubleclick', () => false)
    return () => { el.removeAllListeners?.('plotly_click'); el.removeAllListeners?.('plotly_legendclick'); el.removeAllListeners?.('plotly_legenddoubleclick') }
  }, [st.technique])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-2 py-1 dark:border-slate-800">
        {(['overlay', 'stacked'] as const).map(m => (
          <button key={m} className={`btn ${st.plotMode === m ? 'btn-primary' : ''}`} onClick={() => st.set({ plotMode: m })}>{m === 'overlay' ? 'Overlay' : 'Stacked'}</button>
        ))}
        <label className="ml-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={st.showBaseline} onChange={e => st.set({ showBaseline: e.target.checked })} /> Show baseline</label>
        <div className="flex-1" />
        <Curves />
        <button className="btn" disabled={!active} onClick={() => active && download(`${active.name}_processed.csv`, toCsv(active, ','), 'text/csv')}>Data .csv</button>
        <button className="btn" disabled={!active} onClick={() => active && download(`${active.name}_processed.txt`, toCsv(active, '\t'))}>Data .txt</button>
        <FigureExport figure={print => figure(useStore.getState(), print)} filename={active?.name ?? 'wavenum'} />
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={ref} className="absolute inset-0" />
        {!st.spectra.some(s => s.technique === st.technique) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-400">
            Drop {TECH[st.technique].label} spectra on the left to begin
          </div>
        )}
      </div>
    </div>
  )
}
