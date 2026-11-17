import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from './db'
import { addFolder, scanFolder, type ScanResult } from './linked'
import { setFolderEditable } from './write'

// Test mode (colleague review: "try it in a sandbox first"): a small example vault in NEURAL OS's own
// data folder, linked with editing on, so everything can be tried without touching a real vault and
// without connecting Claude Code. Removing it = unlink and delete the folder; nothing else refers to it.

type Notes = Record<string, string>

const EN: Notes = {
  'Start here.md': '---\ntags: [start]\n---\n# Start here\n\nThis is an **example vault**. Change anything: it lives in NEURAL OS\'s own data folder, not in your notes.\n\n> [!tip] Try this\n> - Open **Files** in the dock: new note, rename, drag a note onto a folder, trash and undo.\n> - Hover over [[Game idea]] to preview it.\n> - Paste an image into a note while editing.\n> - Pin a note beside another (Pin beside) and switch tabs with Ctrl+Tab.\n\nSee also [[Daily/Today]] and [[Projects/Shop system]].\n',
  'Game idea.md': '---\nstatus: idea\ntags: [game, roblox]\naliases: [Idea]\n---\n# Game idea\n\nA small tycoon with a [[Projects/Shop system|shop]] and daily rewards.\n\n- [ ] Sketch the map\n- [x] Pick a name\n',
  'Projects/Shop system.md': '---\nstatus: doing\ntags: [game]\n---\n# Shop system\n\nPrices live in one module. The server checks every purchase.\n\n```lua\nlocal price = Prices[itemId]\n```\n\nBack to [[Game idea]].\n',
  'Projects/Daily rewards.md': '# Daily rewards\n\nStreak resets after 48 hours. Linked from [[Game idea]].\n',
  'Daily/Today.md': '# Today\n\n- Worked on [[Projects/Shop system]]\n- Question for later: ==how big is the map?==\n',
  'Inbox/Loose thought.md': 'A note without links. **Memory → Library → Check library** finds notes like this.\n'
}
const DE: Notes = {
  'Hier starten.md': '---\ntags: [start]\n---\n# Hier starten\n\nDas ist ein **Beispiel-Vault**. Ändere ruhig alles: er liegt im Datenordner von NEURAL OS, nicht bei deinen Notizen.\n\n> [!tip] Probier das\n> - Öffne **Dateien** im Dock: neue Notiz, umbenennen, Notiz auf einen Ordner ziehen, Papierkorb und Rückgängig.\n> - Fahre über [[Spielidee]], um die Vorschau zu sehen.\n> - Füge beim Bearbeiten ein Bild ein.\n> - Hefte eine Notiz daneben an (Daneben anheften) und wechsle Tabs mit Strg+Tab.\n\nSiehe auch [[Tägliches/Heute]] und [[Projekte/Shop-System]].\n',
  'Spielidee.md': '---\nstatus: idee\ntags: [spiel, roblox]\naliases: [Idee]\n---\n# Spielidee\n\nEin kleines Tycoon mit [[Projekte/Shop-System|Shop]] und täglichen Belohnungen.\n\n- [ ] Karte skizzieren\n- [x] Namen finden\n',
  'Projekte/Shop-System.md': '---\nstatus: läuft\ntags: [spiel]\n---\n# Shop-System\n\nPreise liegen in einem Modul. Der Server prüft jeden Kauf.\n\n```lua\nlocal price = Prices[itemId]\n```\n\nZurück zur [[Spielidee]].\n',
  'Projekte/Tägliche Belohnung.md': '# Tägliche Belohnung\n\nDie Serie endet nach 48 Stunden. Verlinkt von [[Spielidee]].\n',
  'Tägliches/Heute.md': '# Heute\n\n- Am [[Projekte/Shop-System]] gearbeitet\n- Frage für später: ==wie groß wird die Karte?==\n',
  'Eingang/Loser Gedanke.md': 'Eine Notiz ohne Links. **Gedächtnis → Bibliothek → Bibliothek prüfen** findet solche Notizen.\n'
}

/** Writes the example vault (once) and links it with editing on. Returns the linked folder id. */
export async function exampleVault(db: Db, dataDir: string, lang = 'en'): Promise<{ id: string; path: string; created: boolean; scan?: ScanResult }> {
  const path = join(dataDir, lang === 'de' ? 'Beispiel-Vault' : 'Example Vault')
  const known = db.prepare('SELECT id FROM linked_folder WHERE path = ?').get(path) as { id: string } | undefined
  if (known) return { id: known.id, path, created: false }
  if (!existsSync(path)) {
    for (const [rel, text] of Object.entries(lang === 'de' ? DE : EN)) {
      const p = join(path, ...rel.split('/'))
      await mkdir(join(p, '..'), { recursive: true })
      await writeFile(p, text, { encoding: 'utf8', flag: 'wx' }).catch(() => undefined)
    }
  }
  const f = addFolder(db, path)
  setFolderEditable(db, f.id, true)
  const scan = await scanFolder(db, f.id)
  return { id: f.id, path, created: true, scan }
}
