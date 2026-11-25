// Mineral ID tab: libraries, browsing, matching, cross-technique identification. Author: Kishan Tiwari
import { useEffect, useState } from 'react'
import { XIcon } from './icons'
import { TECH, api, appConfig, inTauri, dataOf, useActive, useStore, type Lib, type Match, type Mixture, type Technique } from './store'

// K-alpha weighted averages (the XRD library is computed for Cu K-alpha 1.54184 A), plus Cu K-alpha-1
const TUBES: [string, number][] = [['Cu Kα', 1.54184], ['Cu Kα1', 1.5406], ['Co Kα', 1.79026], ['Mo Kα', 0.71073], ['Fe Kα', 1.93736], ['Cr Kα', 2.29100]]
type Hit = { lib: string; k: number; name: string; formula: string; system: string; info: string; library: string }
type Cross = { name: string; mean: number; by: Partial<Record<Technique, number>> }
type BuildStatus = { running: boolean; step: string; done: number; total: number; log: string[]; error: string | null }

// Download the open databases and build the full libraries (RRUFF, ROD, COD and others) in the background.
function BuildLibraries({ onDone }: { onDone: () => void }) {
  const fail = useStore(s => s.fail)
  const [b, setB] = useState<BuildStatus | null>(null)
  useEffect(() => { api<BuildStatus>('/libraries/build/status').then(setB).catch(() => {}) }, [])
  useEffect(() => {
    if (!b?.running) return
    const t = setTimeout(() => api<BuildStatus>('/libraries/build/status').then(n => { setB(n); if (!n.running) onDone() }).catch(fail), 1500)
    return () => clearTimeout(t)
  }, [b])
  const start = async () => {
    if (!window.confirm('Download about 315 MB of open spectral databases (RRUFF and others) and build the full libraries? This takes a while; files already downloaded are reused.')) return
    try { setB(await api<BuildStatus>('/libraries/build', {})) } catch (e) { fail(e) }
  }
  const pct = b && b.total ? Math.round((100 * b.done) / b.total) : 0
  return (
    <div className="space-y-1 border-t border-slate-200 pt-1.5 dark:border-slate-800">
      <button className="btn w-full" disabled={!!b?.running} onClick={start}>{b?.running ? 'Building libraries…' : 'Download & build full libraries'}</button>
      {b && (b.running || b.error || b.step === 'Finished') && (
        <div className="text-[11px] text-slate-500">
          <div className="flex justify-between"><span className="truncate">{b.step}</span><span className="tabular-nums">{b.total > 1 ? `${b.done}/${b.total}` : ''}</span></div>
          {b.running && <div className="h-1 rounded bg-slate-200 dark:bg-slate-800"><div className="h-1 rounded bg-teal-500" style={{ width: `${pct}%` }} /></div>}
          {b.error && <div className="text-rose-500">{b.error}</div>}
        </div>
      )}
    </div>
  )
}

// the tab unmounts when another tab is picked; keep the list so coming back shows it at once
let libCache: Lib[] | null = null

