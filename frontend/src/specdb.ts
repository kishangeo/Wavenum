// specDB MATLAB projects (.mat v7.3 = HDF5) read in the browser, so large files never upload.
// Same rules as backend/formats.py read_specdb. Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
export type Named = { name: string; x: number[]; y: number[] }

export async function readSpecDB(buf: ArrayBuffer): Promise<Named[]> {
  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  const path = `specdb_${Date.now()}.mat`
  FS.writeFile(path, new Uint8Array(buf))
  const f = new h5wasm.File(path, 'r')
  try {
    // f.dereference() searches the whole file per call (~40 ms); MATLAB keeps every cell target in /#refs#,
    // so map reference bytes to paths once.
    const refs = f.get('/#refs#') as any
    if (!refs || !f.get('/data2save/DB')) throw new Error('Not a specDB file (no data2save.DB); only specDB .mat files are supported')
    const byRef = new Map<string, string>((refs.keys() as string[]).map(k => {
      const p = `/#refs#/${k}`
      return [(f.get(p) as any).create_reference().ref_data.join(','), p]
    }))
    const cells = (p: string) => ((f.get(p) as any).value as any[]).map(r => f.get(byRef.get(r.ref_data.join(',')) ?? '') as any)
    const [xs, ys, names] = ['/data2save/DB/x_signal', '/data2save/DB/y_signal', '/data2save/Meta/SampleName'].map(cells)
    const out: Named[] = []
    xs.forEach((xd, i) => {
      const x = Array.from(xd.value as ArrayLike<number>).map(Number), y = Array.from(ys[i].value as ArrayLike<number>).map(Number)
      const n = x.length
      if (n < 3 || y.length % n || typeof x[0] !== 'number') return
      const k = y.length / n
      let name = String.fromCharCode(...Array.from((names[i]?.value ?? []) as ArrayLike<number>)) || `spectrum ${i + 1}`
      if (k > 1) name += ` (mean of ${k})`
      const X: number[] = [], Y: number[] = []
      for (let j = 0; j < n; j++) {
        let s = 0
        for (let r = 0; r < k; r++) s += y[r * n + j]
        if (Number.isFinite(x[j]) && Number.isFinite(s)) { X.push(x[j]); Y.push(s / k) }
      }
      if (X.length >= 3) out.push({ name, x: X, y: Y })
    })
    if (!out.length) throw new Error('No spectra found in specDB file')
    return out
  } finally {
    f.close()
    FS.unlink(path)
  }
}
