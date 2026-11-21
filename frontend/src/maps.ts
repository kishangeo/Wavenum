// Spatially resolved spectra (hyperspectral maps): reading, map types, masks, classes, regions, profiles.
// Map types follow SpecXY (Gies et al. 2024, Computers & Geosciences 189, 105626, Eqs. 1-7).
// Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
import type { Technique } from './store'

/** A gridded spectral map. Pixel p = iy * nx + ix, with iy = 0 the bottom row (smallest Y). */
export type SpecMap = {
  name: string; technique: Technique; nx: number; ny: number
  x: number[]; y: number[]           // pixel-centre coordinates along X (nx) and Y (ny), ascending
  axis: Float64Array | null          // spectral axis (ascending); null for value-only maps (element maps)
  cube: Float32Array | null          // npix * nsig intensities, NaN where a pixel was not measured
}
export type Layer = { id: string; name: string; values: Float32Array; note: string }

const uid = () => Math.random().toString(36).slice(2, 9)
export const npix = (m: SpecMap) => m.nx * m.ny
export const nsig = (m: SpecMap) => m.axis?.length ?? 0

// ---------------------------------------------------------------- reading text maps

function numRows(text: string): (number | null)[][] {
  const lines = text.split(/\r?\n/)
  const comma = !text.includes('.') && text.includes(',') && (text.includes(';') || text.includes('\t'))
  return lines.map(l => {
    const t = (comma ? l.replace(/,/g, '.') : l).trim()
    if (!t) return []
    return t.split(/[,;\t ]+/).map(v => { const n = Number(v); return v !== '' && Number.isFinite(n) ? n : null })
  })
}

const allNum = (r: (number | null)[]) => r.length > 0 && r.every(v => v !== null)

/** Unique sorted values, merging values closer than tol. */
function uniq(v: number[], tol: number) {
  const s = [...v].sort((a, b) => a - b)
  const out: number[] = []
  for (const x of s) if (!out.length || x - out[out.length - 1] > tol) out.push(x)
  return out
}

/** Grid scattered pixels (coordinates px, py; spectra in `cube`, n * nsig) onto a regular map. */
export function gridPixels(name: string, technique: Technique, px: number[], py: number[], axis: Float64Array, cube: Float32Array): SpecMap {
  const n = px.length, s = axis.length
  const span = (v: number[]) => Math.max(...v) - Math.min(...v) || 1
  let xs = uniq(px, span(px) * 1e-6), ys = uniq(py, span(py) * 1e-6)
  // Line scans and depth series are not grids (x and y change together, or not at all): lay them out as
  // one row ordered along the acquisition path, with X = distance travelled.
  if (xs.length * ys.length > 1.5 * n || xs.length * ys.length < n) {
    const d = [0]
    for (let i = 1; i < n; i++) d.push(d[i - 1] + (Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]) || 1))
    px = d
    py = new Array(n).fill(0)
    xs = d.slice()
    ys = [0]
  }
  const find = (arr: number[], v: number) => {
    let lo = 0, hi = arr.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v - 1e-9 * Math.abs(v || 1)) lo = m + 1; else hi = m }
    return Math.abs(arr[lo] - v) <= Math.abs((arr[lo - 1] ?? Infinity) - v) ? lo : lo - 1
  }
  const nx = xs.length, ny = ys.length
  const out = new Float32Array(nx * ny * s).fill(NaN)
  for (let i = 0; i < n; i++) {
    const p = find(ys, py[i]) * nx + find(xs, px[i])
    out.set(cube.subarray(i * s, (i + 1) * s), p * s)
  }
  // the spectral axis is stored ascending
  if (s > 1 && axis[0] > axis[s - 1]) return reverseAxis({ name, technique, nx, ny, x: xs, y: ys, axis, cube: out })
  return { name, technique, nx, ny, x: xs, y: ys, axis, cube: out }
}