export default function MineralId() {
  const st = useStore()
  const a = useActive()
  const tech = TECH[st.technique]
  const [libs, setLibs] = useState<Lib[] | null>(libCache)  // null while loading
  const [readOnly, setReadOnly] = useState(false)
  useEffect(() => { appConfig().then(c => setReadOnly(c.read_only)) }, [])
  const [off, setOff] = useState<Set<string>>(new Set())  // deselected library ids
  const [tol, setTol] = useState(tech.tol)
  const [w, setW] = useState([0.4, 0.2, 0.4])
  const [mixture, setMixture] = useState(false)
  const [autoBase, setAutoBase] = useState(true)
  const [usePeaks, setUsePeaks] = useState(false)
  const [wl, setWl] = useState(1.54184)
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ q: string; hits: Hit[] }>({ q: '', hits: [] })
  const hits = found.q === q ? found.hits : []
  const [cross, setCross] = useState<Cross[] | null>(null)

  const refresh = () => api<Lib[]>('/libraries').then(l => setLibs(libCache = l)).catch(st.fail)
  useEffect(() => { refresh() }, [])
  useEffect(() => { setTol(tech.tol); setFound({ q: '', hits: [] }); setQ('') }, [st.technique])
  // library browser: search as you type
  useEffect(() => {
    if (q.trim().length < 2) return
    let live = true  // a reply to an older query must not overwrite a newer one
    const t = setTimeout(() => api<Hit[]>(`/libraries/search?technique=${st.technique}&q=${encodeURIComponent(q)}`).then(h => live && setFound({ q, hits: h })).catch(e => live && st.fail(e)), 200)
    return () => { live = false; clearTimeout(t) }
  }, [q, st.technique])

  const mine = (libs ?? []).filter(l => l.technique === st.technique)
  // has the user already baseline-corrected this spectrum?
  const corrected = !!a?.pipeline.some(s => s.enabled && (s.type === 'baseline' || s.type === 'derivative'))
  const techsWithData = (Object.keys(TECH) as Technique[]).filter(t => st.spectra.some(s => s.technique === t))

  const body = (t: Technique, d: { x: number[]; y: number[] }, extra: object) => ({
    x: d.x, y: d.y, technique: t, libraries: (libs ?? []).filter(l => l.technique === t && !off.has(l.id)).map(l => l.id),
    tolerance: t === st.technique ? tol : TECH[t].tol, weights: w, wavelength: wl, ...extra,
  })
  const search = async () => {
    if (!a) return
    setBusy('Searching…')
    try {
      const r = await api<{ matches: Match[]; mixture: Mixture | null }>('/match', body(st.technique, dataOf(a), {
        mixture, auto_baseline: autoBase && !corrected,
        peaks: usePeaks && a.peaks.length ? a.peaks.map(p => [p.x, p.y]) : null,
      }))
      st.set({ matches: r.matches, mixture: r.mixture, selMatch: r.matches.length ? 0 : null })
    } catch (e) { st.fail(e) } finally { setBusy('') }
  }
  // Same sample measured by several techniques: a phase supported by more than one is far more credible.
  const crossId = async () => {
    setBusy('Cross-matching…')
    try {
      const acc: Record<string, Cross> = {}
      for (const t of techsWithData) {
        const s = st.spectra.find(x => x.technique === t && x.visible) ?? st.spectra.find(x => x.technique === t)!
        const base = !s.pipeline.some(p => p.enabled && p.type === 'baseline')
        const r = await api<{ matches: Match[] }>('/match', body(t, dataOf(s), { n: 40, auto_baseline: base }))
        for (const m of r.matches) {
          const key = m.name.toLowerCase().replace(/[^a-z0-9]/g, '')
          acc[key] ??= { name: m.name, mean: 0, by: {} }
          acc[key].by[t] = Math.max(acc[key].by[t] ?? 0, m.score)
        }
      }
      const out = Object.values(acc).filter(c => Object.keys(c.by).length > 1)
      out.forEach(c => { const v = Object.values(c.by) as number[]; c.mean = v.reduce((p, n) => p + n, 0) / v.length })
      setCross(out.sort((p, n) => n.mean - p.mean).slice(0, 10))
    } catch (e) { st.fail(e) } finally { setBusy('') }
  }
  const importFolder = async () => {
    setBusy('Importing…')
    try {
      const r = await api<{ id: string; n: number }>('/libraries/import', { folder, technique: st.technique })
      await refresh()
      st.set({ error: `Imported ${r.n} spectra as “${r.id}”.` })
    } catch (e) { st.fail(e) } finally { setBusy('') }
  }
  const addRef = async (h: Hit) => {
    try {
      const e = await api<{ name: string; x: number[]; y: number[] }>(`/libraries/entry?lib=${h.lib}&k=${h.k}`)
      st.addSpectrum(`${e.name} (${h.library}${h.info ? ' ' + h.info : ''})`, e.x, e.y)
    } catch (err) { st.fail(err) }
  }
  const weight = (i: number, label: string) => (
    <label className="block text-xs">
      <span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-slate-500">{w[i].toFixed(2)}</span></span>
      <input type="range" className="w-full accent-teal-600" min={0} max={1} step={0.05} value={w[i]} onChange={e => setW(w.map((v, k) => (k === i ? +e.target.value : v)))} />
    </label>
  )

  return (
    <div className="space-y-2">
      <details className="card" open={mine.length <= 3}>
        <summary className="label cursor-pointer">{tech.label} libraries ({mine.reduce((n, l) => n + l.n, 0).toLocaleString()} entries)</summary>
        <div className="mt-1 space-y-1">
          {libs === null && <p className="text-xs text-slate-500">Loading libraries…</p>}
          {libs !== null && !mine.length && <p className="text-xs text-slate-500">No {tech.label} library installed{readOnly ? ' on this server.' : '. Use Download & build full libraries, or import a folder below.'}</p>}
          {mine.map(l => (
            <label key={l.id} className="flex items-center gap-2 text-xs" title={l.citation}>
              <input type="checkbox" checked={!off.has(l.id)} onChange={e => { const s = new Set(off); e.target.checked ? s.delete(l.id) : s.add(l.id); setOff(s) }} />
              <span className="flex-1 truncate">{l.title}</span><span className="tabular-nums text-slate-500">{l.n.toLocaleString()}</span>
            </label>
          ))}
          {readOnly
            ? <p className="text-[11px] text-slate-500">Hosted version: open libraries only. Run Wavenum on your own computer for the full RRUFF collections and your own imports.</p>
            : !inTauri && <BuildLibraries onDone={refresh} />}
          {st.technique !== 'xrd' && !readOnly && (
            <div className="flex gap-1 pt-1">
              <input className="field" placeholder="Folder of RRUFF .txt files, e.g. D:\RRUFF\raman" value={folder} onChange={e => setFolder(e.target.value)} />
              <button className="btn" disabled={!folder || !!busy} onClick={importFolder}>Import</button>
            </div>
          )}
        </div>
      </details>

      <div className="card space-y-1">
        <div className="label">Browse library</div>
        <input className="field" placeholder="Mineral name or formula, e.g. troilite, Fe2O3" value={q} onChange={e => setQ(e.target.value)} />
        {hits.length > 0 && (
          <ul className="max-h-40 overflow-y-auto text-xs">
            {hits.map(h => (
              <li key={h.lib + h.k} onClick={() => addRef(h)} title="Add this reference to the workspace"
                className="flex cursor-pointer justify-between gap-2 rounded px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800">
                <span className="truncate"><b>{h.name}</b> <span className="text-slate-500">{h.formula}</span></span>
                <span className="shrink-0 text-[11px] text-slate-500">{h.info || h.library}</span>
              </li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && found.q === q && !hits.length && <p className="text-[11px] text-slate-500">No {tech.label} reference matches “{q}”.</p>}
      </div>

      <div className="card space-y-1.5">
        <div className="label">Matching engine</div>
        <label className="flex items-center justify-between gap-2 text-xs">Peak tolerance (± {tech.unit})
          <input type="number" step={st.technique === 'xrd' ? 0.05 : 1} className="field !w-20" value={tol} onChange={e => setTol(+e.target.value)} />
        </label>
        {st.technique === 'xrd' && (
          <label className="flex items-center justify-between gap-2 text-xs">Radiation
            <select className="field !w-44" value={wl} onChange={e => setWl(+e.target.value)}>{TUBES.map(([n, v]) => <option key={n} value={v}>{n} ({v} Å)</option>)}</select>
          </label>
        )}
        {weight(0, 'Weight: cosine similarity')}{weight(1, 'Weight: Pearson correlation')}{weight(2, 'Weight: peak matching')}
        <label className="flex items-center gap-2 text-xs" title="Applies an ALS baseline to a copy of the spectrum for the search only">
          <input type="checkbox" checked={autoBase && !corrected} disabled={corrected} onChange={e => setAutoBase(e.target.checked)} />
          Auto-baseline for the search {corrected && <span className="text-slate-500">(already corrected)</span>}
        </label>
        {st.technique !== 'xrd' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={mixture} onChange={e => setMixture(e.target.checked)} /> Check for a 2-component mixture (NNLS)</label>}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={usePeaks} onChange={e => setUsePeaks(e.target.checked)} /> Use my Peak Analyzer peaks ({a?.peaks.length ?? 0})</label>
        <button className="btn btn-primary w-full" disabled={!a || !!busy || !mine.length} onClick={search}>{busy || 'Identify'}</button>
        {techsWithData.length > 1 && (
          <button className="btn w-full" disabled={!!busy} onClick={crossId} title="Matches one spectrum per technique and keeps phases found by more than one">
            Cross-technique ID ({techsWithData.map(t => TECH[t].label).join(' + ')})
          </button>
        )}
      </div>

      {cross && (
        <div className="card text-xs">
          <div className="mb-1 flex items-center"><span className="label flex-1">Supported by several techniques</span>
            <button className="text-slate-400 hover:text-rose-500" onClick={() => setCross(null)}><XIcon /></button></div>
          {!cross.length && <p className="text-slate-500">No phase appears in the top matches of more than one technique.</p>}
          {cross.map(c => (
            <div key={c.name} className="flex items-baseline gap-2 border-t border-slate-200 py-0.5 dark:border-slate-800">
              <span className="flex-1 truncate font-semibold">{c.name}</span>
              <span className="text-[11px] text-slate-500">{(Object.keys(c.by) as Technique[]).map(t => `${TECH[t].label} ${c.by[t]!.toFixed(0)}`).join(' · ')}</span>
              <span className="tabular-nums font-semibold text-teal-600 dark:text-teal-400">{c.mean.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}

      {st.mixture && (
        <div className={`card text-xs ${st.mixture.likely ? '!border-amber-500' : ''}`}>
          <div className="label">{st.mixture.likely ? 'Possible mixture' : 'Mixture check: single phase fits as well'}</div>
          {st.mixture.components.map(c => <div key={c.name} className="flex justify-between"><span>{c.name}</span><span className="tabular-nums">{(c.fraction * 100).toFixed(0)}%</span></div>)}
          <div className="text-slate-500">R² {st.mixture.r2.toFixed(3)} vs {st.mixture.single_r2.toFixed(3)} for the best single phase. Fractions are spectral weights, not modal abundances.</div>
        </div>
      )}

      {st.matches.length > 0 && (
        <ol className="space-y-1">
          {st.matches.map((m, i) => (
            <li key={i} onClick={() => st.set({ selMatch: i })}
              className={`card cursor-pointer !p-1.5 text-xs ${i === st.selMatch ? '!border-teal-500 bg-teal-500/10' : ''}`}>
              <div className="flex items-baseline gap-2">
                <span className="w-4 text-slate-500">{i + 1}</span>
                <span className="flex-1 truncate font-semibold">{m.name}</span>
                <span className="tabular-nums font-semibold text-teal-600 dark:text-teal-400">{m.score.toFixed(1)}%</span>
              </div>
              <div className="ml-6 truncate text-slate-500">{[m.formula, m.system].filter(Boolean).join(' · ') || '—'}</div>
              <div className="ml-6 truncate text-[11px] text-slate-500">cos {m.cosine.toFixed(2)} · r {m.pearson.toFixed(2)} · peaks {(m.peak * 100).toFixed(0)}% · {m.library} {m.info}</div>
            </li>
          ))}
        </ol>
      )}
      {st.selMatch != null && <button className="btn w-full" onClick={() => st.set({ selMatch: null })}>Close mirror plot</button>}
    </div>
  )
}
