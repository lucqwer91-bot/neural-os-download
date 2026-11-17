import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../src/main/library/db'
import { addFolder, scanFolder } from '../../src/main/library/linked'
import { chainSegments, luauGraph, parseLuau, sideOf } from '../../src/main/library/luau'

describe('luau code graph', () => {
  it('reads chains, sides and references from code', () => {
    expect(chainSegments('ReplicatedStorage:WaitForChild("Remotes"):WaitForChild("Damage")')).toEqual(['ReplicatedStorage', 'Remotes', 'Damage'])
    expect(chainSegments('Remotes["Buy Item"]')).toEqual(['Remotes', 'Buy Item'])
    expect(sideOf('src/server/Combat.server.luau')).toBe('server')
    expect(sideOf('src/StarterPlayerScripts/Input.client.luau')).toBe('client')
    expect(sideOf('src/shared/Util.luau')).toBe('shared')
    const refs = parseLuau(`
local RS = game:GetService("ReplicatedStorage")
local Remotes = RS:WaitForChild("Remotes")
local Damage = Remotes:WaitForChild("Damage")
local Util = require(RS.Shared.Util)
local Signal = require("@pkg/Signal")
-- Remotes.Fake:FireServer() is a comment
Damage:FireServer(10)
Remotes.Buy.OnServerEvent:Connect(function() end)
function f(remote) remote:FireServer() end
local store = DSS:GetDataStore("Coins_v2")
img.Image = "rbxassetid://123456"
`)
    const k = (kind: string) => refs.filter((r) => r.kind === kind).map((r) => r.name + (r.role ? ':' + r.role : ''))
    expect(k('remote')).toEqual(['Damage:fire', 'Buy:handle'])
    expect(k('require')).toEqual(['Util', 'Signal'])
    expect(k('datastore')).toEqual(['Coins_v2'])
    expect(k('asset')).toEqual(['123456'])
    expect(refs.find((r) => r.name === 'Damage')!.line).toBe(8)
  })
  it('links requires, remotes and DataStores of one game and keeps the references', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nos-lu-')), v = join(dir, 'Game')
    await mkdir(join(v, 'src', 'server'), { recursive: true }); await mkdir(join(v, 'src', 'client'), { recursive: true }); await mkdir(join(v, 'src', 'shared', 'Combat'), { recursive: true })
    await writeFile(join(v, 'src', 'shared', 'Combat', 'init.luau'), 'return {}')
    await writeFile(join(v, 'src', 'shared', 'Util.luau'), 'return {}')
    await writeFile(join(v, 'src', 'server', 'Main.server.luau'), 'local C = require(game.ReplicatedStorage.Shared.Combat)\nlocal U = require(script.Parent.Parent.shared.Util)\nlocal R = game.ReplicatedStorage.Remotes\nR.Hit.OnServerEvent:Connect(print)\nlocal d = DSS:GetDataStore("Save")')
    await writeFile(join(v, 'src', 'server', 'Data.server.luau'), 'local d = DSS:GetDataStore("Save")')
    await writeFile(join(v, 'src', 'client', 'Input.client.luau'), 'local R = game.ReplicatedStorage:WaitForChild("Remotes")\nR.Hit:FireServer()\nR.Never:FireServer()')
    const db = openDb(join(dir, 'db.sqlite')); const f = addFolder(db, v); await scanFolder(db, f.id)
    const r = await luauGraph(db)
    expect(r.scripts).toBe(5)
    expect(r.byReason).toEqual({ require: 2, remote: 1, datastore: 1 })
    const again = await luauGraph(db)
    expect(again.links).toBe(r.links)
    const name = (id: string) => (db.prepare('SELECT name FROM file_asset WHERE id = ?').get(id) as { name: string }).name
    const e = db.prepare("SELECT from_id, to_id FROM knowledge_edge WHERE reason = 'remote'").all() as { from_id: string; to_id: string }[]
    expect(e.map((x) => name(x.from_id) + '→' + name(x.to_id))).toEqual(['Input.client.luau→Main.server.luau'])
    const never = db.prepare("SELECT role, side FROM luau_ref WHERE kind = 'remote' AND name = 'Never'").get() as { role: string; side: string }
    expect(never).toEqual({ role: 'fire', side: 'client' })
    db.close(); await rm(dir, { recursive: true, force: true })
  })
})

