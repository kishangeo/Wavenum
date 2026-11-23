// Left sidebar: upload, spectra manager, arithmetic, session, pipeline stack. Author: Kishan Tiwari
import { useEffect, useState } from 'react'
import { DownIcon, UpIcon, XIcon } from './icons'
import { loadDigitizerFile } from './Digitizer'
import { STEP_LABEL, TECH, api, dataOf, download, exampleFile, interp, newStep, useActive, useStore, type Example, type StepType } from './store'

type Pending = { name: string; columns: string[]; data: number[][]; xi: number; yi: number }

export default function Sidebar() {
  const st = useStore()
  const active = useActive()
  const [pending, setPending] = useState<Pending[]>([])
  const [over, setOver] = useState(false)
  const [subId, setSubId] = useState('')
  const [subK, setSubK] = useState('1')
  const mine = st.spectra.filter(s => s.technique === st.technique)
  const others = st.spectra.length - mine.length
  const [examples, setExamples] = useState<Example[]>([])
  useEffect(() => { api<Example[]>('/examples').then(e => setExamples(e)).catch(() => setExamples([])) }, [])
  // the tip belongs to the technique it was shown for, so switching technique hides it
  const [hint, setHint] = useState<{ tech: string; text: string } | null>(null)
  const exHint = hint?.tech === st.technique ? hint.text : ''
  const setExHint = (text: string) => setHint(text ? { tech: useStore.getState().technique, text } : null)

  // Example files load exactly like a user's file: same parser, same column picker.
  const openExample = async (file: string) => {
    const ex = examples.find(e => e.file === file)
    if (!ex) return
    try {
      const f = await exampleFile(ex.file)
      if (ex.digitizer) {
        setExHint(ex.learn)
        st.set({ tab: 'dig' })
        await loadDigitizerFile(f)
        return
      }
      if (useStore.getState().technique !== ex.technique) st.setTechnique(ex.technique)
      setExHint(ex.learn)
      await upload([f])
    } catch (e) { st.fail(e) }
  }

  const upload = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      try {
        if (f.name.toLowerCase().endsWith('.wavenum.json')) { st.loadSession(JSON.parse(await f.text())); continue }
        const fd = new FormData()
        fd.append('file', f)
        const t = await api<{ columns: string[]; data: number[][] }>('/parse', fd)
        const name = f.name.replace(/\.[^.]+$/, '')
        if (t.columns.length === 2) st.addSpectrum(name, t.data[0], t.data[1])
        else setPending(p => [...p, { name, ...t, xi: 0, yi: 1 }])
      } catch (e) { st.fail(`${f.name}: ${e instanceof Error ? e.message : e}`) }
    }
  }
  const move = (i: number, d: number) => {
    if (!active) return
    const p = [...active.pipeline]
    const j = i + d
    if (j < 0 || j >= p.length) return
    ;[p[i], p[j]] = [p[j], p[i]]
    st.setPipeline(active.id, p)
  }

  // Arithmetic works on processed data, on the x grid of the first / active spectrum.
  const average = () => {
    const vis = mine.filter(s => s.visible).map(dataOf)
    if (vis.length < 2) return st.fail('Show at least two spectra to average')
    const x = vis[0].x
    const cols = vis.map(d => interp(d.x, d.y, x))
    const keep = x.map((_, i) => cols.every(c => !Number.isNaN(c[i])))
    st.addSpectrum(`average of ${vis.length}`, x.filter((_, i) => keep[i]), x.map((_, i) => cols.reduce((s, c) => s + c[i], 0) / cols.length).filter((_, i) => keep[i]))
  }
  const subtract = () => {
    const b = mine.find(s => s.id === subId)
    const k = +subK
    if (!active || !b || !Number.isFinite(k)) return st.fail('Pick a spectrum to subtract and a numeric factor')
    const a = dataOf(active), bi = interp(dataOf(b).x, dataOf(b).y, a.x)
    const keep = bi.map(v => !Number.isNaN(v))
    st.addSpectrum(`${active.name} − ${k}×${b.name}`, a.x.filter((_, i) => keep[i]), a.y.map((v, i) => v - k * bi[i]).filter((_, i) => keep[i]))
  }
  const saveSession = () => download('session.wavenum.json', JSON.stringify({
    app: 'Wavenum', version: 1, technique: st.technique, fig: st.fig,
    spectra: st.spectra.map(({ id, proc, fit, ...s }) => s),
  }), 'application/json')
  // One wide CSV: each spectrum contributes its own x and y column pair (grids may differ).
  const exportAll = () => {
    const ds = mine.map(s => ({ name: s.name.replace(/,/g, ' '), ...dataOf(s) }))
    const n = Math.max(...ds.map(d => d.x.length))
    const rows = [ds.map(d => `${d.name} x,${d.name} y`).join(',')]
    for (let i = 0; i < n; i++) rows.push(ds.map(d => (i < d.x.length ? `${d.x[i]},${d.y[i]}` : ',')).join(','))
    download(`wavenum_${st.technique}_all.csv`, rows.join('\n'), 'text/csv')
  }

  return (
    <aside className="flex w-full min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-slate-50 p-2.5 dark:bg-slate-950">
      <label
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) }}
        className={`flex cursor-pointer flex-col items-center rounded border-2 border-dashed p-3 text-center text-xs ${over ? 'border-teal-500 bg-teal-500/10' : 'border-slate-300 dark:border-slate-700'}`}>
        <span className="font-medium">Drop spectra here or click to browse</span>
        <span className="text-slate-500">text · xlsx · JCAMP · SPC · SPA · OPUS · WDF · ASP · XRDML · RAS · UXD · CIF</span>
        <span className="text-slate-500">loads as <b>{TECH[st.technique].label}</b> — switch technique first if needed</span>
        <input type="file" multiple className="hidden" onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
      </label>

      {examples.length > 0 && (
        <div className="space-y-1">
          <select className="field" value="" onChange={e => { const v = e.target.value; if (v.startsWith('map:')) st.set({ tab: 'map', mapExample: v.slice(4) }); else if (v) openExample(v) }} title="Load a bundled example file">
            <option value="">Open an example file…</option>
            {(['raman', 'ftir', 'xrd'] as const).map(t => (
              <optgroup key={t} label={TECH[t].label}>
                {examples.filter(e => e.technique === t && !e.map).map(e => <option key={e.file} value={e.file}>{e.title}</option>)}
              </optgroup>
            ))}
            {examples.some(e => e.map) && (
              <optgroup label="Maps (open in the Map tab)">
                {examples.filter(e => e.map).map(e => <option key={e.file} value={'map:' + e.file}>{e.title}</option>)}
              </optgroup>
            )}
          </select>
          {exHint && <p className="text-[11px] text-slate-500">{exHint} <button className="text-slate-400 hover:text-rose-500" onClick={() => setExHint('')}><XIcon className="h-3 w-3" /></button></p>}
        </div>
      )}

      {pending.map((p, k) => (
        <div key={k} className="card space-y-1 text-xs">
          <div className="font-medium">{p.name}: choose columns</div>
          {(['xi', 'yi'] as const).map(key => (
            <label key={key} className="flex items-center gap-2">{key === 'xi' ? 'X' : 'Y'}
              <select className="field" value={p[key]} onChange={e => setPending(a => a.map((q, i) => (i === k ? { ...q, [key]: +e.target.value } : q)))}>
                {p.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
              </select>
            </label>
          ))}
          <div className="flex gap-1">
            <button className="btn btn-primary flex-1" onClick={() => { st.addSpectrum(p.name, p.data[p.xi], p.data[p.yi]); setPending(a => a.filter((_, i) => i !== k)) }}>Add</button>
            <button className="btn" title="Add every other column as its own spectrum" onClick={() => { p.columns.forEach((c, i) => { if (i !== p.xi) st.addSpectrum(`${p.name} ${c}`, p.data[p.xi], p.data[i]) }); setPending(a => a.filter((_, i) => i !== k)) }}>All Y</button>
            <button className="btn" onClick={() => setPending(a => a.filter((_, i) => i !== k))}>Cancel</button>
          </div>
        </div>
      ))}

      <div className="label">Spectra ({mine.length}){others > 0 && <span className="normal-case"> · {others} in other techniques</span>}</div>
      <ul className="space-y-1">
        {mine.map(s => (
          <li key={s.id} onClick={() => st.set({ activeId: s.id })}
            className={`flex items-center gap-1 rounded border px-1 py-0.5 ${s.id === st.activeId ? 'border-teal-500 bg-teal-500/10' : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            <input type="checkbox" title="Show / hide" checked={s.visible} onClick={e => e.stopPropagation()} onChange={e => st.patch(s.id, { visible: e.target.checked })} />
            <input type="color" title="Colour" value={s.color} onClick={e => e.stopPropagation()} onChange={e => st.patch(s.id, { color: e.target.value })} className="h-5 w-5 shrink-0 cursor-pointer border-0 bg-transparent p-0" />
            <input className="min-w-0 flex-1 bg-transparent text-xs outline-none focus-visible:underline" aria-label="Rename spectrum" title="Rename" value={s.name} onChange={e => st.patch(s.id, { name: e.target.value })} />
            <button title="Delete" className="px-1 text-slate-400 hover:text-rose-500" onClick={e => { e.stopPropagation(); st.remove(s.id) }}><XIcon /></button>
          </li>
        ))}
      </ul>

      {mine.length > 0 && (
        <details>
          <summary className="label cursor-pointer">Arithmetic · session · export</summary>
          <div className="mt-1 space-y-1 text-xs">
            <button className="btn w-full" disabled={mine.filter(s => s.visible).length < 2} onClick={average}>Average visible spectra</button>
            <div className="flex items-center gap-1">
              <span className="shrink-0">Active −</span>
              <input className="field !w-12" title="Scale factor" value={subK} onChange={e => setSubK(e.target.value)} />
              <span>×</span>
              <select className="field" value={subId} onChange={e => setSubId(e.target.value)}>
                <option value="">spectrum…</option>
                {mine.filter(s => s.id !== st.activeId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className="btn" disabled={!subId} onClick={subtract}>=</button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button className="btn" onClick={saveSession}>Save session</button>
              <label className="btn cursor-pointer">Open session
                <input type="file" accept=".json" className="hidden" onChange={async e => {
                  const f = e.target.files?.[0]; e.target.value = ''
                  if (f) try { st.loadSession(JSON.parse(await f.text())) } catch (err) { st.fail(err) }
                }} />
              </label>
              <button className="btn col-span-2" onClick={exportAll}>Export all processed (.csv)</button>
            </div>
          </div>
        </details>
      )}

      {active && (
        <details open className="mt-1">
          <summary className="label cursor-pointer">Processing pipeline</summary>
          <ol className="mt-1 space-y-1">
            {active.pipeline.map((step, i) => (
              <li key={step.id} className="card flex items-center gap-1 !p-1 text-xs">
                <input type="checkbox" checked={step.enabled} title="Enable / disable"
                  onChange={e => st.setPipeline(active.id, active.pipeline.map(s => (s.id === step.id ? { ...s, enabled: e.target.checked } : s)))} />
                <span className={`flex-1 truncate ${step.enabled ? '' : 'text-slate-400 line-through'}`}>{i + 1}. {STEP_LABEL[step.type]}</span>
                <button className="px-0.5 hover:text-teal-500" title="Move up" onClick={() => move(i, -1)}><UpIcon className="h-3 w-3" /></button>
                <button className="px-0.5 hover:text-teal-500" title="Move down" onClick={() => move(i, 1)}><DownIcon className="h-3 w-3" /></button>
                <button className="px-0.5 text-slate-400 hover:text-rose-500" title="Remove step" onClick={() => st.setPipeline(active.id, active.pipeline.filter(s => s.id !== step.id))}><XIcon className="h-3 w-3" /></button>
              </li>
            ))}
          </ol>
          <div className="mt-1 flex gap-1">
            <select className="field" value="" onChange={e => { if (e.target.value) st.setPipeline(active.id, [...active.pipeline, newStep(e.target.value as StepType, active.x)]) }}>
              <option value="">+ Add step…</option>
              {(Object.keys(STEP_LABEL) as StepType[]).map(t => <option key={t} value={t}>{STEP_LABEL[t]}</option>)}
            </select>
            <button className="btn" disabled={!st.history.length} onClick={st.undo}>Undo</button>
          </div>
        </details>
      )}
    </aside>
  )
}
