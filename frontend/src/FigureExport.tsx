// Figure export dialog shared by the spectrum, PCA and map plots. Author: Kishan Tiwari
import { useState } from 'react'
import { FORMATS, exportFigure } from './exporter'
import { ChevronDown } from './icons'
import { useStore } from './store'

const PRESETS: [string, number, number][] = [['Single column (85 mm)', 85, 60], ['1.5 column (120 mm)', 120, 80], ['Double column (180 mm)', 180, 110], ['Slide 16:9 (254 mm)', 254, 143]]
const DPIS = [150, 300, 600, 1200]

/** `figure(print)` returns the Plotly data and layout; print = true asks for the white publication theme. */
export default function FigureExport({ figure, filename }: { figure: (print: boolean) => { data: any[]; layout: any }; filename: string }) {
  const st = useStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const f = st.fig
  const setFig = (p: Partial<typeof f>) => st.set({ fig: { ...f, ...p } })
  const vector = FORMATS.find(x => x.id === f.format)?.vector
  const px = (mm: number) => Math.round((mm / 25.4) * f.dpi)

  const go = async () => {
    setBusy(true)
    try {
      const { data, layout } = figure(true)
      await exportFigure(data, layout, { format: f.format, widthMm: f.widthMm, heightMm: f.heightMm, dpi: f.dpi, filename, font: f.font })
    } catch (e) { st.fail(e) } finally { setBusy(false) }
  }
  const num = (k: 'size' | 'widthMm' | 'heightMm', label: string) => (
    <label className="flex items-center justify-between gap-2">{label}
      <input type="number" className="field !w-20" min={1} value={f[k]} onChange={e => setFig({ [k]: Math.max(1, +e.target.value || 1) })} />
    </label>
  )
  return (
    <div className="relative">
      <button className="btn" onClick={() => setOpen(o => !o)}>Figure export <ChevronDown className="h-3 w-3" /></button>
      {open && (
        <div className="card absolute right-0 z-30 mt-1 w-72 space-y-1.5 max-xl:fixed max-xl:left-2 max-xl:right-auto max-xl:top-28 max-xl:w-[min(24rem,calc(100vw-1rem))] max-xl:max-h-[70vh] max-xl:overflow-y-auto text-xs shadow-lg">
          <label className="flex items-center justify-between gap-2">Format
            <select className="field !w-36" value={f.format} onChange={e => setFig({ format: e.target.value as any })}>
              {FORMATS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">Resolution
            <select className="field !w-36" value={f.dpi} disabled={vector} onChange={e => setFig({ dpi: +e.target.value })}>
              {[...new Set([...DPIS, f.dpi])].sort((a, b) => a - b).map(d => <option key={d} value={d}>{d} DPI</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">Size preset
            <select className="field !w-36" value="" onChange={e => { const p = PRESETS[+e.target.value]; if (p) setFig({ widthMm: p[1], heightMm: p[2] }) }}>
              <option value="">choose…</option>
              {PRESETS.map((p, i) => <option key={p[0]} value={i}>{p[0]}</option>)}
            </select>
          </label>
          {num('widthMm', 'Width (mm)')}{num('heightMm', 'Height (mm)')}
          <p className="text-[11px] text-slate-500">
            {vector ? 'Vector output: scales to any size.' : `${px(f.widthMm)} × ${px(f.heightMm)} pixels at ${f.dpi} DPI.`}
            {f.format === 'eps' && ' EPS holds a lossless image at this resolution; use PDF or SVG for vector artwork.'}
          </p>
          <label className="flex items-center justify-between gap-2">Font
            <select className="field !w-36" value={f.font} onChange={e => setFig({ font: e.target.value })}>
              {['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New'].map(x => <option key={x}>{x}</option>)}
            </select>
          </label>
          {num('size', 'Font size (pt)')}
          <input className="field" placeholder="X axis label (default by technique)" value={f.xLabel} onChange={e => setFig({ xLabel: e.target.value })} />
          <input className="field" placeholder="Y axis label (default by technique)" value={f.yLabel} onChange={e => setFig({ yLabel: e.target.value })} />
          <label className="flex items-center justify-between gap-2">Tick marks
            <select className="field !w-36" value={f.ticks} onChange={e => setFig({ ticks: e.target.value as any })}><option>outside</option><option>inside</option></select>
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.legend} onChange={e => setFig({ legend: e.target.checked })} /> Legend</label>
          <p className="text-[11px] text-slate-500">Exports exactly the curves shown on the plot (see Curves).</p>
          <button className="btn btn-primary w-full" disabled={busy} onClick={go}>{busy ? 'Exporting…' : `Export ${FORMATS.find(x => x.id === f.format)?.label.split(' ')[0]}`}</button>
        </div>
      )}
    </div>
  )
}
