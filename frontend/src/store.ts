// Wavenum state + API client. Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
import { create } from 'zustand'

export type Technique = 'raman' | 'xrd' | 'ftir'

// Single place that defines what switching technique changes.
export const TECH: Record<Technique, { label: string; x: string; y: string; reversed: boolean; tol: number; unit: string }> = {
  raman: { label: 'Raman', x: 'Raman shift (cm⁻¹)', y: 'Intensity (a.u.)', reversed: false, tol: 8, unit: 'cm⁻¹' },
  xrd: { label: 'XRD', x: '2θ (°)', y: 'Intensity (counts)', reversed: false, tol: 0.2, unit: '°' },
  ftir: { label: 'FTIR', x: 'Wavenumber (cm⁻¹)', y: 'Absorbance', reversed: true, tol: 8, unit: 'cm⁻¹' },
}

export type StepType = 'crop' | 'despike' | 'baseline' | 'smooth' | 'normalize' | 'derivative' | 'convert' | 'resample' | 'shift'
export type Step = { id: string; type: StepType; enabled: boolean; params: Record<string, any> }
export type Peak = { x: number; y: number; fwhm?: number }
export type FitRow = { center: number; height: number; fwhm: number; area: number; r2: number }
export type Fit = { x: number[]; fit: number[]; residual: number[]; components: number[][]; table: FitRow[]; r2: number; profile: string }
export type Proc = { x: number[]; y: number[]; baseline?: { x: number[]; y: number[]; input: number[] } }
export type Spectrum = {
  id: string; name: string; color: string; visible: boolean; technique: Technique
  x: number[]; y: number[]; pipeline: Step[]; proc?: Proc; peaks: Peak[]; fit?: Fit
}
export type Match = {
  name: string; formula: string; system: string; info: string; library: string
  score: number; cosine: number; pearson: number; peak: number
  pairs: [number, number][]; ref_peaks: [number, number][]; ref: { x: number[]; y: number[] }
}
export type Mixture = { r2: number; single_r2: number; gain: number; likely: boolean; components: { name: string; fraction: number }[] }
export type Lib = { id: string; title: string; technique: Technique; kind: string; citation: string; n: number }
export type Fig = { font: string; size: number; xLabel: string; yLabel: string; ticks: 'outside' | 'inside'; legend: boolean; width: number; height: number; scale: number }
export type Tab = 'pre' | 'peaks' | 'id' | 'pca' | 'dig'

const COLORS = ['#0d9488', '#e11d48', '#2563eb', '#d97706', '#7c3aed', '#16a34a', '#db2777', '#0891b2', '#ca8a04', '#475569']
const uid = () => Math.random().toString(36).slice(2, 9)

export const STEP_LABEL: Record<StepType, string> = {
  crop: 'Crop range', despike: 'Cosmic-ray despike', baseline: 'Baseline correction', smooth: 'Smoothing', normalize: 'Normalization',
  derivative: 'Derivative', convert: 'Unit conversion', resample: 'Resample / interpolate', shift: 'X calibration shift',
}

// [min, max] without spreading (Math.min(...a) overflows the stack on long arrays)
export function extent(a: number[]): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v }
  return [lo, hi]
}

export function newStep(type: StepType, x: number[], enabled = true): Step {
  const [lo, hi] = extent(x)
  const params: Record<StepType, Record<string, any>> = {
    crop: { min: Math.floor(lo), max: Math.ceil(hi) }, despike: { threshold: 7, width: 3 },
    baseline: { method: 'als', lam: 6, p: 0.01, order: 3 }, smooth: { method: 'savgol', window: 9, order: 3 },
    normalize: { method: 'minmax' }, derivative: { order: 1, window: 11, poly: 3 },
    convert: { mode: 't2a', laser: 532 }, resample: { step: 1 }, shift: { dx: 0 },
  }
  return { id: uid(), type, enabled, params: params[type] }
}

