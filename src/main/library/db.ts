import { DatabaseSync } from 'node:sqlite'

// Local metadata database (spec 12.1, 12.2). One SQLite file in the app data folder.
// Schema changes go into MIGRATIONS as new entries; never edit an existing entry.
// The schema version is stored in PRAGMA user_version.

export const MIGRATIONS: string[] = [
  // 1: projects, library files, settings
  `CREATE TABLE project (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL
   );
   CREATE TABLE file_asset (
     id TEXT PRIMARY KEY,                 -- stable id, never reused
     name TEXT NOT NULL,                  -- display name (NFC)
     ext TEXT NOT NULL,                   -- lower case, without dot
     size INTEGER NOT NULL,
     hash TEXT NOT NULL UNIQUE,           -- sha256 of the content, duplicate check
     lib_path TEXT NOT NULL,              -- path of the copy, relative to the library folder
     original_path TEXT NOT NULL,         -- where it was imported from (never touched)
     imported_at TEXT NOT NULL,
     project_id TEXT REFERENCES project(id) ON DELETE SET NULL,
     status TEXT NOT NULL DEFAULT 'indexing'  -- indexed | indexing | nameonly | failed | unsupported
   );
   CREATE INDEX file_asset_project ON file_asset(project_id);
   CREATE TABLE app_setting (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  // 2: links between library files. origin 'user' = written by the user (e.g. a [[wikilink]] in the file),
  // 'auto' = found by NEURAL OS rules (reason says which); auto links are marked and can be removed.
  `CREATE TABLE knowledge_edge (
     id INTEGER PRIMARY KEY,
     from_id TEXT NOT NULL REFERENCES file_asset(id) ON DELETE CASCADE,
     to_id TEXT NOT NULL REFERENCES file_asset(id) ON DELETE CASCADE,
     origin TEXT NOT NULL,                -- user | auto
     reason TEXT NOT NULL,                -- wikilink | mention | folder | name
     status TEXT NOT NULL DEFAULT 'linked', -- linked | suggested | rejected
     created_at TEXT NOT NULL,
     UNIQUE (from_id, to_id, reason)
   );
   CREATE INDEX knowledge_edge_to ON knowledge_edge(to_id);
   ALTER TABLE file_asset ADD COLUMN project_origin TEXT;  -- user | auto | NULL`,
  // 3: linked folders (stay where they are, read-only) and stored wikilink targets for fast link lookups.
  // Linked files live in file_asset with source = 'linked'; their hash is 'link:<folder>:<path>', not a content hash.
  `CREATE TABLE linked_folder (
     id TEXT PRIMARY KEY,
     path TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     editable INTEGER NOT NULL DEFAULT 0, -- spec 5.1: read-only unless the user enables editing
     added_at TEXT NOT NULL,
     last_scan TEXT
   );
   ALTER TABLE file_asset ADD COLUMN source TEXT NOT NULL DEFAULT 'copy';  -- copy | linked
   ALTER TABLE file_asset ADD COLUMN folder_id TEXT REFERENCES linked_folder(id) ON DELETE CASCADE;
   ALTER TABLE file_asset ADD COLUMN rel_path TEXT;   -- linked: path inside the folder, '/' separated
   ALTER TABLE file_asset ADD COLUMN mtime REAL;      -- linked: for incremental updates
   CREATE INDEX file_asset_folder ON file_asset(folder_id, rel_path);
   CREATE TABLE wikilink_target (
     file_id TEXT NOT NULL REFERENCES file_asset(id) ON DELETE CASCADE,
     stem TEXT NOT NULL,
     PRIMARY KEY (file_id, stem)
   );
   CREATE INDEX wikilink_target_stem ON wikilink_target(stem);`,
  // 4: Claude Code monitoring (spec 6). Only verified hook fields, no prompts, no tool output.
  `CREATE TABLE claude_session (
     id TEXT PRIMARY KEY,           -- session_id from the hook payload
     cwd TEXT,
     started_at TEXT NOT NULL,      -- first event seen
     last_at TEXT NOT NULL,
     ended_at TEXT,
     end_reason TEXT,
     model TEXT,                    -- only from SessionStart, else NULL = not available
     events INTEGER NOT NULL DEFAULT 0,
     muted INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE claude_event (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     received_at TEXT NOT NULL,
     hook TEXT NOT NULL,            -- hook_event_name as received
     type TEXT NOT NULL,            -- normalized event_type
     tool TEXT,
     file_path TEXT,
     file_id TEXT,                  -- matching library file, if any
     cwd TEXT,
     region TEXT NOT NULL,
     status TEXT,
     duration_ms INTEGER,
     summary TEXT,
     agent_id TEXT,
     tool_use_id TEXT
   );
   CREATE INDEX claude_event_session ON claude_event(session_id, received_at);
   CREATE INDEX claude_event_time ON claude_event(received_at);
   CREATE INDEX claude_event_file ON claude_event(file_id);
   -- S1 AI change log: text before and after a change Claude made
   CREATE TABLE claude_change (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL,
     tool_use_id TEXT,
     at TEXT NOT NULL,
     tool TEXT NOT NULL,
     file_path TEXT NOT NULL,
     file_id TEXT,
     before_text TEXT,              -- NULL = not available
     after_text TEXT,
     how TEXT NOT NULL              -- how 'before' was obtained: snapshot | reconstructed | new_file | unavailable
   );
   CREATE INDEX claude_change_session ON claude_change(session_id, at);
   CREATE INDEX claude_change_file ON claude_change(file_id);`,
  // 5: text read out of PDF and Word files (search, preview, context for Claude); never written back
  `CREATE TABLE file_text (
     file_id TEXT PRIMARY KEY,
     text TEXT NOT NULL,
     pages INTEGER,
     mtime REAL,                    -- file_asset.mtime when the text was read; differs = read again
     extracted_at TEXT NOT NULL
   );`,
  // 6: Claude's lesson book: lessons per project folder; the user keeps, drops or rewrites them
  `CREATE TABLE lesson (
     id TEXT PRIMARY KEY,
     project TEXT NOT NULL,         -- folder name (lower-case match), '' = all projects
     cwd TEXT,
     text TEXT NOT NULL,
     source TEXT NOT NULL,          -- claude | user
     status TEXT NOT NULL,          -- new | kept | dropped
     session_id TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX lesson_project ON lesson(project, status);`,
  // 7: note editor (spec 5.6, 5.1): the previous text before every save, so any edit can be undone
  `CREATE TABLE note_version (
     id TEXT PRIMARY KEY,
     file_id TEXT NOT NULL REFERENCES file_asset(id) ON DELETE CASCADE,
     saved_at TEXT NOT NULL,
     text TEXT NOT NULL,            -- the file as it was before this save
     reason TEXT NOT NULL           -- save | restore | conflict
   );
   CREATE INDEX note_version_file ON note_version(file_id, saved_at);`,
  // 8: other names of a note (frontmatter "aliases"); [[alias]] links to the note like its own name
  `CREATE TABLE note_alias (
     file_id TEXT NOT NULL REFERENCES file_asset(id) ON DELETE CASCADE,
     stem TEXT NOT NULL,            -- lower case, NFC
     PRIMARY KEY (file_id, stem)
   );
   CREATE INDEX note_alias_stem ON note_alias(stem);`,
  // 9: per linked folder: paths the user excluded from the index (one pattern per line, e.g. Imports/ or *.png)
  `ALTER TABLE linked_folder ADD COLUMN exclude TEXT NOT NULL DEFAULT '';`,
  // 10: what Luau scripts of linked folders use (luau.ts): modules they require, remotes they fire or handle,
  // DataStores and asset ids; read from the code by rules, recomputed after scans
  `CREATE TABLE luau_ref (
     file_id TEXT NOT NULL REFERENCES file_asset(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,            -- require | remote | datastore | asset
     name TEXT NOT NULL,            -- module name, remote name, DataStore name, asset id
     role TEXT NOT NULL DEFAULT '', -- remote: fire | handle; require: resolved file id or ''
     side TEXT NOT NULL DEFAULT '', -- server | client | shared (from Rojo names and folders)
     line INTEGER NOT NULL
   );
   CREATE INDEX luau_ref_name ON luau_ref(kind, name);
   CREATE INDEX luau_ref_file ON luau_ref(file_id);`,
  // 11: device sync through the user's own cloud folder (sync/sync.ts): which device a row came from
  // (NULL = this device), other devices seen, and deleted lessons so the delete reaches the other devices
  `ALTER TABLE claude_session ADD COLUMN device TEXT;
   ALTER TABLE claude_event ADD COLUMN device TEXT;
   ALTER TABLE claude_change ADD COLUMN device TEXT;
   ALTER TABLE lesson ADD COLUMN device TEXT;
   CREATE INDEX claude_session_last ON claude_session(last_at);
   CREATE INDEX claude_change_at ON claude_change(at);
   CREATE INDEX lesson_updated ON lesson(updated_at);
   CREATE TABLE sync_peer (
     id TEXT PRIMARY KEY,           -- the other device's random id
     name TEXT NOT NULL,
     platform TEXT,
     seen_at TEXT NOT NULL,         -- last time its journal had something new
     updated_at TEXT                -- its own device.json time
   );
   CREATE TABLE sync_tomb (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,            -- lesson
     at TEXT NOT NULL
   );`
]

export type Db = DatabaseSync

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function schemaVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

export function migrate(db: Db): number {
  let v = schemaVersion(db)
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    v++
  }
  return v
}
