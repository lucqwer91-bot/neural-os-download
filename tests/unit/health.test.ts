import { describe, expect, it } from 'vitest'
import { excludeMatcher } from '../../src/main/library/linked'

describe('exclude patterns', () => {
  it('matches names anywhere and paths from the top', () => {
    const m = excludeMatcher('Imports\n*.png\nDaily/2024-*\n# comment\nArchiv/2023/')
    expect(m('Studio/Imports')).toBe(true)
    expect(m('Studio/Imports/Packs/a.md')).toBe(true)
    expect(m('a/b/pic.PNG')).toBe(true)
    expect(m('Daily/2024-01-02.md')).toBe(true)
    expect(m('x/Daily/2024-01-02.md')).toBe(false)
    expect(m('Archiv/2023/x.md')).toBe(true)
    expect(m('Archiv/2024/x.md')).toBe(false)
    expect(m('Notes/Import.md')).toBe(false)
    expect(m('comment')).toBe(false)
  })
  it('** spans folders, empty means nothing', () => {
    expect(excludeMatcher('a/**/z.md')('a/b/c/z.md')).toBe(true)
    expect(excludeMatcher('')('anything')).toBe(false)
    expect(excludeMatcher('a.b')('axb')).toBe(false)
  })
})

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/library/db'
import { addFolder, applyPaths, scanFolder, setFolderExclude } from '../../src/main/library/linked'
import { listFiles } from '../../src/main/library/library'
import { organize } from '../../src/main/library/organize'
import { libraryHealth } from '../../src/main/library/health'

describe('exclude in scans + library check', () => {
  it('rescans without excluded files, watcher paths respect it, reports broken links and orphans', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nos-h-')), v = join(dir, 'V')
    await mkdir(join(v, 'Imports', 'Big'), { recursive: true })
    await writeFile(join(v, 'A.md'), '---\naliases: [Alpha]\n---\n[[B]] [[Missing]] [[Alpha]] [[pic.png]]')
    await writeFile(join(v, 'B.md'), '[[Missing]] [[Gone|x]]')
    await writeFile(join(v, 'Lonely.md'), 'no links')
    await writeFile(join(v, 'pic.png'), Buffer.alloc(10))
    await writeFile(join(v, 'Imports', 'Big', 'X.md'), '[[Nowhere]]')
    const db = openDb(join(dir, 'n.db'))
    try {
      const f = addFolder(db, v)
      const r = await scanFolder(db, f.id)
      await organize(db, '', r.added, { wikilinksOnly: true })
      expect(listFiles(db).map((x) => x.name).sort()).toEqual(['A.md', 'B.md', 'Lonely.md', 'X.md', 'pic.png'])
      let h = libraryHealth(db)
      expect(h.broken.map((b) => b.stem).sort()).toEqual(['gone', 'missing', 'nowhere'])
      expect(h.broken[0]).toMatchObject({ stem: 'missing', count: 2 })
      expect(h.orphans.map((o) => o.name)).toEqual(['Lonely.md', 'X.md'])
      expect(setFolderExclude(db, f.id, ' Imports \n\n')).toBe(true)
      const r2 = await scanFolder(db, f.id)
      expect(r2.removed).toBe(1)
      expect(listFiles(db).some((x) => x.name === 'X.md')).toBe(false)
      expect((await applyPaths(db, f.id, ['Imports/Big/X.md'])).added).toHaveLength(0)
      h = libraryHealth(db)
      expect(h.broken.map((b) => b.stem).sort()).toEqual(['gone', 'missing'])
    } finally { db.close(); await rm(dir, { recursive: true, force: true }) }
  })
})
