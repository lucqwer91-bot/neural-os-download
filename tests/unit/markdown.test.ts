import { describe, it, expect } from 'vitest'
// @ts-ignore plain JS module
import { renderMarkdown, frontmatter, noteTags, headings, section } from '../../src/renderer/src/ui/markdown.js'

const R = (s: string) => renderMarkdown(s, { resolve: (n: string) => (n === 'Da' ? ' data-real="1"' : ''), t: (k: string) => k })

describe('Obsidian markdown (spec 5.9)', () => {
  it('renders properties, headings, lists, tasks and tables', () => {
    const h = R('---\ntags: [spiel, idee]\nstatus: offen\n---\n# Titel\n- a\n  - b\n- [x] fertig\n1. eins\n\n| A | B |\n|---|--:|\n| 1 | 2 |')
    expect(h).toContain('class="props"')
    expect(h).toContain('data-tag="spiel"')
    expect(h).toContain('<h1 id="titel">Titel</h1>')
    expect(h).toMatch(/<ul><li>a<ul><li>b<\/li><\/ul><\/li><li class="task done">/)
    expect(h).toContain('<ol><li>eins</li></ol>')
    expect(h).toContain('<td style="text-align:right">2</td>')
  })
  it('handles wikilinks with alias and heading, embeds, highlights, comments, footnotes, block ids', () => {
    const h = R('Siehe [[Da|hier]] und [[Fehlt#Teil]] ![[Bild.png]] ==wichtig== ~~alt~~ %%geheim%% Text[^1] ^abc\n\n[^1]: Quelle')
    expect(h).toContain('<span class="wl" data-real="1">hier</span>')
    expect(h).toContain('class="wl miss" data-heading="teil">Fehlt › Teil</span>')
    expect(h).toContain('data-embed="Bild.png"')
    expect(h).toContain('<mark>wichtig</mark>')
    expect(h).toContain('<s>alt</s>')
    expect(h).not.toContain('geheim')
    expect(h).toContain('<sup class="fn">')
    expect(h).toContain('class="footnotes"')
    expect(h).toContain('id="^abc"')
  })
  it('renders callouts (foldable), math and mermaid as placeholders, keeps unknown text', () => {
    const h = R('> [!warning]- Achtung\n> Inhalt\n\n$$\nE=mc^2\n$$\n\nInline $a^2$.\n\n```mermaid\ngraph TD; A-->B\n```\n\n<<komisch>>')
    expect(h).toContain('<details class="callout c-warning"><summary>')
    expect(h).toContain('Inhalt')
    expect(h).toContain('class="math block" data-tex="E=mc^2"')
    expect(h).toContain('class="math" data-tex="a^2"')
    expect(h).toContain('data-mermaid="graph TD; A--&gt;B"')
    expect(h).toContain('&lt;&lt;komisch&gt;&gt;')
  })
  it('never lets note text become HTML', () => {
    const h = R('<img src=x onerror=alert(1)> [[<b>x</b>]] `<script>`')
    expect(h).not.toMatch(/<img|<script|<b>x/)
  })
  it('reads tags, headings and sections', () => {
    expect(noteTags('---\ntags:\n  - Spiel\n---\nText #idee/neu und `#nicht` #123')).toEqual(['spiel', 'idee/neu'])
    expect(headings('# A\n```\n# no\n```\n## B c')).toEqual([{ level: 1, text: 'A', id: 'a' }, { level: 2, text: 'B c', id: 'b-c' }])
    expect(section('# A\nx\n## B\ny\n# C\nz', 'B')).toBe('## B\ny')
    expect(frontmatter('no fm').props).toBeNull()
  })
})