describe('game_context', () => {
  it('lists remotes with sides and missing handlers, modules and DataStores with file:line', async () => {
    const { gameContext } = await import('../../src/main/context/game')
    const dir = await mkdtemp(join(tmpdir(), 'nos-gc-')), v = join(dir, 'MyGame')
    await mkdir(join(v, 'src', 'server'), { recursive: true }); await mkdir(join(v, 'src', 'client'), { recursive: true })
    await writeFile(join(v, 'src', 'Util.luau'), 'return {}')
    await writeFile(join(v, 'src', 'server', 'Main.server.luau'), 'local U = require(script.Parent.Parent.Util)\nlocal R = game.ReplicatedStorage.Remotes\nR.Hit.OnServerEvent:Connect(print)\nDSS:GetDataStore("Save")')
    await writeFile(join(v, 'src', 'client', 'Input.client.luau'), 'local R = game.ReplicatedStorage.Remotes\nR.Hit:FireServer()\nR.Never:FireServer()')
    const db = openDb(join(dir, 'db.sqlite')); const f = addFolder(db, v); await scanFolder(db, f.id); await luauGraph(db)
    const r = gameContext(db as never, { game: 'mygame' })
    expect(r.text).toContain('- Hit: fired [client] in src/client/Input.client.luau:2; handled [server] in src/server/Main.server.luau:3')
    expect(r.text).toContain('- Never (no handler found in the code)')
    expect(r.text).toContain('- Util: required 1× → src/Util.luau')
    expect(r.text).toContain('"Save": src/server/Main.server.luau:4')
    expect(r.text).toContain('## House rules')
    expect(r.text).toContain('- server scripts mostly in: src/server (1)')
    expect(r.text).toContain('- client scripts mostly in: src/client (1)')
    expect(r.text).toContain('Main.server.luau:3: no argument check and no rate limit seen')
    expect(r.ids.length).toBe(3)
    expect(gameContext(db as never, { game: 'other' }).text).toBe('')
    const { whoUses } = await import('../../src/main/context/game')
    const w = whoUses(db as never, 'Util', { game: 'mygame' }).text
    expect(w).toContain('Module file: src/Util.luau')
    expect(w).toContain('## Required by (1)\n- src/server/Main.server.luau:1 [server]')
    const h = whoUses(db as never, 'Hit').text
    expect(h).toContain('## Fires the remote (1)\n- src/client/Input.client.luau:2 [client]')
    expect(h).toContain('## Handles the remote (1)\n- src/server/Main.server.luau:3 [server]')
    expect(whoUses(db as never, 'Nope').text).toBe('')
    expect(gameContext(db as never, { game: 'mygame', query: 'never' }).text).not.toContain('Hit')
    db.close(); await rm(dir, { recursive: true, force: true })
  })
})

describe('backup copies', () => {
  it('are not read as code', async () => {
    const { isBackupPath } = await import('../../src/main/library/luau')
    for (const p of ['_backups/audit3_pre/UI.luau', '_backups/ShopController_pre_audit1.luau', 'src/old/A.luau', 'backup_2026/A.lua', 'src/UI_backup.luau', 'tutorial_pre/GameConfig.luau', 'x/A.bak.luau'])
      expect(isBackupPath(p), p).toBe(true)
    for (const p of ['src/ReplicatedStorage/Shared/Net/Net.luau', 'src/Prestige.luau', 'src/presets/A.luau', 'anim/MutationAuras_v3.lua', 'src/OldManNPC.luau'])
      expect(isBackupPath(p), p).toBe(false)
  })
})

describe('network wrappers', () => {
  it('reads remotes sent through a Net module', () => {
    const r = parseLuau(`
Net.Handle(Remotes.PetEquip, { handler = function() end })
local push = Net.Push(Remotes.Notify)
local r = Net.Request(Remotes.PetEquip, uid)
Net.On(Remotes.Notify, function() end)
Net.Event("BuyPerk"):FireServer(id)
Net.Event("BuyPerk").OnServerEvent:Connect(function() end)
Players.PlayerAdded:Connect(onAdded)
signal:Fire(value)
`).filter((x) => x.kind === 'remote').map((x) => x.name + ':' + x.role)
    expect(r).toEqual(['BuyPerk:fire', 'BuyPerk:handle', 'PetEquip:handle', 'Notify:fire', 'PetEquip:fire', 'Notify:handle'])
  })
})

describe('server handler guards', () => {
  it('notes argument checks and rate limits after a handler', () => {
    const r = parseLuau(`
Net.Listen(Remotes.Throw, { rate = { 5, 1 }, args = { Net.T.vector3(1e5) }, handler = function() end })
Net.Handle(Remotes.Buy, { handler = function(p, id) return Shop.buy(p, id) end })
local R = game.ReplicatedStorage.Remotes
R.Give.OnServerEvent:Connect(function(p, n)
  if typeof(n) ~= "number" then return end
end)
Net.On(Remotes.Notify, function() end)
`).filter((x) => x.kind === 'guard').map((x) => x.name + ':' + x.role)
    expect(r).toEqual(['Give:args', 'Throw:args,rate', 'Buy:none'])
  })
})

describe('review fixes 2026-11-17', () => {
  it('ignores the networking module itself, follows local helpers, knows limiters and tool scripts', () => {
    const net = parseLuau(`
function Net.Handle(name, spec)
  local remote = getClientRemote(name)
  remote.OnServerInvoke = function(player, ...) end
  remote.OnServerEvent:Connect(function(player, ...) end)
end
function Net.Listen(name, spec) end
function Net.Send(name, ...) getClientRemote(name):FireServer(...) end
`)
    expect(net.filter((r) => r.kind === 'remote' || r.kind === 'guard')).toEqual([])
    const shop = parseLuau(`
local function request(remote, ...) return Net.Request(remote, ...) end
request(Remotes.BuyOven, 1)
Net.Listen(Remotes.Throw, { handler = function(p) if not limiter:Allow(p) then return end if typeof(x) ~= "number" then return end end })
`)
    expect(shop.filter((r) => r.kind === 'remote').map((r) => r.name + ':' + r.role)).toEqual(['BuyOven:fire', 'Throw:handle'])
    expect(shop.find((r) => r.kind === 'guard')!.role).toBe('args,rate')
    expect(sideOf('tools_local/build_treadmills_v7.luau')).toBe('tool')
    expect(sideOf('tests/Net.spec.luau')).toBe('tool')
  })
})