function reverseAxis(m: SpecMap): SpecMap {
  const s = nsig(m), a = m.axis!, c = m.cube!
  const axis = new Float64Array(s), cube = new Float32Array(c.length)
  for (let k = 0; k < s; k++) axis[k] = a[s - 1 - k]
  for (let p = 0; p < npix(m); p++) for (let k = 0; k < s; k++) cube[p * s + k] = c[p * s + s - 1 - k]
  return { ...m, axis, cube }
}

export type MapKind = 'auto' | 'wide' | 'long' | 'matrix' | 'grid'
export const MAP_KINDS: [MapKind, string][] = [
  ['auto', 'Detect automatically'], ['wide', 'Wide table: X, Y, then one column per wavenumber'],
  ['long', 'Long table: X, Y, wavenumber, intensity'], ['matrix', 'SpecXY matrix: wavenumber, then one column per pixel'],
  ['grid', 'Value grid (element map): rows = Y from the top, columns = X'],
]

/** Read a text map. Returns a spectral map, or a value grid (for element maps). */
export function parseMapText(name: string, text: string, technique: Technique, kind: MapKind, nx?: number, ny?: number): SpecMap {
  const rows = numRows(text)
  const numeric = rows.map(allNum)
  const first = numeric.indexOf(true)
  if (first < 0) throw new Error('No numeric data in this file')
  const body = rows.filter((_, i) => numeric[i]) as number[][]
  const widths = new Map<number, number>()
  body.forEach(r => widths.set(r.length, (widths.get(r.length) ?? 0) + 1))
  const w = [...widths.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const data = body.filter(r => r.length === w)

  // wide: an axis row (numbers only, 2 fewer than the data rows, possibly after two blank/label cells)
  const axisRow = (() => {
    for (let i = 0; i < rows.length && i <= first + 1; i++) {
      const r = rows[i].filter(v => v !== null) as number[]
      if (r.length === w - 2 && r.length >= 5) return { i, axis: r }
    }
    return null
  })()
  const tryWide = () => {
    if (!axisRow) return null
    const d = rows.slice(axisRow.i + 1).filter(r => allNum(r) && r.length === w) as number[][]
    const s = w - 2
    const cube = new Float32Array(d.length * s)
    d.forEach((r, i) => { for (let k = 0; k < s; k++) cube[i * s + k] = r[k + 2] })
    return gridPixels(name, technique, d.map(r => r[0]), d.map(r => r[1]), Float64Array.from(axisRow.axis), cube)
  }
  const tryLong = () => {
    if (w !== 4) return null
    const key = (r: number[]) => `${r[0]}|${r[1]}`
    const order: string[] = [], spectra = new Map<string, number[][]>()
    for (const r of data) {
      const k = key(r)
      if (!spectra.has(k)) { spectra.set(k, []); order.push(k) }
      spectra.get(k)!.push([r[2], r[3]])
    }
    if (order.length < 2 || data.length / order.length < 5) return null
    const firstPts = spectra.get(order[0])!.map(p => p[0]).sort((a, b) => a - b)
    const axis = Float64Array.from(firstPts)
    const s = axis.length
    const cube = new Float32Array(order.length * s).fill(NaN)
    const px: number[] = [], py: number[] = []
    order.forEach((k, i) => {
      const [x, y] = k.split('|').map(Number)
      px.push(x); py.push(y)
      const pts = spectra.get(k)!.sort((a, b) => a[0] - b[0])
      pts.forEach((p, j) => { if (j < s) cube[i * s + j] = p[1] })
    })
    return gridPixels(name, technique, px, py, axis, cube)
  }
  const tryMatrix = () => {
    if (w < 3) return null
    const n = w - 1
    let gx = nx ?? 0, gy = ny ?? 0
    if (!gx || !gy) {
      // most square factorisation of the pixel count (SpecXY asks the user to confirm nX, nY)
      let best = 1
      for (let a = 1; a * a <= n; a++) if (n % a === 0) best = a
      gy = best; gx = n / best
    }
    if (gx * gy !== n) throw new Error(`nX × nY (${gx} × ${gy}) must equal the ${n} pixel columns`)
    const s = data.length
    const axis = Float64Array.from(data.map(r => r[0]))
    const cube = new Float32Array(n * s)
    for (let k = 0; k < s; k++) for (let p = 0; p < n; p++) cube[p * s + k] = data[k][p + 1]
    // pixel 1 is bottom-left, ids increase left to right, then bottom to top
    const m: SpecMap = { name, technique, nx: gx, ny: gy, x: Array.from({ length: gx }, (_, i) => i), y: Array.from({ length: gy }, (_, i) => i), axis, cube }
    return axis[0] > axis[s - 1] ? reverseAxis(m) : m
  }
  const tryGrid = (): SpecMap => {
    const g = data
    const gy = g.length, gx = w
    const cube = new Float32Array(gx * gy)
    // first text row = top of the image = largest Y
    for (let r = 0; r < gy; r++) for (let c = 0; c < gx; c++) cube[(gy - 1 - r) * gx + c] = g[r][c]
    return { name, technique, nx: gx, ny: gy, x: Array.from({ length: gx }, (_, i) => i), y: Array.from({ length: gy }, (_, i) => i), axis: null, cube }
  }
  if (kind === 'wide') return tryWide() ?? fail('No wavenumber row found for a wide table')
  if (kind === 'long') return tryLong() ?? fail('A long table needs 4 columns: X, Y, wavenumber, intensity')
  if (kind === 'matrix') return tryMatrix() ?? fail('A SpecXY matrix needs a wavenumber column and pixel columns')
  if (kind === 'grid') return tryGrid()
  const auto = tryWide() ?? tryLong()
  if (auto) return auto
  const col0 = data.map(r => r[0])
  const monotonic = col0.length > 20 && col0.every((v, i) => i === 0 || v > col0[i - 1]) || col0.every((v, i) => i === 0 || v < col0[i - 1])
  return monotonic && col0.length > 20 ? tryMatrix()! : tryGrid()
}
function fail(msg: string): never { throw new Error(msg) }

/** Image -> value grid (grey level 0-255), e.g. an element map exported as a picture. */
export async function parseMapImage(name: string, file: Blob, technique: Technique): Promise<SpecMap> {
  const bmp = await createImageBitmap(file)
  const c = document.createElement('canvas')
  c.width = bmp.width; c.height = bmp.height
  const g = c.getContext('2d')!
  g.drawImage(bmp, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data
  const nx = c.width, ny = c.height
  const cube = new Float32Array(nx * ny)
  for (let r = 0; r < ny; r++) for (let col = 0; col < nx; col++) {
    const i = (r * nx + col) * 4
    cube[(ny - 1 - r) * nx + col] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  }
  return { name, technique, nx, ny, x: Array.from({ length: nx }, (_, i) => i), y: Array.from({ length: ny }, (_, i) => i), axis: null, cube }
}

/** Binary map from the backend (Renishaw WDF): u32 header length, JSON header, float32 spectra. */
export function decodeBinaryMap(buf: ArrayBuffer, technique: Technique): SpecMap {
  const dv = new DataView(buf)
  const hl = dv.getUint32(0, true)
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)))
  const off = 4 + hl + ((4 - ((4 + hl) % 4)) % 4)
  const cube = new Float32Array(buf.slice(off, off + h.count * h.axis.length * 4))
  return gridPixels(h.name, technique, h.px, h.py, Float64Array.from(h.axis), cube)
}

