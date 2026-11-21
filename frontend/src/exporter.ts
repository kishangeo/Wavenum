// Publication figure export shared by every plot: PNG, JPG, TIFF, EPS (raster at the chosen DPI, with the
// DPI written into the file), SVG and PDF (vector). Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
import Plotly from 'plotly.js-dist-min'

export type ExportFormat = 'png' | 'jpg' | 'tiff' | 'eps' | 'svg' | 'pdf'
export const FORMATS: { id: ExportFormat; label: string; vector: boolean }[] = [
  { id: 'png', label: 'PNG', vector: false }, { id: 'jpg', label: 'JPG', vector: false },
  { id: 'tiff', label: 'TIFF', vector: false }, { id: 'eps', label: 'EPS', vector: false },
  { id: 'svg', label: 'SVG (vector)', vector: true }, { id: 'pdf', label: 'PDF (vector)', vector: true },
]

const CSS_DPI = 96 // Plotly lays figures out in CSS pixels
export const mmToCss = (mm: number) => Math.round((mm / 25.4) * CSS_DPI)

function saveBytes(bytes: Uint8Array | Blob, name: string, type: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function dataUrlBytes(url: string): Uint8Array {
  const [head, body] = url.split(',')
  if (head.includes(';base64')) {
    const bin = atob(body)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new TextEncoder().encode(decodeURIComponent(body))
}

// ---------------------------------------------------------------- DPI metadata

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(b: Uint8Array) {
  let c = 0xffffffff
  for (const v of b) c = CRC_TABLE[(c ^ v) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Insert a pHYs chunk (pixels per metre) right after IHDR. */
function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(4 + 4 + 9 + 4)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // 'pHYs'
  dv.setUint32(8, ppm)
  dv.setUint32(12, ppm)
  chunk[16] = 1 // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)))
  const ihdrEnd = 8 + 4 + 4 + 13 + 4
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, ihdrEnd))
  out.set(chunk, ihdrEnd)
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length)
  return out
}

/** Set the density fields of the JFIF APP0 segment (units: dots per inch). */
function jpgWithDpi(jpg: Uint8Array, dpi: number): Uint8Array {
  const out = jpg.slice()
  if (out[2] === 0xff && out[3] === 0xe0 && String.fromCharCode(...out.subarray(6, 10)) === 'JFIF') {
    out[13] = 1
    out[14] = dpi >> 8; out[15] = dpi & 0xff
    out[16] = dpi >> 8; out[17] = dpi & 0xff
  }
  return out
}

async function rgbPixels(png: Uint8Array): Promise<{ w: number; h: number; rgb: Uint8Array }> {
  const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(bmp, 0, 0)
  const rgba = g.getImageData(0, 0, c.width, c.height).data
  const rgb = new Uint8Array(c.width * c.height * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]
  }
  return { w: c.width, h: c.height, rgb }
}

/** Baseline RGB TIFF, uncompressed, with X/YResolution in dots per inch. */
function tiff(w: number, h: number, rgb: Uint8Array, dpi: number): Uint8Array {
  const entries = 12
  const ifdOff = 8
  const ifdLen = 2 + entries * 12 + 4
  const bpsOff = ifdOff + ifdLen, resOff = bpsOff + 6, dataOff = resOff + 16
  const out = new Uint8Array(dataOff + rgb.length)
  const dv = new DataView(out.buffer)
  out.set([0x49, 0x49, 42, 0]) // little endian, magic 42
  dv.setUint32(4, ifdOff, true)
  dv.setUint16(ifdOff, entries, true)
  let p = ifdOff + 2
  const tag = (t: number, type: number, n: number, v: number) => {
    dv.setUint16(p, t, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, n, true)
    if (type === 3 && n === 1) dv.setUint16(p + 8, v, true)
    else dv.setUint32(p + 8, v, true)
    p += 12
  }
  tag(256, 4, 1, w)               // ImageWidth
  tag(257, 4, 1, h)               // ImageLength
  tag(258, 3, 3, bpsOff)          // BitsPerSample 8,8,8
  tag(259, 3, 1, 1)               // Compression: none
  tag(262, 3, 1, 2)               // Photometric: RGB
  tag(273, 4, 1, dataOff)         // StripOffsets
  tag(277, 3, 1, 3)               // SamplesPerPixel
  tag(278, 4, 1, h)               // RowsPerStrip
  tag(279, 4, 1, rgb.length)      // StripByteCounts
  tag(282, 5, 1, resOff)          // XResolution
  tag(283, 5, 1, resOff + 8)      // YResolution
  tag(296, 3, 1, 2)               // ResolutionUnit: inch
  dv.setUint32(p, 0, true)        // no next IFD
  for (let i = 0; i < 3; i++) dv.setUint16(bpsOff + 2 * i, 8, true)
  for (const o of [resOff, resOff + 8]) { dv.setUint32(o, dpi, true); dv.setUint32(o + 4, 1, true) }
  out.set(rgb, dataOff)
  return out
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate') // zlib format, as PostScript FlateDecode expects
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function ascii85(data: Uint8Array): string {
  let out = ''
  let line = 0
  const push = (s: string) => {
    out += s
    line += s.length
    if (line >= 72) { out += '\n'; line = 0 }
  }
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.min(4, data.length - i)
    let v = 0
    for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? data[i + k] : 0)
    if (v === 0 && n === 4) { push('z'); continue }
    const d: string[] = []
    for (let k = 0; k < 5; k++) { d.unshift(String.fromCharCode(33 + (v % 85))); v = Math.floor(v / 85) }
    push(d.slice(0, n + 1).join(''))
  }
  return out + '~>'
}

