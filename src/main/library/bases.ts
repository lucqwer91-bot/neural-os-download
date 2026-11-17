import type { Db } from './db'
import { noteText } from './notes'
// same frontmatter and tag rules as the note view
import { frontmatter, noteTags } from '../../renderer/src/ui/markdown.js'
import { readContent } from './library'
import { stem, wikilinks } from './organize'

// Obsidian Bases (.base files), read only: the views are shown as tables over the user's notes.
// Supported: filters with and/or/not, comparisons (== != > < >= <=), && || !, file.hasTag, file.inFolder,
// file.hasLink, file.hasProperty, .contains/.startsWith/.endsWith/.isEmpty(), file.* and note properties,
// order (columns), sort, limit. Anything else (formulas, other functions) is reported as not supported;
// a filter NEURAL OS cannot read is left out and the view says so, so a table is never silently wrong.

/* ---------- a small YAML reader (the subset .base files use) ---------- */
type Y = string | number | boolean | null | Y[] | { [k: string]: Y }
const scalar = (v: string): Y => {
  const s = v.trim()
  if (s === '' || s === '~' || s === 'null') return null
  if (s === 'true') return true
  if (s === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^".*"$/.test(s)) { try { return JSON.parse(s) as string } catch { return s.slice(1, -1) } }
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'")
  if (/^\[.*\]$/.test(s)) return s.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== null)
  return s
}
const stripComment = (l: string) => { let q: string | null = null; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === q) q = null } else if (c === '"' || c === "'") q = c; else if (c === '#' && (i === 0 || /\s/.test(l[i - 1]))) return l.slice(0, i) } return l }

export function parseYaml(text: string): Y {
  const lines = text.replace(/\t/g, '  ').split(/\r?\n/).map(stripComment).filter((l) => l.trim() !== '' && l.trim() !== '---')
  let i = 0
  const ind = (l: string) => l.length - l.trimStart().length
  function block(level: number): Y {
    if (i >= lines.length) return null
    if (lines[i].trimStart().startsWith('- ') || lines[i].trim() === '-') {
      const arr: Y[] = []
      while (i < lines.length && ind(lines[i]) === level && /^-(\s|$)/.test(lines[i].trimStart())) {
        const rest = lines[i].trimStart().slice(1).trimStart()
        if (!rest) { i++; arr.push(i < lines.length && ind(lines[i]) > level ? block(ind(lines[i])) : null); continue }
        if (/^[^"'\s][^:]*:(\s|$)/.test(rest) && !/^\w+\(/.test(rest)) {
          // "- key: value" starts a map whose other keys are indented further
          lines[i] = ' '.repeat(level + 2) + rest
          arr.push(block(level + 2))
        } else { arr.push(scalar(rest)); i++ }
      }
      return arr
    }
    const obj: { [k: string]: Y } = {}
    while (i < lines.length && ind(lines[i]) === level) {
      const m = /^([^:]+?):(?:\s+(.*))?$/.exec(lines[i].trim())
      if (!m) { i++; continue }
      const key = m[1].trim().replace(/^["']|["']$/g, ''), v = m[2]
      i++
      if (v !== undefined && v.trim() !== '') obj[key] = scalar(v)
      else if (i < lines.length && (ind(lines[i]) > level || (ind(lines[i]) === level && /^-(\s|$)/.test(lines[i].trimStart())))) obj[key] = block(ind(lines[i]))
      else obj[key] = null
    }
    return obj
  }
  return block(lines.length ? ind(lines[0]) : 0)
}

/* ---------- expressions ---------- */
class Unsupported extends Error {}
type Tok = { t: 'str' | 'num' | 'id' | 'op' | 'p'; v: string }
function lex(s: string): Tok[] {
  const out: Tok[] = []; let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '"' || c === "'") { let j = i + 1, v = ''; while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; v += s[j++] } out.push({ t: 'str', v }); i = j + 1; continue }
    if (/\d/.test(c)) { const m = /^\d+(\.\d+)?/.exec(s.slice(i))!; out.push({ t: 'num', v: m[0] }); i += m[0].length; continue }
    if (/[\p{L}_]/u.test(c)) { const m = /^[\p{L}\p{N}_.-]*[\p{L}\p{N}_]/u.exec(s.slice(i)) || [c]; out.push({ t: 'id', v: m[0] }); i += m[0].length; continue }
    const two = s.slice(i, i + 2)
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue }
    if ('<>!'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue }
    if ('(),'.includes(c)) { out.push({ t: 'p', v: c }); i++; continue }
    throw new Unsupported(c)
  }
  return out
}
type Node = { k: 'lit'; v: unknown } | { k: 'ref'; v: string } | { k: 'call'; f: string; on: Node | null; args: Node[] } | { k: 'not'; a: Node } | { k: 'bin'; op: string; a: Node; b: Node }
function parseExpr(src: string): Node {
  const T = lex(src); let p = 0
  const peek = () => T[p], eat = (v?: string) => { const x = T[p++]; if (!x || (v && x.v !== v)) throw new Unsupported(src); return x }
  const PREC: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '>': 4, '<': 4, '>=': 4, '<=': 4 }
  function primary(): Node {
    const x = eat()
    if (x.t === 'str') return { k: 'lit', v: x.v }
    if (x.t === 'num') return { k: 'lit', v: Number(x.v) }
    if (x.t === 'op' && x.v === '!') return { k: 'not', a: primary() }
    if (x.t === 'p' && x.v === '(') { const e = expr(0); eat(')'); return e }
    if (x.t === 'id') {
      if (x.v === 'true' || x.v === 'false') return { k: 'lit', v: x.v === 'true' }
      if (peek()?.v === '(') {
        eat('('); const args: Node[] = []
        while (peek() && peek().v !== ')') { args.push(expr(0)); if (peek()?.v === ',') eat(',') }
        eat(')')
        const dot = x.v.lastIndexOf('.')
        const obj = dot > 0 ? x.v.slice(0, dot) : null, f = dot > 0 ? x.v.slice(dot + 1) : x.v
        return obj === 'file' ? { k: 'call', f: 'file.' + f, on: null, args } : { k: 'call', f, on: obj ? { k: 'ref', v: obj } : null, args }
      }
      return { k: 'ref', v: x.v }
    }
    throw new Unsupported(src)
  }
  function expr(min: number): Node {
    let a = primary()
    while (peek() && peek().t === 'op' && PREC[peek().v] !== undefined && PREC[peek().v] > min) { const op = eat().v; a = { k: 'bin', op, a, b: expr(PREC[op]) } }
    return a
  }
  const e = expr(0); if (p < T.length) throw new Unsupported(src); return e
}