// ---------------------------------------------------------------- map types (SpecXY Eqs. 1-7)

export type MetricKind = 'intensity' | 'area' | 'ratio' | 'logratio' | 'position' | 'fwhm' | 'quality'
export const METRICS: [MetricKind, string, string][] = [
  ['intensity', 'Intensity at x₁', 'SpecXY Eq. 1'],
  ['area', 'Integrated area x₁–x₂ (linear baseline)', 'SpecXY Eq. 2'],
  ['ratio', 'Intensity ratio I(x₁)/I(x₂)', 'SpecXY Eq. 3'],
  ['logratio', 'Log-intensity ratio log I(x₁)/log I(x₂)', 'SpecXY Eq. 4'],
  ['position', 'Band position in x₁–x₂ (maximum, parabolic)', ''],
  ['fwhm', 'Band FWHM in x₁–x₂ (above linear baseline)', ''],
  ['quality', 'Signal quality 0–100 (low noise = high)', 'after SpecXY Eq. 5'],
]

function idx(axis: Float64Array, v: number) {
  let lo = 0, hi = axis.length - 1
  while (lo < hi) { const m = (lo + hi) >> 1; if (axis[m] < v) lo = m + 1; else hi = m }
  return lo
}
function at(axis: Float64Array, y: Float32Array, o: number, v: number) {
  const s = axis.length
  if (v <= axis[0]) return y[o]
  if (v >= axis[s - 1]) return y[o + s - 1]
  const j = idx(axis, v)
  const t = (v - axis[j - 1]) / (axis[j] - axis[j - 1])
  return y[o + j - 1] + t * (y[o + j] - y[o + j - 1])
}

