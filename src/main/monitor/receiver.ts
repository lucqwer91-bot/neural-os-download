import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

// Local event receiver (spec 6.3). Listens on 127.0.0.1 only, on a free port.
// The hook forwarder finds port and secret in the endpoint file inside the app
// data folder; without the secret every request is rejected.

// the forwarder sends up to 1 MB of text before an edit; JSON escaping can grow it
export const MAX_BODY = 4 * 1024 * 1024

export interface Receiver { port: number; close: () => Promise<void> }

export function startReceiver(endpointFile: string, onPayload: (p: Record<string, unknown>) => void, onContext?: (p: Record<string, unknown>) => void): Promise<Receiver> {
  const token = randomBytes(24).toString('hex')
  const tokenBuf = Buffer.from(token)
  const okToken = (v: unknown) => {
    if (typeof v !== 'string') return false
    const b = Buffer.from(v)
    return b.length === tokenBuf.length && timingSafeEqual(b, tokenBuf)
  }
  const server: Server = createServer((req, res) => {
    const done = (code: number) => { res.writeHead(code); res.end() }
    const route = req.url === '/event' ? onPayload : req.url === '/context' && onContext ? onContext : null
    if (req.method !== 'POST' || !route) return done(404)
    // browsers send an Origin header; the forwarder never does
    if (req.headers.origin || !okToken(req.headers['x-neural-os'])) return done(403)
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { done(413); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (size > MAX_BODY) return
      let p: unknown
      try { p = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return done(400) }
      if (!p || typeof p !== 'object' || Array.isArray(p)) return done(400)
      done(204)
      try { route(p as Record<string, unknown>) } catch { /* a bad event never stops the receiver */ }
    })
    req.on('error', () => undefined)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      mkdirSync(dirname(endpointFile), { recursive: true })
      writeFileSync(endpointFile, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 })
      resolve({
        port,
        close: () => new Promise<void>((r) => {
          try { rmSync(endpointFile, { force: true }) } catch { /* ignore */ }
          server.close(() => r())
        })
      })
    })
  })
}
