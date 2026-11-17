import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

// Smoke test: the built app starts, shows one window with the brain canvas and the dock,
// the sandboxed preload bridge is there, and no renderer errors occur on start.
test('app window starts and renders the brain', async () => {
  // Windows CI runners are slow at times: start, two reloads and an import can pass 60 s
  test.setTimeout(150_000)
  const data = mkdtempSync(join(tmpdir(), 'nos-e2e-'))
  const app = await electron.launch({
    env: { ...process.env, NEURAL_OS_USER_DATA: data } as Record<string, string>,
    // CI windows can count as hidden/occluded; without these Chromium pauses animation frames and clicks never settle
    args: [join(__dirname, '../../out/main/index.js'), '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]
  })
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  win.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[renderer]', m.type(), m.text()) })
  app.process().stderr?.on('data', (d) => console.log('[main]', String(d).trim()))
  // on a timeout, print what the window shows (CI artifacts cannot always be downloaded)
  const dump = async (label: string) => {
    const info = await win.evaluate(() => ({
      ready: document.readyState, dock: document.querySelectorAll('#dock button').length,
      body: document.body.className, hidden: document.hidden, modal: !!document.querySelector('#modal:not([hidden])'),
      dockBox: JSON.stringify(document.getElementById('dock')?.getBoundingClientRect()), dockStyle: getComputedStyle(document.getElementById('dock')!).cssText.slice(0, 0) + getComputedStyle(document.getElementById('dock')!).visibility + '/' + getComputedStyle(document.getElementById('dock')!).display + '/' + getComputedStyle(document.getElementById('dock')!).opacity
    })).catch((e) => ({ error: String(e) }))
    const main = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { url: w?.webContents.getURL(), loading: w?.webContents.isLoading(), visible: w?.isVisible(), bounds: w?.getBounds() } }).catch((e) => ({ error: String(e) }))
    console.log('[dump]', label, JSON.stringify(info), JSON.stringify(main), JSON.stringify(errors))
  }
  // clicks are dispatched directly: on CI desktops the real mouse can hover the dock and keep it animating

  // attached, not visible: on slow CI runners the canvas can have no size yet for a moment
  await win.waitForSelector('#scene', { state: 'attached', timeout: 60000 }).catch(async (e) => { await dump('scene'); throw e })
  expect(await win.title()).toBe('NEURAL OS')
  await expect(win.locator('#dock button[data-m]').first()).toBeVisible()

  const bridge = await win.evaluate(() => {
    const n = (window as unknown as { neuralOS?: { platform: string } }).neuralOS
    return n ? n.platform : null
  })
  expect(bridge).toBe(process.platform)

  // node integration stays off in the renderer
  expect(await win.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')

  // a module window opens from the dock and closes again (skip the first-launch welcome for this)
  await win.evaluate(() => localStorage.setItem('nos-welcomed', '1'))
  await win.reload()
  await win.waitForSelector('#dock button[data-m="settings"]')
  await win.locator('#dock button[data-m="settings"]').dispatchEvent('click')
  await expect(win.locator('.ov[data-m="settings"]')).toBeVisible()
  await win.locator('.ov[data-m="settings"] [data-c="close"]').dispatchEvent('click')
  await expect(win.locator('.ov[data-m="settings"]')).toHaveCount(0)

  await win.waitForTimeout(1500)
  expect(errors).toEqual([])
  expect(app.windows().length).toBe(1)

  // library: empty at first, a file imported through the bridge is copied and counted
  // outside the app data folder: files inside it are never imported
  const srcDir = mkdtempSync(join(tmpdir(), 'nos-e2e-src-'))
  const note = join(srcDir, 'Test.md')
  writeFileSync(note, '# Test')
  type Lib = { info: () => Promise<{ count: number }>; import: (p: string[]) => Promise<{ imported: unknown[] }> }
  expect(await win.evaluate(async () => (await (window as unknown as { neuralOS: { library: Lib } }).neuralOS.library.info()).count)).toBe(0)
  const r = await win.evaluate(async (p) => (window as unknown as { neuralOS: { library: Lib } }).neuralOS.library.import([p]), note)
  expect(r.imported).toHaveLength(1)
  expect(await win.evaluate(async () => (await (window as unknown as { neuralOS: { library: Lib } }).neuralOS.library.info()).count)).toBe(1)

  // the imported file shows up in Memory → Library, above the labeled demo data
  await win.reload()
  try { await win.waitForSelector('#dock button[data-m="memory"]', { timeout: 15000 }) } catch (e) { await dump('after second reload'); throw e }
  await win.locator('#dock button[data-m="memory"]').dispatchEvent('click')
  await win.locator('.ov[data-m="memory"] [data-x="mtab:lib"]').dispatchEvent('click')
  await expect(win.locator('.ov[data-m="memory"] .body')).toContainText('Test.md')

  await app.close()
  rmSync(data, { recursive: true, force: true })
  rmSync(srcDir, { recursive: true, force: true })
})