export interface FileCtx { name: string; basename: string; ext: string; path: string; folder: string; mtime: number; size: number; tags: string[]; links: string[]; props: Record<string, unknown> }
function ref(c: FileCtx, name: string): unknown {
  if (name.startsWith('file.')) {
    const k = name.slice(5) as keyof FileCtx
    if (['name', 'basename', 'ext', 'path', 'folder', 'mtime', 'size', 'tags', 'links'].includes(k)) return c[k]
    throw new Unsupported(name)
  }
  if (name.startsWith('formula.')) throw new Unsupported(name)
  const k = name.startsWith('note.') ? name.slice(5) : name
  return c.props[k] ?? null
}
const lower = (v: unknown) => String(v ?? '').toLowerCase()
function evalNode(n: Node, c: FileCtx): unknown {
  switch (n.k) {
    case 'lit': return n.v
    case 'ref': return ref(c, n.v)
    case 'not': return !evalNode(n.a, c)
    case 'bin': {
      if (n.op === '&&') return !!evalNode(n.a, c) && !!evalNode(n.b, c)
      if (n.op === '||') return !!evalNode(n.a, c) || !!evalNode(n.b, c)
      const a = evalNode(n.a, c), b = evalNode(n.b, c)
      // frontmatter values are text: "5" and 10 compare as numbers when both look like numbers
      const isNum = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && !isNaN(Number(v))
      const num = isNum(a) && isNum(b)
      const x = num ? Number(a) : String(a ?? ''), y = num ? Number(b) : String(b ?? '')
      switch (n.op) { case '==': return x === y; case '!=': return x !== y; case '>': return x > y; case '<': return x < y; case '>=': return x >= y; case '<=': return x <= y }
      throw new Unsupported(n.op)
    }
    case 'call': {
      const args = n.args.map((a) => evalNode(a, c))
      switch (n.f) {
        case 'file.hasTag': return args.some((t) => { const g = lower(t).replace(/^#/, ''); return c.tags.some((x) => x === g || x.startsWith(g + '/')) })
        case 'file.inFolder': { const f = lower(args[0]).replace(/^\/+|\/+$/g, ''); const d = c.folder.toLowerCase(); return d === f || d.startsWith(f + '/') }
        case 'file.hasLink': return c.links.includes(stem(String(args[0] ?? '').split('/').pop() || ''))
        case 'file.hasProperty': return Object.prototype.hasOwnProperty.call(c.props, String(args[0]))
      }
      if (n.on) {
        const v = evalNode(n.on, c)
        if (n.f === 'isEmpty') return v == null || v === '' || (Array.isArray(v) && !v.length)
        if (n.f === 'contains') return Array.isArray(v) ? v.map(lower).includes(lower(args[0])) : lower(v).includes(lower(args[0]))
        if (n.f === 'startsWith') return lower(v).startsWith(lower(args[0]))
        if (n.f === 'endsWith') return lower(v).endsWith(lower(args[0]))
      }
      throw new Unsupported(n.f)
    }
  }
}

/** A filter block (string | {and|or|not: [...]}) as a test; parts NEURAL OS cannot read are collected in `skipped`. */
function compile(f: Y, skipped: string[]): (c: FileCtx) => boolean {
  if (f == null) return () => true
  if (typeof f === 'string') {
    try { const n = parseExpr(f); return (c) => { try { return !!evalNode(n, c) } catch (e) { if (e instanceof Unsupported) { if (!skipped.includes(f)) skipped.push(f); return true } throw e } } }
    catch (e) { if (e instanceof Unsupported) { skipped.push(f); return () => true } throw e }
  }
  if (typeof f === 'object' && !Array.isArray(f)) {
    const parts = (k: string) => (Array.isArray(f[k]) ? (f[k] as Y[]) : f[k] != null ? [f[k]] : []).map((x) => compile(x, skipped))
    const and = parts('and'), or = parts('or'), not = parts('not')
    return (c) => and.every((t) => t(c)) && (!or.length || or.some((t) => t(c))) && !not.some((t) => t(c))
  }
  skipped.push(JSON.stringify(f)); return () => true
}

export interface BaseView { name: string; type: string; columns: { key: string; label: string }[]; rows: { id: string; cells: unknown[] }[]; total: number; skipped: string[]; unsupportedType: boolean }
const MAX_ROWS = 500

/** Evaluates a .base file over the library's notes. */
export async function evalBase(db: Db, libDir: string, id: string): Promise<{ ok: true; views: BaseView[] } | { ok: false; reason: string }> {
  const c = await readContent(db, libDir, id)
  if (c.kind !== 'text') return { ok: false, reason: 'missing' }
  let doc: Y
  try { doc = parseYaml(c.text) } catch { return { ok: false, reason: 'yaml' } }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, reason: 'yaml' }
  const files = db.prepare(`SELECT f.id, f.name, f.ext, f.size, f.mtime, f.rel_path, f.original_path, f.source, f.lib_path, lf.path AS folder_path
    FROM file_asset f LEFT JOIN linked_folder lf ON lf.id = f.folder_id`).all() as unknown as { id: string; name: string; ext: string; size: number; mtime: number | null; rel_path: string | null; original_path: string; source: string; lib_path: string; folder_path: string | null }[]
  const ctx: (FileCtx & { id: string })[] = []
  for (const f of files) {
    const path = (f.rel_path || f.name).replace(/\\/g, '/')
    let props: Record<string, unknown> = {}, tags: string[] = [], links: string[] = []
    if (f.ext === 'md') {
      const t = await noteText(db, libDir, f)
      if (t) {
        const fm = frontmatter(t) as { props: { key: string; value: unknown }[] | null }
        for (const p of fm.props || []) props[p.key] = p.value
        tags = noteTags(t) as string[]; links = wikilinks(t)
      }
    }
    ctx.push({ id: f.id, name: f.name, basename: f.name.replace(/\.[^.]+$/, ''), ext: f.ext, path, folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', mtime: f.mtime || 0, size: f.size, tags, links, props })
  }
  const topSkipped: string[] = []
  const top = compile((doc as { [k: string]: Y }).filters ?? null, topSkipped)
  const propsCfg = ((doc as { [k: string]: Y }).properties || {}) as { [k: string]: { displayName?: string } | null }
  const viewsY = Array.isArray((doc as { [k: string]: Y }).views) ? ((doc as { [k: string]: Y }).views as Y[]) : [{ type: 'table', name: 'Table' }]
  const views: BaseView[] = []
  for (const vy of viewsY) {
    const v = (vy && typeof vy === 'object' && !Array.isArray(vy) ? vy : {}) as { [k: string]: Y }
    const skipped = [...topSkipped]
    const own = compile(v.filters ?? null, skipped)
    const order = (Array.isArray(v.order) ? v.order : ['file.name']).map(String)
    const columns = order.map((key) => ({ key, label: propsCfg[key]?.displayName || propsCfg['note.' + key]?.displayName || key.replace(/^(note|file)\./, '') }))
    let rows = ctx.filter((x) => top(x) && own(x))
    const sorts = Array.isArray(v.sort) ? (v.sort as { property?: string; direction?: string }[]) : []
    const val = (x: FileCtx, k: string) => { try { return ref(x, k) } catch (e) { if (e instanceof Unsupported) return null; throw e } }
    if (sorts.length) rows.sort((a, b) => {
      for (const s of sorts) {
        const k = String(s.property || 'file.name'), x = val(a, k), y = val(b, k)
        const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })
        if (d) return s.direction && /desc/i.test(s.direction) ? -d : d
      }
      return 0
    })
    else rows.sort((a, b) => a.name.localeCompare(b.name))
    const total = rows.length
    const limit = typeof v.limit === 'number' ? v.limit : MAX_ROWS
    rows = rows.slice(0, Math.min(limit, MAX_ROWS))
    const formulaCols = columns.filter((col) => col.key.startsWith('formula.')).map((col) => col.key)
    views.push({
      name: String(v.name || v.type || 'Table'), type: String(v.type || 'table'), columns, total,
      rows: rows.map((x) => ({ id: x.id, cells: order.map((k) => val(x, k)) })),
      skipped: [...skipped, ...formulaCols], unsupportedType: String(v.type || 'table') !== 'table'
    })
  }
  return { ok: true, views }
}
