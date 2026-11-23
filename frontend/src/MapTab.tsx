// Map tab: hyperspectral Raman / FTIR / XRD maps and element maps, after SpecXY's SpecMaps module.
// Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
import Plotly from 'plotly.js-dist-min'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import FigureExport from './FigureExport'
import { XIcon } from './icons'
import {
  MAP_KINDS, METRICS, calc, classify, decodeBinaryMap, makeMask, meanSpectrum, metric, nearestPixel, newLayer, normalize01,
  parseMapImage, parseMapText, pixelSpectrum, profile, rectPixels, type CalcOp, type Layer, type MapKind, type MetricKind, type SpecMap,
} from './maps'
import { ptToPx, touch } from './Plot'
import Water from './Water'
import { TECH, download, exampleFile, mapBinary, useStore, type Example } from './store'

type Tool = 'pixel' | 'region' | 'line'
type MapState = {
  map: SpecMap | null; layers: Layer[]; active: string | null
  mask: { layer: string; lo: number; hi: number; on: boolean } | null
  colors: string; clip: boolean; log: boolean; tool: Tool
  clicks: [number, number][]; preview: { kind: 'spectrum' | 'profile'; title: string; x: number[]; y: number[] } | null
  set: (p: Partial<MapState>) => void
}
export const useMap = create<MapState>(set => ({
  map: null, layers: [], active: null, mask: null, colors: 'Viridis', clip: true, log: false, tool: 'pixel', clicks: [], preview: null,
  set: p => set(p),
}))
const SCALES = ['Viridis', 'Cividis', 'Inferno', 'Plasma', 'Hot', 'Greys', 'RdBu', 'Jet']
const CLASS_COLORS = ['#0d9488', '#e11d48', '#2563eb', '#d97706', '#7c3aed', '#16a34a', '#db2777', '#0891b2', '#ca8a04', '#475569']

function rangeOf(v: Float32Array, clip: boolean): [number, number] {
  const f = Array.from(v).filter(Number.isFinite).sort((a, b) => a - b)
  if (!f.length) return [0, 1]
  if (!clip) return [f[0], f[f.length - 1]]
  return [f[Math.floor(0.02 * (f.length - 1))], f[Math.ceil(0.98 * (f.length - 1))]]
}

