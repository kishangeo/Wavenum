// Plot digitizer: calibrate 4 axis points on an image / PDF page, trace the curve by colour.
// Author: Kishan Tiwari
import { useEffect, useRef } from 'react'
import { CheckIcon, CircleIcon } from './icons'
import { create } from 'zustand'
import { useStore } from './store'

const NAMES = ['Xmin', 'Xmax', 'Ymin', 'Ymax'] as const
type D = {
  img: HTMLImageElement | null; name: string; pts: [number, number][]; vals: string[]
  color: [number, number, number] | null; tol: number; curve: [number, number][]  // curve in pixel coords
  set: (p: Partial<D>) => void
}
const useDig = create<D>(set => ({ img: null, name: 'digitized', pts: [], vals: ['', '', '', ''], color: null, tol: 60, curve: [], set }))

// Render one PDF page to a PNG data URL with pdf.js (loaded only when a PDF is opened).
async function pdfPage(f: File, page: number): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise
  const p = await doc.getPage(Math.max(1, Math.min(page, doc.numPages)))
  const vp = p.getViewport({ scale: 150 / 72 })
  const c = document.createElement('canvas')
  c.width = Math.round(vp.width)
  c.height = Math.round(vp.height)
  await p.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
  return c.toDataURL('image/png')
}

function pixels(img: HTMLImageElement) {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  return g.getImageData(0, 0, c.width, c.height)
}

// For every pixel column between the X calibration points, the mean row of pixels close to the picked colour.
function trace(img: HTMLImageElement, pts: [number, number][], color: [number, number, number], tol: number) {
  const im = pixels(img)
  const x0 = Math.round(Math.min(pts[0][0], pts[1][0])), x1 = Math.round(Math.max(pts[0][0], pts[1][0]))
  const pad = Math.abs(pts[3][1] - pts[2][1]) * 0.05
  const y0 = Math.max(0, Math.round(Math.min(pts[2][1], pts[3][1]) - pad)), y1 = Math.min(im.height - 1, Math.round(Math.max(pts[2][1], pts[3][1]) + pad))
  const out: [number, number][] = []
  for (let x = Math.max(0, x0); x <= Math.min(im.width - 1, x1); x++) {
    let sum = 0, n = 0
    for (let y = y0; y <= y1; y++) {
      const i = (y * im.width + x) * 4
      const d = Math.hypot(im.data[i] - color[0], im.data[i + 1] - color[1], im.data[i + 2] - color[2])
      if (d <= tol) { sum += y; n++ }
    }
    if (n) out.push([x, sum / n])
  }
  return out
}

export function DigitizerCanvas() {
  const d = useDig()
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    if (!c || !d.img) return
    c.width = d.img.naturalWidth; c.height = d.img.naturalHeight
    const g = c.getContext('2d')!
    g.drawImage(d.img, 0, 0)
    const r = Math.max(4, c.width / 250)
    g.font = `${r * 3.5}px sans-serif`
    d.pts.forEach(([x, y], i) => {
      g.strokeStyle = g.fillStyle = '#e11d48'; g.lineWidth = r / 2.5
      g.beginPath(); g.moveTo(x - 2 * r, y); g.lineTo(x + 2 * r, y); g.moveTo(x, y - 2 * r); g.lineTo(x, y + 2 * r); g.stroke()
      g.fillText(NAMES[i], x + 2 * r, y - r)
    })
    if (d.curve.length) {
      g.strokeStyle = '#22d3ee'; g.lineWidth = r / 2
      g.beginPath(); d.curve.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke()
    }
  }, [d.img, d.pts, d.curve])

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!d.img) return
    const c = ref.current!, b = c.getBoundingClientRect()
    const x = ((e.clientX - b.left) / b.width) * c.width, y = ((e.clientY - b.top) / b.height) * c.height
    if (d.pts.length < 4) return d.set({ pts: [...d.pts, [x, y]] })
    const im = pixels(d.img), i = (Math.round(y) * im.width + Math.round(x)) * 4
    d.set({ color: [im.data[i], im.data[i + 1], im.data[i + 2]] })
  }
  const step = !d.img ? 'Upload a PNG / JPG / PDF of a spectrum plot in the Digitizer tab.'
    : d.pts.length < 4 ? `Click the ${NAMES[d.pts.length]} calibration point on the axis (${d.pts.length + 1}/4).`
      : !d.color ? 'Now click on the spectrum curve to pick its colour.' : 'Adjust tolerance, then send the trace to the workspace.'

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="border-b border-slate-200 px-3 py-1.5 text-xs font-medium text-teal-700 dark:border-slate-800 dark:text-teal-400">{step}</div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {d.img && <canvas ref={ref} onClick={click} className="max-w-full cursor-crosshair bg-white shadow" />}
      </div>
    </div>
  )
}