/** One value per pixel. x1/x2 in axis units; window metrics use [min(x1,x2), max(x1,x2)]. */
export function metric(m: SpecMap, kind: MetricKind, x1: number, x2: number): Float32Array {
  const a = m.axis!, c = m.cube!, s = a.length, n = npix(m)
  const out = new Float32Array(n)
  const lo = Math.min(x1, x2), hi = Math.max(x1, x2)
  const i0 = idx(a, lo), i1 = Math.max(i0 + 1, Math.min(s - 1, idx(a, hi)))
  for (let p = 0; p < n; p++) {
    const o = p * s
    if (Number.isNaN(c[o])) { out[p] = NaN; continue }
    switch (kind) {
      case 'intensity': out[p] = at(a, c, o, x1); break
      case 'ratio': out[p] = at(a, c, o, x1) / at(a, c, o, x2); break
      case 'logratio': out[p] = Math.log(at(a, c, o, x1)) / Math.log(at(a, c, o, x2)); break
      case 'area': {
        // subtract the straight line through the window ends, then integrate (trapezoids)
        const ya = c[o + i0], yb = c[o + i1], xa = a[i0], xb = a[i1]
        let sum = 0
        for (let k = i0; k < i1; k++) {
          const b0 = ya + ((a[k] - xa) * (yb - ya)) / (xb - xa), b1 = ya + ((a[k + 1] - xa) * (yb - ya)) / (xb - xa)
          sum += 0.5 * (c[o + k] - b0 + c[o + k + 1] - b1) * (a[k + 1] - a[k])
        }
        out[p] = sum
        break
      }
      case 'position': case 'fwhm': {
        const ya = c[o + i0], yb = c[o + i1], xa = a[i0], xb = a[i1]
        const net = (k: number) => c[o + k] - (ya + ((a[k] - xa) * (yb - ya)) / (xb - xa))
        let km = i0
        for (let k = i0; k <= i1; k++) if (net(k) > net(km)) km = k
        if (kind === 'position') {
          if (km > i0 && km < i1) {
            const y0 = net(km - 1), y1 = net(km), y2 = net(km + 1), den = y0 - 2 * y1 + y2
            out[p] = a[km] + (den !== 0 ? (0.5 * (y0 - y2)) / den : 0) * (a[km + 1] - a[km - 1]) / 2
          } else out[p] = a[km]
          break
        }
        const half = net(km) / 2
        if (half <= 0) { out[p] = NaN; break }
        let l = km, r = km
        while (l > i0 && net(l) > half) l--
        while (r < i1 && net(r) > half) r++
        const xl = net(l) <= half ? a[l] + ((half - net(l)) / (net(l + 1) - net(l))) * (a[l + 1] - a[l]) : a[l]
        const xr = net(r) <= half ? a[r] - ((half - net(r)) / (net(r - 1) - net(r))) * (a[r] - a[r - 1]) : a[r]
        out[p] = xr - xl
        break
      }
      case 'quality': {
        // noise = RMS difference from a 7-point moving average; quality grows with signal / noise (dB)
        let mse = 0, mn = Infinity, mx = -Infinity
        for (let k = 3; k < s - 3; k++) {
          let avg = 0
          for (let j = -3; j <= 3; j++) avg += c[o + k + j]
          const d = c[o + k] - avg / 7
          mse += d * d
          mn = Math.min(mn, c[o + k]); mx = Math.max(mx, c[o + k])
        }
        mse /= Math.max(1, s - 6)
        out[p] = 20 * Math.log10((mx - mn) / Math.sqrt(mse || 1e-30))
        break
      }
    }
  }
  if (kind === 'quality') return normalize01(out, 100)
  return out
}

