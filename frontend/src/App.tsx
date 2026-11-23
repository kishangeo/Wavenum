// Wavenum shell: header + three-panel studio. Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
import { useEffect, useState } from 'react'
import { MoonIcon, SunIcon, XIcon } from './icons'
import DigitizerPanel, { DigitizerCanvas } from './Digitizer'
import MineralId from './MineralId'
import MapPanel, { MapCanvas } from './MapTab'
import PcaPanel, { PcaCanvas } from './Pca'
import Peaks from './Peaks'
import Plot from './Plot'
import Preprocess from './Preprocess'
import Sidebar from './Sidebar'
import { TECH, api, useStore, type Technique } from './store'

declare const __APP_VERSION__: string
type Stats = Record<string, { spectra: number; libraries: number; phases: number }>

const TABS = [['pre', 'Preprocess'], ['peaks', 'Peaks'], ['id', 'Mineral ID'], ['pca', 'PCA'], ['map', 'Map'], ['dig', 'Digitizer']] as const

export default function App() {
  const st = useStore()
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => { api<Stats>('/stats').then(setStats).catch(() => {}) }, [])
  const ts = stats?.[st.technique]
  // below 1280 px not all three panels fit: phones show one panel, tablets the plot plus one side panel
  const [pane, setPane] = useState<'data' | 'plot' | 'tools'>('plot')
  useEffect(() => { dispatchEvent(new Event('resize')) }, [pane])
  useEffect(() => { if (st.mapExample) setPane('tools') }, [st.mapExample]) // Plotly re-measures panels that became visible
  const sideCls = pane === 'data' ? 'flex' : 'hidden xl:flex'
  const plotCls = pane === 'plot' ? 'flex' : 'hidden md:flex'
  const toolCls = pane === 'tools' ? 'flex' : pane === 'plot' ? 'hidden md:flex' : 'hidden xl:flex'
  useEffect(() => { document.documentElement.classList.toggle('dark', st.dark) }, [st.dark])
  useEffect(() => {
    if (!st.error) return
    const t = setTimeout(() => st.set({ error: null }), 6000)
    return () => clearTimeout(t)
  }, [st.error])

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="flex items-center gap-1.5 text-base font-bold tracking-tight"><img src="/logo.svg" alt="" width={24} height={24} className="h-6 w-6" />Wave<span className="-ml-1.5 text-teal-600 dark:text-teal-400">num</span></h1>
        <a href="https://github.com/kishangeo/Wavenum/releases" target="_blank" rel="noopener noreferrer" title="Release notes"
          className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-slate-800 text-slate-500 hover:text-teal-600 dark:border-slate-700">v{__APP_VERSION__}</a>
        <span className="hidden text-xs text-slate-500 sm:inline">spectral processing · peak analysis · mineral identification</span>
        <span className="hidden text-xs text-slate-500 md:inline">· created by <a href="https://kishangeo.github.io/" target="_blank" rel="noopener noreferrer" className="font-medium text-teal-600 underline-offset-2 hover:underline dark:text-teal-400">Kishan Tiwari</a></span>
        <div className="flex-1" />
        {ts && (
          <span className="hidden text-xs text-slate-500 lg:inline" title={`${TECH[st.technique].label} reference data: ${ts.spectra.toLocaleString()} spectra from ${ts.libraries} libraries, ${ts.phases.toLocaleString()} distinct mineral and phase names. Sources and citations: Mineral ID tab and Help.`}>
            <b className="font-semibold text-slate-700 dark:text-slate-300">{ts.spectra.toLocaleString()}</b> reference spectra · {ts.phases.toLocaleString()} phases · {ts.libraries} {ts.libraries === 1 ? 'library' : 'libraries'}
          </span>
        )}
        <button className="btn" onClick={() => st.set({ help: true })}>Help</button>
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          {(Object.keys(TECH) as Technique[]).map(t => (
            <button key={t} aria-pressed={st.technique === t} onClick={() => st.setTechnique(t)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${st.technique === t ? 'bg-white text-teal-700 shadow-xs shadow-slate-900/10 dark:bg-slate-950 dark:text-teal-300' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}>{TECH[t].label}</button>
          ))}
        </div>
        <button className="btn" aria-label={st.dark ? 'Light theme' : 'Dark theme'} onClick={() => st.set({ dark: !st.dark })}>{st.dark ? <><SunIcon /><span className="hidden sm:inline"> Light</span></> : <><MoonIcon /><span className="hidden sm:inline"> Dark</span></>}</button>
      </header>
      <div className="flex min-h-0 flex-1 gap-px bg-slate-200 dark:bg-slate-800">
        <div className={`${sideCls} w-full min-w-0 shrink-0 md:w-72`}><Sidebar /></div>
        <div className={`${plotCls} min-w-0 flex-1 bg-white dark:bg-[#0b1220]`}>
          {st.tab === 'dig' ? <DigitizerCanvas /> : st.tab === 'pca' ? <PcaCanvas /> : st.tab === 'map' ? <MapCanvas /> : <Plot />}
        </div>
        <aside className={`${toolCls} w-full shrink-0 flex-col bg-slate-50 md:w-88 dark:bg-slate-950`}>
          <nav role="tablist" aria-label="Tools" className="flex gap-0.5 border-b border-slate-200 bg-white px-1 dark:border-slate-800 dark:bg-slate-900">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={st.tab === id} onClick={() => st.set({ tab: id })}
                className={`flex-1 px-1 py-2 text-xs font-medium transition-colors border-b-2 ${st.tab === id ? 'border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>{label}</button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {st.tab === 'pre' && <Preprocess />}
            {st.tab === 'peaks' && <Peaks />}
            {st.tab === 'id' && <MineralId />}
            {st.tab === 'pca' && <PcaPanel />}
            {st.tab === 'map' && <MapPanel />}
            {st.tab === 'dig' && <DigitizerPanel />}
          </div>
        </aside>
      </div>
      <nav className="flex border-t border-slate-200 xl:hidden dark:border-slate-800" aria-label="Panels">
        {([['data', 'Data'], ['plot', 'Plot'], ['tools', 'Tools']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setPane(id)} aria-pressed={pane === id}
            className={`flex-1 py-2 text-sm font-medium ${id === 'plot' ? 'md:hidden' : ''} ${pane === id ? 'text-teal-600 dark:text-teal-400' : id === 'tools' && pane === 'plot' ? 'text-slate-500 md:text-teal-600 md:dark:text-teal-400' : 'text-slate-500'} ${pane === id ? 'bg-teal-50 dark:bg-teal-950' : ''}`}>{label}</button>
        ))}
      </nav>
      {st.help && <Help version={__APP_VERSION__} onClose={() => st.set({ help: false })} />}
      {st.error && (
        <button type="button" role="alert" aria-live="assertive" title="Dismiss" onClick={() => st.set({ error: null })}
          className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 cursor-pointer rounded bg-slate-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">{st.error}</button>
      )}
    </div>
  )
}

/** In-app user manual (public/manual.html). Save as PDF uses the print dialog of the browser / webview. */
function Help({ version, onClose }: { version: string; onClose: () => void }) {
  const src = `/manual.html?v=${encodeURIComponent(version)}`
  let frame: HTMLIFrameElement | null = null
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overscroll-contain" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="User manual" className="flex h-full max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <span className="flex-1 text-sm font-semibold">Wavenum user manual · v{version}</span>
          <button className="btn btn-primary" onClick={() => frame?.contentWindow?.print()}>Save as PDF / print</button>
          <a className="btn" href={src} target="_blank" rel="noopener noreferrer">Open in new tab</a>
          <button className="btn" aria-label="Close" onClick={onClose}><XIcon /></button>
        </div>
        <iframe ref={el => { frame = el }} src={src} title="Wavenum user manual" className="min-h-0 flex-1 bg-white" />
      </div>
    </div>
  )
}