/** Load an image or PDF page into the digitizer (also used by the Example files menu). */
export async function loadDigitizerFile(f: File, page = 1) {
  const fail = useStore.getState().fail
  try {
    const src = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf') ? await pdfPage(f, page) : URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => useDig.getState().set({ img, name: f.name.replace(/\.[^.]+$/, ''), pts: [], color: null, curve: [] })
    img.onerror = () => fail('Could not load that image')
    img.src = src
  } catch (e) { fail(e) }
}

export default function DigitizerPanel() {
  const d = useDig()
  const st = useStore()

  const load = (f: File, page = 1) => loadDigitizerFile(f, page)
  // re-trace whenever colour / tolerance / calibration changes
  useEffect(() => {
    if (d.img && d.pts.length === 4 && d.color) d.set({ curve: trace(d.img, d.pts, d.color, d.tol) })
  }, [d.img, d.pts, d.color, d.tol])

  const v = d.vals.map(Number)
  const ready = d.curve.length > 5 && d.vals.every(s => s !== '' && Number.isFinite(+s)) && v[0] !== v[1] && v[2] !== v[3]
  const send = () => {
    const [p0, p1, p2, p3] = d.pts
    const xs = d.curve.map(([px]) => v[0] + ((px - p0[0]) / (p1[0] - p0[0])) * (v[1] - v[0]))
    const ys = d.curve.map(([, py]) => v[2] + ((py - p2[1]) / (p3[1] - p2[1])) * (v[3] - v[2]))
    st.addSpectrum(`${d.name} (digitized)`, xs, ys)
    st.set({ tab: 'pre' })
  }
  const pageRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-2">
      <div className="card space-y-1.5 text-xs">
        <div className="label">1 · Image or PDF page</div>
        <div className="flex gap-1">
          <label className="btn btn-primary flex-1 cursor-pointer">Upload PNG / JPG / PDF
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) load(e.target.files[0], +(pageRef.current?.value || 1)); e.target.value = '' }} />
          </label>
          <input ref={pageRef} type="number" min={1} defaultValue={1} title="PDF page" className="field !w-14" />
        </div>
      </div>
      <div className="card space-y-1.5 text-xs">
        <div className="label">2 · Axis calibration</div>
        <p className="text-slate-500">Click the four points on the image in order, then type their axis values (linear axes).</p>
        {NAMES.map((n, i) => (
          <label key={n} className="flex items-center gap-2">
            <span className={`w-10 ${d.pts[i] ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'}`}>{d.pts[i] ? <CheckIcon className="h-3 w-3" /> : <CircleIcon className="h-3 w-3" />} {n}</span>
            <input className="field" placeholder={`${n} value`} value={d.vals[i]} onChange={e => d.set({ vals: d.vals.map((s, k) => (k === i ? e.target.value : s)) })} />
          </label>
        ))}
        <button className="btn w-full" onClick={() => d.set({ pts: [], color: null, curve: [] })}>Reset points</button>
      </div>
      <div className="card space-y-1.5 text-xs">
        <div className="label">3 · Trace curve</div>
        <div className="flex items-center gap-2">Curve colour
          <span className="h-4 w-8 rounded border border-slate-400" style={{ background: d.color ? `rgb(${d.color.join(',')})` : 'transparent' }} />
          <span className="text-slate-500">{d.color ? `${d.curve.length} points` : 'click the curve'}</span>
        </div>
        <label className="block">Colour tolerance: {d.tol}
          <input type="range" className="w-full accent-teal-600" min={5} max={200} value={d.tol} onChange={e => d.set({ tol: +e.target.value })} />
        </label>
        <button className="btn btn-primary w-full" disabled={!ready} onClick={send}>Send to workspace</button>
      </div>
    </div>
  )
}