/** Map figure: heatmap of the active layer, masked pixels blank, region / line overlays. */
function mapFigure(ms: MapState, dark: boolean, fig: ReturnType<typeof useStore.getState>['fig'], print: boolean) {
  const m = ms.map!, layer = ms.layers.find(l => l.id === ms.active)!
  const fg = dark && !print ? '#cbd5e1' : '#0f172a', bg = dark && !print ? '#0b1220' : '#ffffff'
  const mask = ms.mask?.on ? ms.layers.find(l => l.id === ms.mask!.layer) : null
  const keep = mask ? makeMask(mask.values, ms.mask!.lo, ms.mask!.hi) : null
  const isClass = layer.name.startsWith('Classes')
  const vals = layer.values.map((v, p) => (keep && !keep[p] ? NaN : ms.log && !isClass ? (v > 0 ? Math.log10(v) : NaN) : v))
  const [zmin, zmax] = isClass ? [0.5, Math.max(...Array.from(vals).filter(Number.isFinite)) + 0.5] : rangeOf(vals, ms.clip)
  const z: (number | null)[][] = []
  for (let iy = 0; iy < m.ny; iy++) {
    const row: (number | null)[] = []
    for (let ix = 0; ix < m.nx; ix++) { const v = vals[iy * m.nx + ix]; row.push(Number.isFinite(v) ? v : null) }
    z.push(row)
  }
  const nClass = Math.round(zmax - 0.5)
  // one flat colour band per class
  const classScale = isClass ? Array.from({ length: nClass }, (_, i) => {
    const c = CLASS_COLORS[i % CLASS_COLORS.length]
    return [[i / nClass, c], [(i + 1) / nClass, c]]
  }).flat() : null
  const data: any[] = [{
    type: 'heatmap', x: m.x, y: m.y, z, zmin, zmax, colorscale: classScale ?? ms.colors, hoverongaps: false,
    colorbar: { title: { text: (ms.log && !isClass ? 'log₁₀ ' : '') + layer.name, side: 'right' }, outlinewidth: 0, tickfont: { color: fg }, ...(isClass ? { tickvals: Array.from({ length: Math.round(zmax - 0.5) }, (_, i) => i + 1) } : {}) },
    hovertemplate: 'x %{x}<br>y %{y}<br>%{z:.4g}<extra></extra>',
  }]
  const shapes: any[] = []
  const [a, b] = ms.clicks
  if (a && ms.tool === 'region') shapes.push(b ? { type: 'rect', x0: a[0], y0: a[1], x1: b[0], y1: b[1], line: { color: '#f8fafc', width: 2, dash: 'dot' } } : { type: 'circle', x0: a[0] - 0.3, x1: a[0] + 0.3, y0: a[1] - 0.3, y1: a[1] + 0.3, line: { color: '#f8fafc' } })
  if (a && ms.tool === 'line') shapes.push(b ? { type: 'line', x0: a[0], y0: a[1], x1: b[0], y1: b[1], line: { color: '#f8fafc', width: 2 } } : { type: 'circle', x0: a[0] - 0.3, x1: a[0] + 0.3, y0: a[1] - 0.3, y1: a[1] + 0.3, line: { color: '#f8fafc' } })
  const ax = { color: fg, showgrid: false, zeroline: false, showline: true, linecolor: fg, mirror: true, ticks: fig.ticks, automargin: true }
  const layout = {
    paper_bgcolor: bg, plot_bgcolor: bg, font: { family: fig.font, size: ptToPx(fig.size), color: fg }, modebar: { orientation: 'v', bgcolor: 'rgba(0,0,0,0)', color: fg + '80', activecolor: '#0d9488' }, margin: { l: 60, r: print || touch() ? 20 : 48, t: 30, b: 50 },
    title: { text: `${m.name}: ${layer.name}`, font: { size: ptToPx(fig.size) } },
    // a line or depth scan (one row) fills the plot instead of keeping equal X/Y scales
    xaxis: { ...ax, title: { text: fig.xLabel || (m.ny === 1 ? 'Position along scan (µm)' : 'X (µm)') }, constrain: 'domain' },
    yaxis: m.ny === 1 ? { ...ax, title: { text: fig.yLabel }, showticklabels: false, ticks: '' }
      : { ...ax, title: { text: fig.yLabel || 'Y (µm)' }, scaleanchor: 'x', constrain: 'domain' },
    shapes, uirevision: m.name,
  }
  return { data, layout }
}