/** SpecXY Eq. 7: rescale to [0, scale]. */
export function normalize01(v: Float32Array, scale = 1): Float32Array {
  let lo = Infinity, hi = -Infinity
  for (const x of v) if (Number.isFinite(x)) { lo = Math.min(lo, x); hi = Math.max(hi, x) }
  const r = hi - lo || 1
  return v.map(x => (Number.isFinite(x) ? ((x - lo) / r) * scale : NaN))
}

export function newLayer(name: string, values: Float32Array, note = ''): Layer {
  return { id: uid(), name, values, note }
}

export type CalcOp = '+' | '−' | '×' | '÷'
export function calc(a: Float32Array, b: Float32Array, op: CalcOp): Float32Array {
  return a.map((v, i) => (op === '+' ? v + b[i] : op === '−' ? v - b[i] : op === '×' ? v * b[i] : v / b[i]))
}

// ---------------------------------------------------------------- masks, regions, classes, profiles

/** true = pixel kept. */
export function makeMask(v: Float32Array, lo: number, hi: number): Uint8Array {
  return Uint8Array.from(v, x => (Number.isFinite(x) && x >= lo && x <= hi ? 1 : 0))
}

/** Mean spectrum of the given pixels (NaN pixels skipped). */
export function meanSpectrum(m: SpecMap, pixels: number[]): { x: number[]; y: number[]; n: number } {
  const s = nsig(m), c = m.cube!
  const sum = new Float64Array(s)
  let n = 0
  for (const p of pixels) {
    if (Number.isNaN(c[p * s])) continue
    for (let k = 0; k < s; k++) sum[k] += c[p * s + k]
    n++
  }
  return { x: Array.from(m.axis!), y: Array.from(sum, v => (n ? v / n : NaN)), n }
}

export function pixelSpectrum(m: SpecMap, p: number) {
  const s = nsig(m)
  return { x: Array.from(m.axis!), y: Array.from(m.cube!.subarray(p * s, (p + 1) * s)) }
}

/** Pixels inside a rectangle given in map coordinates. */
export function rectPixels(m: SpecMap, xa: number, ya: number, xb: number, yb: number): number[] {
  const [x0, x1] = [Math.min(xa, xb), Math.max(xa, xb)], [y0, y1] = [Math.min(ya, yb), Math.max(ya, yb)]
  const out: number[] = []
  for (let iy = 0; iy < m.ny; iy++) for (let ix = 0; ix < m.nx; ix++)
    if (m.x[ix] >= x0 && m.x[ix] <= x1 && m.y[iy] >= y0 && m.y[iy] <= y1) out.push(iy * m.nx + ix)
  return out
}

export function nearestPixel(m: SpecMap, x: number, y: number) {
  const near = (arr: number[], v: number) => arr.reduce((b, a, i) => (Math.abs(a - v) < Math.abs(arr[b] - v) ? i : b), 0)
  return near(m.y, y) * m.nx + near(m.x, x)
}

