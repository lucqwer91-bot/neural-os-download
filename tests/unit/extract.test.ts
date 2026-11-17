import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync, crc32 } from 'node:zlib'
import { openDb, type Db } from '../../src/main/library/db'
import { importFiles, readContent } from '../../src/main/library/library'
import { addFolder, scanFolder } from '../../src/main/library/linked'
import { docxText, extractPending, unzipEntry } from '../../src/main/library/extract'
import { search } from '../../src/main/context/query'

/** A minimal one-page PDF with the given lines (Helvetica). */
function pdf(lines: string[]): Buffer {
  const content = 'BT /F1 18 Tf 50 750 Td ' + lines.map((l) => `(${l}) Tj 0 -24 Td`).join(' ') + ' ET'
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let out = '%PDF-1.4\n'; const offs: number[] = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** A minimal zip (deflated entries), enough for a .docx. */
function zip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let off = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), data = deflateRawSync(raw), n = Buffer.from(name)
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8)
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10)
    c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42)
    parts.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10)
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, e])
}
const docx = (paras: string[]) => zip({
  '[Content_Types].xml': '<Types/>',
  'word/document.xml': '<?xml version="1.0"?><w:document><w:body>' + paras.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('') + '</w:body></w:document>'
})

let dir: string, db: Db, lib: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nos-ex-')); lib = join(dir, 'lib'); await mkdir(lib); db = openDb(join(dir, 'nos.db')) })
afterEach(async () => { db.close(); await rm(dir, { recursive: true, force: true }) })

describe('PDF and Word text (spec 5.1)', () => {
  it('reads .docx paragraphs, entities and the zip directory', () => {
    const b = docx(['Shop &amp; Preise', 'Zweiter Absatz'])
    expect(unzipEntry(b, 'missing.xml')).toBeNull()
    expect(docxText(b)).toBe('Shop & Preise\nZweiter Absatz')
    expect(docxText(Buffer.from('not a zip'))).toBeNull()
  })
  it('extracts imported PDF/DOCX text, previews and searches it, never changes the file', async () => {
    const src = join(dir, 'src'); await mkdir(src)
    await writeFile(join(src, 'Plan.pdf'), pdf(['Spawn Portale fuer die Lobby', 'Zweite Zeile']))
    await writeFile(join(src, 'Brief.docx'), docx(['Liebe Grosseltern', 'Pets kosten 50 Robux']))
    await writeFile(join(src, 'Leer.pdf'), pdf([]))
    const before = await readFile(join(src, 'Plan.pdf'))
    const r = await importFiles(db, lib, [join(src, 'Plan.pdf'), join(src, 'Brief.docx'), join(src, 'Leer.pdf')])
    const id = (n: string) => r.imported.find((x) => x.name === n)!.id
    expect(await readContent(db, lib, id('Plan.pdf'))).toEqual({ kind: 'none', reason: 'pending' })
    const got = await extractPending(db, lib)
    expect(got.sort()).toEqual([id('Plan.pdf'), id('Brief.docx')].sort())
    const c = await readContent(db, lib, id('Plan.pdf'))
    expect(c).toMatchObject({ kind: 'text', ext: 'extracted', from: 'pdf', pages: 1 })
    expect((c as { text: string }).text).toContain('Spawn Portale fuer die Lobby')
    expect(await readContent(db, lib, id('Leer.pdf'))).toEqual({ kind: 'none', reason: 'notext' })
    const st = (n: string) => (db.prepare('SELECT status FROM file_asset WHERE id = ?').get(id(n)) as { status: string }).status
    expect([st('Plan.pdf'), st('Brief.docx'), st('Leer.pdf')]).toEqual(['indexed', 'indexed', 'nameonly'])
    // search and context for Claude see the text
    expect(search(db, lib, 'Robux')[0].name).toBe('Brief.docx')
    // nothing to do twice; the original is untouched
    expect(await extractPending(db, lib)).toEqual([])
    expect(await readFile(join(src, 'Plan.pdf'))).toEqual(before)
  }, 30_000)
  it('reads linked files in place and again after they change', async () => {
    const v = join(dir, 'vault'); await mkdir(join(v, 'Schule'), { recursive: true })
    await writeFile(join(v, 'Schule', 'Referat.docx'), docx(['Photosynthese']))
    const f = addFolder(db, v); await scanFolder(db, f.id)
    expect((await extractPending(db, lib)).length).toBe(1)
    expect(search(db, lib, 'Photosynthese')[0].name).toBe('Referat.docx')
    await writeFile(join(v, 'Schule', 'Referat.docx'), docx(['Zellatmung']))
    db.prepare('UPDATE file_asset SET mtime = mtime + 10').run()
    expect((await extractPending(db, lib)).length).toBe(1)
    expect(search(db, lib, 'Zellatmung')).toHaveLength(1)
  })
})
