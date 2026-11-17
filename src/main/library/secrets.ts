// Keys, passwords and tokens never enter NEURAL OS (user's colleague's review, 2026-11-17).
// 1. Files that are named like secrets are not indexed at all: not read, not shown, not given to Claude,
//    not exported in a .brain file. Code files (e.g. TokenService.lua) are not blocked by name.
// 2. In every text NEURAL OS shows or hands to Claude, anything that looks like a key is replaced.

const CODE = new Set(['lua', 'luau', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'cs', 'java', 'go', 'rs', 'rb', 'php', 'c', 'cpp', 'h', 'swift', 'kt', 'gd', 'md', 'canvas', 'base'])
const SECRET_EXT = new Set(['pem', 'key', 'p12', 'pfx', 'keystore', 'jks', 'kdbx', 'ppk', 'asc', 'gpg'])
const SECRET_EXACT = /^(\.env(\..+)?|\.npmrc|\.netrc|\.pgpass|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\.\w+)?|secrets?(\.\w+)?|known_hosts)$/i
const SECRET_WORD = /(api[ _-]?keys?|secret|tokens?|passw(or)?(d|t)|passw[oö]rt|credential|private[ _-]?key|access[ _-]?key)/i
const ENDS_KEY = /(^|[ _.-])keys?$/i

export function isSecretName(name: string): boolean {
  const n = name.normalize('NFC')
  if (SECRET_EXACT.test(n)) return true
  const dot = n.lastIndexOf('.')
  const ext = dot > 0 ? n.slice(dot + 1).toLowerCase() : ''
  const stem = dot > 0 ? n.slice(0, dot) : n
  if (SECRET_EXT.has(ext)) return true
  if (CODE.has(ext)) return false // code and notes are read; their content is still masked below
  return SECRET_WORD.test(stem) || ENDS_KEY.test(stem)
}

const HIDDEN = '[key hidden by NEURAL OS]'
const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk[-_](?:live_|test_|proj-|ant-)?[A-Za-z0-9_-]{20,}/g,      // OpenAI, Anthropic, Stripe, ElevenLabs
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, /\bgithub_pat_[A-Za-z0-9_]{30,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g // JWT
]
// name = value: keep the name, hide the value
const ASSIGN = /((?:api[_-]?key|apikey|secret|token|password|passwort|passwd|auth|bearer|private[_-]?key|access[_-]?key)["']?\s*[:=]\s*["']?|Bearer\s+)([^\s"',;]{12,})/gi

/** A long random-looking word (letters and digits mixed): a key on its own line. */
const RANDOM_LINE = /^\s*([A-Za-z0-9_\-+/=]{32,})\s*$/gm
const looksRandom = (s: string) => /[0-9]/.test(s) && /[a-z]/.test(s) && (/[A-Z]/.test(s) || /^[0-9a-f]+$/.test(s)) && !/^[a-z-]+$/.test(s)

export function maskSecrets(text: string): string {
  if (!text) return text
  let t = text
  for (const p of PATTERNS) t = t.replace(p, HIDDEN)
  t = t.replace(ASSIGN, (_m, k: string, v: string) => (v === HIDDEN || v.startsWith('[key') ? k + v : k + HIDDEN))
  t = t.replace(RANDOM_LINE, (m, v: string) => (looksRandom(v) ? m.replace(v, HIDDEN) : m))
  return t
}