export function MapCanvas() {
  const ms = useMap()
  const dark = useStore(s => s.dark)
  const fig = useStore(s => s.fig)
  const ref = useRef<HTMLDivElement>(null)
  const pref = useRef<HTMLDivElement>(null)
  const ready = !!(ms.map && ms.layers.some(l => l.id === ms.active))

  useEffect(() => {
    if (!ref.current) return
    if (!ready) return void Plotly.purge(ref.current)
    const { data, layout } = mapFigure(ms, dark, fig, false)
    Plotly.react(ref.current, data, layout, { responsive: true, displaylogo: false, displayModeBar: !touch() })
  }, [ms.map, ms.layers, ms.active, ms.mask, ms.colors, ms.clip, ms.log, ms.clicks, ms.tool, dark, fig, ready])

  useEffect(() => {
    if (!pref.current) return
    const p = ms.preview
    if (!p) return void Plotly.purge(pref.current)
    const fg = dark ? '#cbd5e1' : '#0f172a', bg = dark ? '#0b1220' : '#ffffff', grid = dark ? '#1e293b' : '#e2e8f0'
    const tech = ms.map ? TECH[ms.map.technique] : TECH.raman
    const ax = { color: fg, gridcolor: grid, showline: true, linecolor: fg, mirror: true }
    Plotly.react(pref.current, [{ x: p.x, y: p.y, mode: 'lines', line: { color: '#14b8a6', width: 1.3 } }], {
      paper_bgcolor: bg, plot_bgcolor: bg, font: { size: 11, color: fg }, margin: { l: 55, r: 15, t: 26, b: 38 }, title: { text: p.title, font: { size: 12 } },
      xaxis: { ...ax, title: { text: p.kind === 'profile' ? 'Distance along line' : tech.x }, autorange: p.kind === 'spectrum' && tech.reversed ? 'reversed' : true },
      yaxis: { ...ax, title: { text: p.kind === 'profile' ? 'Value' : 'Intensity' } },
    }, { responsive: true, displaylogo: false })
  }, [ms.preview, dark])

  // clicks on the map: pixel spectrum, region corners, or line ends
  useEffect(() => {
    const el = ref.current as any
    if (!el?.on) return
    const onClick = (ev: any) => {
      const s = useMap.getState()
      const m = s.map
      const pt = ev.points?.[0]
      if (!m || !pt) return
      const xy: [number, number] = [pt.x, pt.y]
      if (s.tool === 'pixel') {
        if (!m.axis) return
        const p = nearestPixel(m, xy[0], xy[1])
        const sp = pixelSpectrum(m, p)
        s.set({ clicks: [xy], preview: { kind: 'spectrum', title: `Pixel x ${m.x[p % m.nx]}, y ${m.y[Math.floor(p / m.nx)]}`, ...sp } })
        return
      }
      const clicks = s.clicks.length === 1 ? [s.clicks[0], xy] : [xy]
      s.set({ clicks })
      if (clicks.length < 2) return
      const [a, b] = clicks
      if (s.tool === 'region') {
        if (!m.axis) return
        const mask = s.mask?.on ? s.layers.find(l => l.id === s.mask!.layer) : null
        const keep = mask ? makeMask(mask.values, s.mask!.lo, s.mask!.hi) : null
        const px = rectPixels(m, a[0], a[1], b[0], b[1]).filter(p => !keep || keep[p])
        const mean = meanSpectrum(m, px)
        s.set({ preview: { kind: 'spectrum', title: `Region mean of ${mean.n} pixels`, x: mean.x, y: mean.y } })
      } else {
        const layer = s.layers.find(l => l.id === s.active)
        if (!layer) return
        const pr = profile(m, layer.values, a[0], a[1], b[0], b[1])
        s.set({ preview: { kind: 'profile', title: `Profile of ${layer.name}`, x: pr.d, y: pr.val } })
      }
    }
    el.on('plotly_click', onClick)
    return () => el.removeAllListeners?.('plotly_click')
  }, [ready])

  const st = useStore()
  const sendPreview = () => {
    const p = ms.preview, m = ms.map
    if (!p || !m) return
    if (p.kind === 'profile') return download(`${m.name}_profile.csv`, ['distance,value', ...p.x.map((d, i) => `${d},${p.y[i]}`)].join('\n'), 'text/csv')
    st.addSpectrum(`${m.name} ${p.title.toLowerCase()}`, p.x, p.y, m.technique)
    st.set({ error: `Added “${p.title}” to the ${TECH[m.technique].label} workspace.` })
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {ready && (
        <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-1 text-xs dark:border-slate-800">
          <span className="text-slate-500">Click mode:</span>
          {(['pixel', 'region', 'line'] as Tool[]).map(t => (
            <button key={t} className={`btn ${ms.tool === t ? 'btn-primary' : ''}`} onClick={() => ms.set({ tool: t, clicks: [] })}>
              {t === 'pixel' ? 'Pixel spectrum' : t === 'region' ? 'Region mean (2 corners)' : 'Line profile (2 ends)'}
            </button>
          ))}
          <div className="flex-1" />
          <FigureExport figure={print => mapFigure(useMap.getState(), dark, useStore.getState().fig, print)} filename={`${ms.map!.name}_${ms.layers.find(l => l.id === ms.active)?.name ?? 'map'}`} />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={ref} className="absolute inset-0" />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-slate-400">
            Load a Raman, FTIR or XRD map (or an element map) in the Map tab on the right, then add map types.
          </div>
        )}
      </div>
      {ms.preview && (
        <div className="relative h-56 shrink-0 border-t border-slate-200 dark:border-slate-800">
          <div ref={pref} className="absolute inset-0" />
          <div className="absolute right-2 top-1 flex gap-1">
            <button className="btn" onClick={sendPreview}>{ms.preview.kind === 'profile' ? 'Profile .csv' : 'Send to workspace'}</button>
            <button className="btn" title="Close" onClick={() => ms.set({ preview: null, clicks: [] })}><XIcon /></button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MapPanel() {
  const st = useStore()
  const ms = useMap()
  const m = ms.map
  const [kind, setKind] = useState<MapKind>('auto')
  const [dims, setDims] = useState(['', ''])
  const [busy, setBusy] = useState('')
  const [mk, setMk] = useState<MetricKind>('intensity')
  const [x1, setX1] = useState('')
  const [x2, setX2] = useState('')
  const [cal, setCal] = useState('1')
  const [norm, setNorm] = useState(false)
  const [calcA, setCalcA] = useState(''), [calcB, setCalcB] = useState(''), [op, setOp] = useState<CalcOp>('÷')
  const [k, setK] = useState(3)
  const [examples, setExamples] = useState<Example[]>([])
  useEffect(() => { import('./store').then(s => s.api<Example[]>('/examples')).then(e => setExamples(e.filter(x => x.map))).catch(() => {}) }, [])
  const active = ms.layers.find(l => l.id === ms.active)

  const addLayer = (l: Layer) => {
    // e.g. a band window outside the map's axis: say so instead of drawing an empty map
    if (!l.values.some(v => Number.isFinite(v) && v !== 0)) {
      const ax = m?.axis
      return st.fail(`“${l.name}” has no values${ax ? `: check the positions against the map's axis (${Math.round(Math.min(ax[0], ax[ax.length - 1]))}–${Math.round(Math.max(ax[0], ax[ax.length - 1]))})` : ''}`)
    }
    ms.set({ layers: [...useMap.getState().layers, l], active: l.id })
  }

  // a new spectral map replaces the old one; a value grid becomes a layer of the current map when it fits
  const accept = (nm: SpecMap) => {
    const cur = useMap.getState().map
    if (!nm.axis) {
      if (cur && cur.nx === nm.nx && cur.ny === nm.ny) return addLayer(newLayer(nm.name, nm.cube!, 'imported grid'))
      const l = newLayer(nm.name, nm.cube!, 'imported grid')
      return ms.set({ map: { ...nm, cube: null }, layers: [l], active: l.id, mask: null, preview: null, clicks: [] })
    }
    const a = nm.axis
    const lo = a[0], hi = a[a.length - 1]
    const total = newLayer('Total intensity', metric(nm, 'area', lo, hi), `area ${lo.toFixed(0)}–${hi.toFixed(0)}`)
    ms.set({ map: nm, layers: [total], active: total.id, mask: null, preview: null, clicks: [] })
    setX1(String(Math.round(lo + (hi - lo) * 0.4)))
    setX2(String(Math.round(lo + (hi - lo) * 0.6)))
  }

  const load = async (f: File) => {
    setBusy(`Reading ${f.name}…`)
    try {
      const t = st.technique, lower = f.name.toLowerCase()
      if (/\.(png|jpe?g|tiff?|bmp|gif|webp)$/.test(lower)) accept(await parseMapImage(f.name.replace(/\.[^.]+$/, ''), f, t))
      else if (lower.endsWith('.wdf')) accept(decodeBinaryMap(await mapBinary(f), t))
      else accept(parseMapText(f.name.replace(/\.[^.]+$/, ''), await f.text(), t, kind, +dims[0] || undefined, +dims[1] || undefined))
    } catch (e) { st.fail(e) } finally { setBusy('') }
  }
  const loadExample = async (file: string) => {
    const ex = examples.find(e => e.file === file)
    if (!ex) return
    if (st.technique !== ex.technique) st.setTechnique(ex.technique)
    await load(await exampleFile(file))
  }
  // example chosen in the Data panel's list
  useEffect(() => {
    const f = st.mapExample
    if (f && examples.length) { st.set({ mapExample: undefined }); loadExample(f) }
  }, [st.mapExample, examples.length])
  const addMetric = () => {
    if (!m?.axis) return
    const a = +x1, b = x2 === '' ? a : +x2
    if (!Number.isFinite(a) || !Number.isFinite(b)) return st.fail('Enter x₁ (and x₂) in axis units')
    let v = metric(m, mk, a, b)
    const c = +cal
    if (Number.isFinite(c) && c !== 1) v = v.map(x => x * c)
    if (norm) v = normalize01(v)
    const label = METRICS.find(q => q[0] === mk)![1].split(' ')[0]
    const where = ['intensity'].includes(mk) ? `${a}` : ['ratio', 'logratio'].includes(mk) ? `${a}/${b}` : `${Math.min(a, b)}–${Math.max(a, b)}`
    addLayer(newLayer(`${label} ${where}${c !== 1 ? ` ×${c}` : ''}${norm ? ' (0–1)' : ''}`, v, METRICS.find(q => q[0] === mk)![2]))
  }
  const doCalc = () => {
    const A = ms.layers.find(l => l.id === calcA), B = ms.layers.find(l => l.id === calcB)
    if (!A || !B) return st.fail('Choose two maps')
    addLayer(newLayer(`(${A.name}) ${op} (${B.name})`, calc(A.values, B.values, op), 'map calculator'))
  }
  const doClassify = () => {
    if (!m?.axis) return
    try {
      const mask = ms.mask?.on ? ms.layers.find(l => l.id === ms.mask!.layer) : null
      const keep = mask ? makeMask(mask.values, ms.mask!.lo, ms.mask!.hi) : null
      const a = +x1 || m.axis[0], b = +x2 || m.axis[m.axis.length - 1]
      const r = classify(m, k, a, b, keep)
      addLayer(newLayer(`Classes (k=${k})`, r.labels, `k-means on ${Math.min(a, b)}–${Math.max(a, b)}`))
      r.means.forEach((mean, i) => mean.n && st.addSpectrum(`${m.name} class ${i + 1} mean (${mean.n} px)`, mean.x, mean.y, m.technique))
      st.set({ error: `${k} classes added; their mean spectra are in the ${TECH[m.technique].label} workspace.` })
    } catch (e) { st.fail(e) }
  }
  const setMask = (p: Partial<NonNullable<MapState['mask']>>) => {
    const cur = ms.mask ?? (() => { const l = ms.layers[0]; const [lo, hi] = rangeOf(l.values, false); return { layer: l.id, lo, hi, on: false } })()
    let next = { ...cur, ...p }
    if (p.layer && p.layer !== cur.layer) { const [lo, hi] = rangeOf(ms.layers.find(l => l.id === p.layer)!.values, false); next = { ...next, lo, hi } }
    ms.set({ mask: next })
  }
  const stats = useMemo(() => active ? (() => { const f = Array.from(active.values).filter(Number.isFinite); const mean = f.reduce((t, v) => t + v, 0) / (f.length || 1); return { n: f.length, mean, min: Math.min(...f), max: Math.max(...f) } })() : null, [active])
  const csv = (l: Layer) => {
    if (!m) return
    const rows = ['x,y,' + l.name.replace(/,/g, ' ')]
    for (let iy = 0; iy < m.ny; iy++) for (let ix = 0; ix < m.nx; ix++) rows.push(`${m.x[ix]},${m.y[iy]},${l.values[iy * m.nx + ix]}`)
    download(`${m.name}_${l.name.replace(/[^\w.-]+/g, '_')}.csv`, rows.join('\n'), 'text/csv')
  }
  const field = (label: string, v: string, set: (s: string) => void, ph = '') => (
    <label className="flex items-center justify-between gap-2">{label}<input className="field !w-24" value={v} placeholder={ph} onChange={e => set(e.target.value)} /></label>
  )

  return (
    <div className="space-y-2 text-xs">
      <div className="card space-y-1.5">
        <div className="label">1 · Load a map</div>
        <label className="flex items-center justify-between gap-2">Read text as
          <select className="field !w-44" value={kind} onChange={e => setKind(e.target.value as MapKind)}>{MAP_KINDS.map(([v, l]) => <option key={v} value={v} title={l}>{l.split(':')[0]}</option>)}</select>
        </label>
        {kind === 'matrix' && <div className="flex gap-1">{field('nX', dims[0], v => setDims([v, dims[1]]), 'auto')}{field('nY', dims[1], v => setDims([dims[0], v]), 'auto')}</div>}
        <label className="btn btn-primary w-full cursor-pointer">{busy || 'Open map file (text, .wdf, or image)'}
          <input type="file" className="hidden" accept=".txt,.csv,.dat,.tsv,.xy,.wdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f) }} />
        </label>
        {examples.length > 0 && (
          <select className="field" value="" onChange={e => e.target.value && loadExample(e.target.value)}>
            <option value="">Open an example map…</option>
            {examples.map(e => <option key={e.file} value={e.file}>{e.title}</option>)}
          </select>
        )}
        <p className="text-[11px] text-slate-500">Spectral maps load as {TECH[st.technique].label}. A value grid or image of the same size is added as a layer (element maps from EPMA, EDS, LA-ICP-MS…).</p>
        {m && <p className="text-[11px] text-slate-600 dark:text-slate-300">{m.name}: {m.nx} × {m.ny} pixels{m.axis ? `, ${m.axis.length} points ${m.axis[0].toFixed(0)}–${m.axis[m.axis.length - 1].toFixed(0)}` : ', values only'}</p>}
      </div>

      {m?.axis && (
        <div className="card space-y-1.5">
          <div className="label">2 · Map type</div>
          <select className="field" value={mk} onChange={e => setMk(e.target.value as MetricKind)}>{METRICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <div className="flex gap-1">{field('x₁', x1, setX1)}{mk !== 'intensity' && mk !== 'quality' && field('x₂', x2, setX2)}</div>
          <div className="flex gap-1">{field('Calibration ×C', cal, setCal)}<label className="flex items-center gap-1"><input type="checkbox" checked={norm} onChange={e => setNorm(e.target.checked)} /> 0–1</label></div>
          <button className="btn btn-primary w-full" onClick={addMetric}>Add map</button>
          <p className="text-[11px] text-slate-500">{METRICS.find(q => q[0] === mk)?.[2]}. Click a pixel to see its spectrum and read off band positions.</p>
        </div>
      )}

      {m?.axis && m.technique === 'ftir' && (
        <Water onFactor={(k, [a, b]) => addLayer(newLayer(`H₂O ppm ${Math.min(a, b)}–${Math.max(a, b)}`, metric(m, 'area', a, b).map(v => v * k), `integrated absorbance × ${k.toPrecision(4)} ppm per cm⁻²`))} />
      )}

      {ms.layers.length > 0 && (
        <div className="card space-y-1">
          <div className="label">Maps ({ms.layers.length})</div>
          {ms.layers.map(l => (
            <div key={l.id} className={`flex items-center gap-1 rounded px-1 ${l.id === ms.active ? 'bg-teal-500/10' : ''}`}>
              <input type="radio" checked={l.id === ms.active} onChange={() => ms.set({ active: l.id })} />
              <span className="flex-1 truncate" title={l.note}>{l.name}</span>
              <button className="text-[11px] text-slate-500 hover:text-teal-500" onClick={() => csv(l)}>csv</button>
              <button className="text-slate-400 hover:text-rose-500" title="Remove" onClick={() => { const rest = ms.layers.filter(x => x.id !== l.id); ms.set({ layers: rest, active: rest[0]?.id ?? null, mask: ms.mask?.layer === l.id ? null : ms.mask }) }}><XIcon className="h-3 w-3" /></button>
            </div>
          ))}
          {stats && <p className="text-[11px] text-slate-500">{stats.n} px · mean {stats.mean.toPrecision(4)} · range {stats.min.toPrecision(4)}–{stats.max.toPrecision(4)}</p>}
          <div className="grid grid-cols-2 gap-1 pt-1">
            <select className="field" value={ms.colors} onChange={e => ms.set({ colors: e.target.value })}>{SCALES.map(s => <option key={s}>{s}</option>)}</select>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1" title="Colour range from the 2nd to 98th percentile"><input type="checkbox" checked={ms.clip} onChange={e => ms.set({ clip: e.target.checked })} /> 2–98%</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={ms.log} onChange={e => ms.set({ log: e.target.checked })} /> log</label>
            </div>
          </div>
        </div>
      )}

      {ms.layers.length > 1 && (
        <div className="card space-y-1">
          <div className="label">Map calculator</div>
          <div className="flex items-center gap-1">
            <select className="field" value={calcA} onChange={e => setCalcA(e.target.value)}><option value="">A…</option>{ms.layers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            <select className="field !w-12" value={op} onChange={e => setOp(e.target.value as CalcOp)}>{(['+', '−', '×', '÷'] as CalcOp[]).map(o => <option key={o}>{o}</option>)}</select>
            <select className="field" value={calcB} onChange={e => setCalcB(e.target.value)}><option value="">B…</option>{ms.layers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </div>
          <button className="btn w-full" onClick={doCalc}>Add A {op} B</button>
        </div>
      )}

      {ms.layers.length > 0 && (
        <div className="card space-y-1">
          <div className="label">Mask (keep pixels in a value range)</div>
          <select className="field" value={ms.mask?.layer ?? ''} onChange={e => setMask({ layer: e.target.value })}><option value="" disabled>Map to filter on…</option>{ms.layers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          {ms.mask && (
            <>
              <div className="flex gap-1">
                <label className="flex items-center gap-1">min<input type="number" className="field" value={ms.mask.lo} onChange={e => setMask({ lo: +e.target.value })} /></label>
                <label className="flex items-center gap-1">max<input type="number" className="field" value={ms.mask.hi} onChange={e => setMask({ hi: +e.target.value })} /></label>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={ms.mask.on} onChange={e => setMask({ on: e.target.checked })} /> Apply (also to region means and classes)</label>
            </>
          )}
        </div>
      )}

      {m?.axis && (
        <div className="card space-y-1">
          <div className="label">Classes (k-means)</div>
          <label className="flex items-center justify-between gap-2">Number of classes<input type="number" min={2} max={10} className="field !w-16" value={k} onChange={e => setK(Math.max(2, Math.min(10, +e.target.value || 2)))} /></label>
          <button className="btn w-full" onClick={doClassify}>Classify spectra in x₁–x₂</button>
          <p className="text-[11px] text-slate-500">Groups pixels by spectral shape (area-normalised); each class mean goes to the workspace for identification.</p>
        </div>
      )}
    </div>
  )
}
