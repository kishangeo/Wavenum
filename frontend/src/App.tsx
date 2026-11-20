// Wavenum shell: header + three-panel studio. Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
import { useEffect } from 'react'
import DigitizerPanel, { DigitizerCanvas } from './Digitizer'
import MineralId from './MineralId'
import PcaPanel, { PcaCanvas } from './Pca'
import Peaks from './Peaks'
import Plot from './Plot'
import Preprocess from './Preprocess'
import Sidebar from './Sidebar'
import { TECH, useStore, type Technique } from './store'

const TABS = [['pre', 'Preprocess'], ['peaks', 'Peaks'], ['id', 'Mineral ID'], ['pca', 'PCA'], ['dig', 'Digitizer']] as const

export default function App() {
  const st = useStore()
  useEffect(() => { document.documentElement.classList.toggle('dark', st.dark) }, [st.dark])
  useEffect(() => {
    if (!st.error) return
    const t = setTimeout(() => st.set({ error: null }), 6000)
    return () => clearTimeout(t)
  }, [st.error])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
        <h1 className="flex items-center gap-1.5 text-base font-bold tracking-tight"><img src="/logo.svg" alt="" className="h-6 w-6" />Wave<span className="-ml-1.5 text-teal-600 dark:text-teal-400">num</span></h1>
        <span className="hidden text-xs text-slate-500 sm:inline">spectral processing · peak analysis · mineral identification</span>
        <span className="hidden text-xs text-slate-500 md:inline">· created by <a href="https://kishangeo.github.io/" target="_blank" rel="noopener noreferrer" className="font-medium text-teal-600 underline-offset-2 hover:underline dark:text-teal-400">Kishan Tiwari</a></span>
        <div className="flex-1" />
        <div className="flex overflow-hidden rounded border border-slate-300 dark:border-slate-700">
          {(Object.keys(TECH) as Technique[]).map(t => (
            <button key={t} onClick={() => st.setTechnique(t)}
              className={`px-3 py-1 text-xs font-medium ${st.technique === t ? 'bg-teal-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{TECH[t].label}</button>
          ))}
        </div>
        <button className="btn" onClick={() => st.set({ dark: !st.dark })}>{st.dark ? '☀ Light' : '☾ Dark'}</button>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {st.tab === 'dig' ? <DigitizerCanvas /> : st.tab === 'pca' ? <PcaCanvas /> : <Plot />}
        <aside className="flex w-88 shrink-0 flex-col border-l border-slate-200 dark:border-slate-800">
          <nav className="flex border-b border-slate-200 dark:border-slate-800">
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => st.set({ tab: id })}
                className={`flex-1 px-1 py-1.5 text-xs font-medium ${st.tab === id ? 'border-b-2 border-teal-500 text-teal-600 dark:text-teal-400' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>{label}</button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {st.tab === 'pre' && <Preprocess />}
            {st.tab === 'peaks' && <Peaks />}
            {st.tab === 'id' && <MineralId />}
            {st.tab === 'pca' && <PcaPanel />}
            {st.tab === 'dig' && <DigitizerPanel />}
          </div>
        </aside>
      </div>
      {st.error && (
        <div role="alert" onClick={() => st.set({ error: null })}
          className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 cursor-pointer rounded bg-slate-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">{st.error}</div>
      )}
    </div>
  )
}