/** Encapsulated PostScript (level 2) holding the figure as a lossless (Flate) RGB image. */
async function eps(w: number, h: number, rgb: Uint8Array, wPt: number, hPt: number, title: string): Promise<Uint8Array> {
  const z = await deflate(rgb)
  const head = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(wPt)} ${Math.ceil(hPt)}`,
    `%%HiResBoundingBox: 0 0 ${wPt.toFixed(3)} ${hPt.toFixed(3)}`,
    `%%Title: ${title.replace(/[^\x20-\x7e]/g, '_')}`,
    '%%Creator: Wavenum (Kishan Tiwari)',
    '%%LanguageLevel: 2',
    '%%Pages: 1',
    '%%EndComments',
    'gsave',
    `${wPt.toFixed(3)} ${hPt.toFixed(3)} scale`,
    '/DeviceRGB setcolorspace',
    `<< /ImageType 1 /Width ${w} /Height ${h} /BitsPerComponent 8 /Decode [0 1 0 1 0 1]`,
    `   /ImageMatrix [${w} 0 0 -${h} 0 ${h}] /DataSource currentfile /ASCII85Decode filter /FlateDecode filter >> image`,
  ].join('\n')
  const tail = '\ngrestore\nshowpage\n%%EOF\n'
  return new TextEncoder().encode(head + '\n' + ascii85(z) + tail)
}

const PDF_FONTS: Record<string, string> = { Arial: 'helvetica', Helvetica: 'helvetica', 'Times New Roman': 'times', Georgia: 'times', 'Courier New': 'courier' }

async function pdf(svg: string, wPx: number, hPx: number, font: string): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const wPt = (wPx * 72) / CSS_DPI, hPt = (hPx * 72) / CSS_DPI
  const doc = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation: wPt > hPt ? 'landscape' : 'portrait' })
  doc.setProperties({ title: 'Wavenum figure', author: 'Kishan Tiwari', creator: 'Wavenum' })
  doc.setFont(PDF_FONTS[font] ?? 'helvetica')
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  // svg2pdf measures text through the live DOM, so the SVG is attached while converting
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-99999px;top:0'
  host.appendChild(el)
  document.body.appendChild(host)
  try {
    await svg2pdf(el as unknown as Element, doc, { x: 0, y: 0, width: wPt, height: hPt })
  } finally {
    host.remove()
  }
  return doc.output('blob')
}

export type ExportOptions = { format: ExportFormat; widthMm: number; heightMm: number; dpi: number; filename: string; font: string }

/** Render a Plotly figure off-screen at its print size and save it in the chosen format. */
export async function exportFigure(data: any[], layout: any, o: ExportOptions) {
  const w = mmToCss(o.widthMm), h = mmToCss(o.heightMm)
  const tmp = document.createElement('div')
  tmp.style.cssText = `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px`
  document.body.appendChild(tmp)
  try {
    await Plotly.newPlot(tmp, data, { ...layout, width: w, height: h }, { staticPlot: true })
    const scale = o.dpi / CSS_DPI
    const base = o.filename.replace(/[\\/:*?"<>|]/g, '_') || 'wavenum'
    if (o.format === 'svg' || o.format === 'pdf') {
      const svg = new TextDecoder().decode(dataUrlBytes(await Plotly.toImage(tmp, { format: 'svg', width: w, height: h })))
      if (o.format === 'svg') return saveBytes(new TextEncoder().encode(svg), `${base}.svg`, 'image/svg+xml')
      return saveBytes(await pdf(svg, w, h, o.font), `${base}.pdf`, 'application/pdf')
    }
    if (o.format === 'jpg') {
      const jpg = dataUrlBytes(await Plotly.toImage(tmp, { format: 'jpeg', width: w, height: h, scale }))
      return saveBytes(jpgWithDpi(jpg, o.dpi), `${base}.jpg`, 'image/jpeg')
    }
    const png = dataUrlBytes(await Plotly.toImage(tmp, { format: 'png', width: w, height: h, scale }))
    if (o.format === 'png') return saveBytes(pngWithDpi(png, o.dpi), `${base}.png`, 'image/png')
    const px = await rgbPixels(png)
    if (o.format === 'tiff') return saveBytes(tiff(px.w, px.h, px.rgb, o.dpi), `${base}.tif`, 'image/tiff')
    return saveBytes(await eps(px.w, px.h, px.rgb, (o.widthMm / 25.4) * 72, (o.heightMm / 25.4) * 72, base), `${base}.eps`, 'application/postscript')
  } finally {
    Plotly.purge(tmp)
    tmp.remove()
  }
}
