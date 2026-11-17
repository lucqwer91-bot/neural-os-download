import { describe, it, expect } from 'vitest'
import { isSecretName, maskSecrets } from '../../src/main/library/secrets'

describe('keys never enter NEURAL OS', () => {
  it('skips files named like secrets, but not code or ordinary notes', () => {
    for (const n of ['elevenlabs_key.txt', 'api-key.json', 'API Keys.txt', '.env', '.env.local', 'id_ed25519', 'server.pem', 'credentials.json', 'secrets.yaml', 'tokens.txt', 'Passwörter.txt', 'passwords.csv', 'keys.txt', 'my.key'])
      expect([n, isSecretName(n)]).toEqual([n, true])
    for (const n of ['TokenService.lua', 'SecretRoom.luau', 'Keyframes.md', 'keyboard.txt', 'Monkey.png', 'Token Shop Idee.md', 'README.md', 'notes.txt', 'turkey.json'])
      expect([n, isSecretName(n)]).toEqual([n, false])
  })
  it('masks keys inside texts it shows or hands to Claude', () => {
    const t = [
      'ElevenLabs: sk_3f9a2b7c1d4e5f60718293a4b5c6d7e8f9012345',
      'OPENAI_API_KEY=sk-proj-abcDEF1234567890abcdef1234',
      'token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234"',
      'password = hunter2hunter2!',
      'a8F3kL9qP2xZ7mN4vB6cR1tY5uW0sE3dG8hJ',
      'Ganz normaler Satz über Tokens im Spiel.',
      'https://github.com/lucqwer91-bot/neural-os-download'
    ].join('\n')
    const m = maskSecrets(t)
    expect(m).not.toMatch(/sk_3f9a|sk-proj|ghp_|hunter2|a8F3kL9/)
    expect(m).toContain('OPENAI_API_KEY=')
    expect(m).toContain('Ganz normaler Satz über Tokens im Spiel.')
    expect(m).toContain('https://github.com/lucqwer91-bot/neural-os-download')
    expect(maskSecrets('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----')).toBe('[key hidden by NEURAL OS]')
  })
})