/** Values of a layer along a straight line between two map points (nearest pixel per step). */
export function profile(m: SpecMap, v: Float32Array, xa: number, ya: number, xb: number, yb: number) {
  const steps = Math.max(m.nx, m.ny) * 2
  const len = Math.hypot(xb - xa, yb - ya)
  const d: number[] = [], val: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    d.push(t * len)
    val.push(v[nearestPixel(m, xa + t * (xb - xa), ya + t * (yb - ya))])
  }
  return { d, val }
}

/** k-means classes of the spectra (SpecXY ClassificationModule), on area-normalised spectra
 *  restricted to [x1, x2] and binned to at most 128 values. Masked-out pixels get NaN. */
export function classify(m: SpecMap, k: number, x1: number, x2: number, mask: Uint8Array | null): { labels: Float32Array; means: { x: number[]; y: number[]; n: number }[] } {
  const a = m.axis!, c = m.cube!, s = a.length, n = npix(m)
  const i0 = idx(a, Math.min(x1, x2)), i1 = Math.max(i0 + 2, idx(a, Math.max(x1, x2)))
  const bins = Math.min(128, i1 - i0), per = (i1 - i0) / bins
  const use: number[] = []
  for (let p = 0; p < n; p++) if (!Number.isNaN(c[p * s]) && (!mask || mask[p])) use.push(p)
  if (use.length < k) throw new Error('Fewer usable pixels than classes')
  const feat = use.map(p => {
    const f = new Float64Array(bins)
    for (let b = 0; b < bins; b++) {
      const from = i0 + Math.floor(b * per), to = Math.max(from + 1, i0 + Math.floor((b + 1) * per))
      let v = 0
      for (let j = from; j < to; j++) v += c[p * s + j]
      f[b] = v / (to - from)
    }
    let lo = Infinity
    for (const v of f) lo = Math.min(lo, v)
    let area = 0
    for (let b = 0; b < bins; b++) { f[b] -= lo; area += f[b] }
    if (area > 0) for (let b = 0; b < bins; b++) f[b] /= area
    return f
  })
  const d2 = (u: Float64Array, v: Float64Array) => { let t = 0; for (let i = 0; i < u.length; i++) t += (u[i] - v[i]) ** 2; return t }
  // k-means++ seeding with a fixed pseudo-random sequence, so results are repeatable
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const cent: Float64Array[] = [feat[Math.floor(rnd() * feat.length)].slice()]
  while (cent.length < k) {
    const dist = feat.map(f => Math.min(...cent.map(cc => d2(f, cc))))
    let r = rnd() * dist.reduce((t, v) => t + v, 0), pick = feat.length - 1
    for (let i = 0; i < dist.length; i++) { if (r < dist[i]) { pick = i; break } r -= dist[i] }
    cent.push(feat[pick].slice())
  }
  let lab = new Int32Array(feat.length).fill(-1)
  for (let it = 0; it < 100; it++) {
    const nl = Int32Array.from(feat, f => { let b = 0; for (let j = 1; j < k; j++) if (d2(f, cent[j]) < d2(f, cent[b])) b = j; return b })
    const changed = nl.some((v, i) => v !== lab[i])
    lab = nl
    for (let j = 0; j < k; j++) {
      const mem = feat.filter((_, i) => lab[i] === j)
      if (!mem.length) continue
      cent[j] = new Float64Array(bins).map((_, b) => mem.reduce((t, f) => t + f[b], 0) / mem.length)
    }
    if (!changed) break
  }
  // order classes by size (class 1 = largest) for stable colours
  const sizes = Array.from({ length: k }, (_, j) => lab.filter(v => v === j).length)
  const rank = sizes.map((_, j) => j).sort((p, q) => sizes[q] - sizes[p])
  const newId = new Int32Array(k)
  rank.forEach((j, r) => (newId[j] = r))
  const labels = new Float32Array(n).fill(NaN)
  use.forEach((p, i) => (labels[p] = newId[lab[i]] + 1))
  const means = Array.from({ length: k }, (_, r) => meanSpectrum(m, use.filter((_, i) => newId[lab[i]] === r)))
  return { labels, means }
}