export const defaultPipeline = (x: number[]): Step[] =>
  (['crop', 'despike', 'baseline', 'smooth', 'normalize'] as StepType[]).map(t => newStep(t, x, false))

// In the desktop app (Tauri) requests go to Rust commands; in the browser to the Python server.
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const COMMANDS: Record<string, string> = {
  '/process': 'process', '/peaks/find': 'peaks_find', '/peaks/fit': 'peaks_fit', '/libraries': 'libraries',
  '/libraries/search': 'libraries_search', '/libraries/entry': 'libraries_entry', '/libraries/import': 'libraries_import',
  '/match': 'match_spectrum', '/pca': 'pca', '/examples': 'examples', '/libraries/build': 'libraries_build', '/libraries/build/status': 'libraries_build_status',
}

async function viaTauri<T>(path: string, body?: unknown): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  const [route, query] = path.split('?')
  try {
    if (route === '/parse') {
      const f = (body as FormData).get('file') as File
      return await invoke<T>('parse', new Uint8Array(await f.arrayBuffer()), { headers: { 'x-name': encodeURIComponent(f.name) } })
    }
    const cmd = COMMANDS[route]
    if (!cmd) throw new Error(`Not available in the desktop app: ${route}`)
    let req: any = body
    if (query) {
      req = Object.fromEntries(new URLSearchParams(query))
      if ('k' in req) req.k = Number(req.k)
    }
    return await invoke<T>(cmd, req === undefined ? {} : { req })
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e))
  }
}

export type Example = { file: string; technique: Technique; title: string; learn: string; digitizer?: boolean }

