// Preprocess tab: live parameter editors, presets, batch apply. Author: Kishan Tiwari
import { STEP_LABEL, download, useActive, useStore, type Step } from './store'

function Slider(p: { label: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; on: (v: number) => void }) {
  return (
    <label className="block text-xs">
      <span className="flex justify-between"><span>{p.label}</span><span className="tabular-nums text-slate-500">{p.fmt ? p.fmt(p.value) : p.value}</span></span>
      <input type="range" className="w-full accent-teal-600" min={p.min} max={p.max} step={p.step} value={p.value} onChange={e => p.on(+e.target.value)} />
    </label>
  )
}

function Select(p: { value: string; options: [string, string][]; on: (v: string) => void }) {
  return (
    <select className="field" value={p.value} onChange={e => p.on(e.target.value)}>
      {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

function Params({ step, set }: { step: Step; set: (params: Record<string, any>) => void }) {
  const q = step.params
  const up = (k: string) => (v: number | string) => set({ ...q, [k]: v })
  switch (step.type) {
    case 'crop':
      return (
        <div className="flex items-center gap-1 text-xs">
          <input type="number" className="field" value={q.min} onChange={e => up('min')(+e.target.value)} /> to
          <input type="number" className="field" value={q.max} onChange={e => up('max')(+e.target.value)} />
        </div>
      )
    case 'despike':
      return (<>
        <Slider label="Threshold (modified Z)" value={q.threshold} min={3} max={25} step={0.5} on={up('threshold')} />
        <Slider label="Kernel half-width (points)" value={q.width} min={1} max={10} step={1} on={up('width')} />
      </>)
    case 'baseline':
      return (<>
        <Select value={q.method} on={up('method')} options={[['als', 'Asymmetric least squares (ALS)'], ['airpls', 'airPLS'], ['poly', 'Polynomial (iterative)'], ['rubberband', 'Rubberband (convex hull)']]} />
        {(q.method === 'als' || q.method === 'airpls') && <Slider label="Smoothness λ" value={q.lam} min={2} max={9} step={0.1} fmt={v => `10^${v.toFixed(1)}`} on={up('lam')} />}
        {q.method === 'als' && <Slider label="Asymmetry p" value={q.p} min={0.001} max={0.1} step={0.001} fmt={v => v.toFixed(3)} on={up('p')} />}
        {q.method === 'poly' && <Slider label="Polynomial order" value={q.order} min={1} max={9} step={1} on={up('order')} />}
      </>)
    case 'smooth':
      return (<>
        <Select value={q.method} on={up('method')} options={[['savgol', 'Savitzky–Golay'], ['moving', 'Moving average']]} />
        <Slider label="Window (points)" value={q.window} min={3} max={51} step={2} on={up('window')} />
        {q.method === 'savgol' && <Slider label="Polynomial order" value={q.order} min={1} max={5} step={1} on={up('order')} />}
      </>)
    case 'normalize':
      return <Select value={q.method} on={up('method')} options={[['minmax', 'Min–Max (0–1)'], ['vector', 'Vector (L2)'], ['area', 'Area'], ['snv', 'Standard normal variate (SNV)']]} />
    case 'derivative':
      return (<>
        <Select value={String(q.order)} on={v => up('order')(+v)} options={[['1', 'First derivative'], ['2', 'Second derivative']]} />
        <Slider label="Savitzky–Golay window (points)" value={q.window} min={5} max={51} step={2} on={up('window')} />
      </>)
    case 'convert':
      return (<>
        <Select value={q.mode} on={up('mode')} options={[['t2a', 'Transmittance → absorbance'], ['a2t', 'Absorbance → %transmittance'], ['nm2shift', 'Wavelength (nm) → Raman shift'], ['nm2wn', 'Wavelength (nm) → wavenumber']]} />
        {q.mode === 'nm2shift' && (
          <label className="flex items-center justify-between gap-2 text-xs">Laser (nm)
            <input type="number" className="field !w-24" value={q.laser} onChange={e => up('laser')(+e.target.value)} />
          </label>
        )}
      </>)
    case 'resample':
      return (
        <label className="flex items-center justify-between gap-2 text-xs">Step (x units)
          <input type="number" step="0.1" min="0.001" className="field !w-24" value={q.step} onChange={e => up('step')(+e.target.value)} />
        </label>
      )
    case 'shift':
      return (<>
        <Slider label="Offset added to x" value={q.dx} min={-30} max={30} step={0.1} fmt={v => v.toFixed(1)} on={up('dx')} />
        <p className="text-[11px] text-slate-500">Calibrate against a standard, e.g. Si at 520.7 cm⁻¹.</p>
      </>)
  }
}

export default function Preprocess() {
  const st = useStore()
  const a = useActive()
  if (!a) return <p className="text-xs text-slate-500">Load a spectrum to start preprocessing.</p>
  const setStep = (id: string, p: Partial<Step>) => st.setPipeline(a.id, a.pipeline.map(s => (s.id === id ? { ...s, ...p } : s)))

  const loadPreset = async (f: File) => {
    try {
      const steps = JSON.parse(await f.text()).steps as Step[]
      if (!Array.isArray(steps) || steps.some(s => !(s.type in STEP_LABEL))) throw new Error('Not a Wavenum preset')
      st.setPipeline(a.id, steps.map((s, i) => ({ ...s, id: `p${Date.now()}${i}` })))
    } catch (e) { st.fail(e) }
  }

  return (
    <div className="space-y-2">
      {a.pipeline.map((step, i) => (
        <div key={step.id} className={`card space-y-1.5 ${step.enabled ? '' : 'opacity-60'}`}>
          <label className="flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" checked={step.enabled} onChange={e => setStep(step.id, { enabled: e.target.checked })} />
            {i + 1}. {STEP_LABEL[step.type]}
          </label>
          <Params step={step} set={params => setStep(step.id, { params, enabled: true })} />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-1">
        <button className="btn" disabled={!st.history.length} onClick={st.undo}>Undo</button>
        <button className="btn" disabled={st.spectra.length < 2} onClick={st.applyToAll}>Batch apply to all</button>
        <button className="btn" onClick={() => download('wavenum_preset.json', JSON.stringify({ app: 'Wavenum', steps: a.pipeline.map(({ id, ...s }) => s) }, null, 2), 'application/json')}>Save preset</button>
        <label className="btn cursor-pointer">Load preset
          <input type="file" accept=".json" className="hidden" onChange={e => { if (e.target.files?.[0]) loadPreset(e.target.files[0]); e.target.value = '' }} />
        </label>
      </div>
      <p className="text-[11px] text-slate-500">Steps run top to bottom on the raw data, which is never modified. Reorder or remove steps in the left sidebar.</p>
    </div>
  )
}