/** One bundled example as a File, from the Python server or the desktop app's resources. */
export async function exampleFile(name: string): Promise<File> {
  if (inTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    const buf = await invoke<ArrayBuffer>('example_file', { req: { name } })
    return new File([buf], name)
  }
  const r = await fetch(`/api/examples/${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`Could not load example ${name}`)
  return new File([await r.blob()], name)
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  if (inTauri) return viaTauri<T>(path, body)
  const init: RequestInit = body === undefined ? {} : body instanceof FormData
    ? { method: 'POST', body }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  const r = await fetch('/api' + path, init)
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `${r.status} ${r.statusText}`)
  return r.json()
}

type State = {
  technique: Technique; dark: boolean; tab: Tab
  spectra: Spectrum[]; activeId: string | null
  plotMode: 'overlay' | 'stacked'; showBaseline: boolean; peakEdit: boolean
  matches: Match[]; mixture: Mixture | null; selMatch: number | null
  fig: Fig; history: { id: string; pipeline: Step[] }[]; error: string | null
  set: (p: Partial<State>) => void
  setTechnique: (t: Technique) => void
  addSpectrum: (name: string, x: number[], y: number[], technique?: Technique) => void
  patch: (id: string, p: Partial<Spectrum>) => void
  remove: (id: string) => void
  setPipeline: (id: string, pipeline: Step[]) => void
  undo: () => void
  applyToAll: () => void
  loadSession: (o: any) => void
  fail: (e: unknown) => void
}

const timers: Record<string, ReturnType<typeof setTimeout>> = {}
let lastPush = 0

export const useStore = create<State>((set, get) => {
  // Debounced so slider drags give a live preview without flooding the backend.
  const reprocess = (id: string) => {
    clearTimeout(timers[id])
    timers[id] = setTimeout(async () => {
      const s = get().spectra.find(s => s.id === id)
      if (!s) return
      try {
        const proc = await api<Proc>('/process', { x: s.x, y: s.y, steps: s.pipeline })
        get().patch(id, { proc, fit: undefined })
      } catch (e) { get().fail(e) }
    }, 60)
  }
  return {
    technique: 'raman', dark: true, tab: 'pre', spectra: [], activeId: null,
    plotMode: 'overlay', showBaseline: false, peakEdit: false,
    matches: [], mixture: null, selMatch: null,
    fig: { font: 'Arial', size: 14, xLabel: '', yLabel: '', ticks: 'outside', legend: true, width: 1200, height: 700, scale: 3 },
    history: [], error: null,
    set: p => set(p),
    setTechnique: technique => set(st => ({
      technique, matches: [], mixture: null, selMatch: null,
      activeId: st.spectra.find(s => s.technique === technique)?.id ?? null,
    })),
    addSpectrum: (name, x, y, technique) => {
      const id = uid()
      const color = COLORS[get().spectra.length % COLORS.length]
      set(st => ({
        spectra: [...st.spectra, { id, name, color, visible: true, technique: technique ?? st.technique, x, y, pipeline: defaultPipeline(x), peaks: [] }],
        activeId: id,
      }))
      reprocess(id)
    },
    patch: (id, p) => set(st => ({ spectra: st.spectra.map(s => (s.id === id ? { ...s, ...p } : s)) })),
    remove: id => set(st => {
      const spectra = st.spectra.filter(s => s.id !== id)
      return { spectra, activeId: st.activeId === id ? spectra.find(s => s.technique === st.technique)?.id ?? null : st.activeId }
    }),
    setPipeline: (id, pipeline) => {
      const old = get().spectra.find(s => s.id === id)
      if (!old) return
      // one undo entry per gesture: slider drags arrive as a burst of updates
      const now = Date.now()
      const h = get().history
      if (now - lastPush > 400 || h[h.length - 1]?.id !== id) set({ history: [...h.slice(-99), { id, pipeline: old.pipeline }] })
      lastPush = now
      get().patch(id, { pipeline })
      reprocess(id)
    },
    undo: () => {
      const h = get().history
      const last = h[h.length - 1]
      if (!last) return
      set({ history: h.slice(0, -1) })
      get().patch(last.id, { pipeline: last.pipeline })
      reprocess(last.id)
    },
    applyToAll: () => {
      const a = get().spectra.find(s => s.id === get().activeId)
      if (!a) return
      for (const s of get().spectra) {
        if (s.id === a.id || s.technique !== a.technique) continue
        lastPush = 0 // each spectrum gets its own undo entry
        get().setPipeline(s.id, a.pipeline.map(st => ({ ...st, id: uid(), params: { ...st.params } })))
      }
    },
    loadSession: o => {
      if (o?.app !== 'Wavenum' || !Array.isArray(o.spectra)) throw new Error('Not a Wavenum session file')
      const spectra: Spectrum[] = o.spectra.map((s: any) => ({ ...s, id: uid(), peaks: s.peaks ?? [], proc: undefined, fit: undefined }))
      const technique: Technique = o.technique in TECH ? o.technique : 'raman'
      set({ spectra, technique, fig: { ...get().fig, ...o.fig }, history: [], matches: [], mixture: null, selMatch: null,
        activeId: spectra.find(s => s.technique === technique)?.id ?? null })
      spectra.forEach(s => reprocess(s.id))
    },
    fail: e => set({ error: e instanceof Error ? e.message : String(e) }),
  }
})

export const useActive = () => useStore(s => s.spectra.find(x => x.id === s.activeId && x.technique === s.technique))
// What analysis (peaks, fitting, matching) operates on: the processed data once available.
export const dataOf = (s: Spectrum) => s.proc ?? { x: s.x, y: s.y }

// Linear interpolation of (x, y) at xi; x ascending. Outside the range -> NaN.
export function interp(x: number[], y: number[], xi: number[]): number[] {
  let j = 0
  return xi.map(v => {
    if (v < x[0] || v > x[x.length - 1]) return NaN
    while (j < x.length - 2 && x[j + 1] < v) j++
    const t = (v - x[j]) / (x[j + 1] - x[j] || 1)
    return y[j] + t * (y[j + 1] - y[j])
  })
}

export function download(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}
