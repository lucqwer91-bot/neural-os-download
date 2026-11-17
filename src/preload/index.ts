import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Narrow bridge to the main process. No Node access in the renderer.
contextBridge.exposeInMainWorld('neuralOS', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  library: {
    info: () => ipcRenderer.invoke('lib:info'),
    list: () => ipcRenderer.invoke('lib:list'),
    save: (id: string, text: string, base: string | null, force?: boolean) => ipcRenderer.invoke('lib:save', id, text, base, force === true),
    versions: (id: string) => ipcRenderer.invoke('lib:versions', id),
    version: (vid: string) => ipcRenderer.invoke('lib:version', vid),
    restore: (vid: string) => ipcRenderer.invoke('lib:restore', vid),
    create: (name: string, project?: string | null) => ipcRenderer.invoke('lib:create', name, project ?? null),
    setEditable: (folderId: string, on: boolean) => ipcRenderer.invoke('lib:setEditable', folderId, on),
    setExclude: (folderId: string, patterns: string) => ipcRenderer.invoke('lib:setExclude', folderId, patterns),
    rescan: (folderId: string) => ipcRenderer.invoke('lib:rescan', folderId),
    health: () => ipcRenderer.invoke('lib:health'),
    agents: () => ipcRenderer.invoke('lib:agents'),
    fresh: () => ipcRenderer.invoke('lib:fresh'),
    mentions: (id: string) => ipcRenderer.invoke('lib:mentions', id),
    linkMention: (fromId: string, targetId: string) => ipcRenderer.invoke('lib:linkMention', fromId, targetId),
    rename: (id: string, name: string) => ipcRenderer.invoke('lib:rename', id, name),
    tags: () => ipcRenderer.invoke('lib:tags'),
    base: (id: string) => ipcRenderer.invoke('lib:base', id),
    daily: (lang: string) => ipcRenderer.invoke('lib:daily', lang),
    templates: () => ipcRenderer.invoke('lib:templates'),
    templateText: (id: string, title: string, lang: string) => ipcRenderer.invoke('lib:templateText', id, title, lang),
    search: (q: string) => ipcRenderer.invoke('lib:search', q),
    links: () => ipcRenderer.invoke('lib:links'),
    folders: () => ipcRenderer.invoke('lib:folders'),
    link: (paths: string[]) => ipcRenderer.invoke('lib:link', paths),
    vaults: () => ipcRenderer.invoke('lib:vaults'),
    unlink: (id: string) => ipcRenderer.invoke('lib:unlink', id),
    // the library changed in the background (linked folder edited, e.g. by Claude)
    onChanged: (cb: () => void) => {
      const h = () => cb()
      ipcRenderer.on('lib:changed', h)
      return () => ipcRenderer.removeListener('lib:changed', h)
    },
    getAutoLink: () => ipcRenderer.invoke('lib:getAutoLink'),
    setAutoLink: (on: boolean) => ipcRenderer.invoke('lib:setAutoLink', on),
    plan: (paths: string[]) => ipcRenderer.invoke('lib:plan', paths),
    import: (paths: string[]) => ipcRenderer.invoke('lib:import', paths),
    remove: (id: string) => ipcRenderer.invoke('lib:remove', id),
    openFolder: () => ipcRenderer.invoke('lib:openFolder'),
    read: (id: string) => ipcRenderer.invoke('lib:read', id),
    pick: (folders: boolean) => ipcRenderer.invoke('lib:pick', folders),
    // dropped files: the sandbox hides File.path, webUtils gives the real path
    pathsFor: (files: File[]) => files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
    onProgress: (cb: (p: { done: number; total: number }) => void) => {
      const h = (_e: unknown, p: { done: number; total: number }) => cb(p)
      ipcRenderer.on('lib:progress', h)
      return () => ipcRenderer.removeListener('lib:progress', h)
    }
  },
  // shareable brains (.brain files)
  brains: {
    plan: (o: unknown) => ipcRenderer.invoke('brain:plan', o),
    export: (o: unknown) => ipcRenderer.invoke('brain:export', o),
    reveal: (p: string) => ipcRenderer.invoke('brain:reveal', p),
    import: () => ipcRenderer.invoke('brain:import'),
    list: () => ipcRenderer.invoke('brain:list'),
    data: (id: string) => ipcRenderer.invoke('brain:data', id),
    read: (id: string, fileId: string) => ipcRenderer.invoke('brain:read', id, fileId),
    visible: (id: string, on: boolean) => ipcRenderer.invoke('brain:visible', id, on),
    remove: (id: string) => ipcRenderer.invoke('brain:remove', id),
    copy: (id: string, ids: string[]) => ipcRenderer.invoke('brain:copy', id, ids),
    onProgress: (cb: (p: { done: number; total: number }) => void) => {
      const h = (_e: unknown, p: { done: number; total: number }) => cb(p)
      ipcRenderer.on('brain:progress', h)
      return () => ipcRenderer.removeListener('brain:progress', h)
    }
  },
  // device sync through the user's own cloud folder
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    pick: () => ipcRenderer.invoke('sync:pick'),
    set: (folder: string | null) => ipcRenderer.invoke('sync:set', folder),
    name: (name: string) => ipcRenderer.invoke('sync:name', name),
    now: () => ipcRenderer.invoke('sync:now'),
    open: () => ipcRenderer.invoke('sync:open'),
    onSynced: (cb: (p: unknown) => void) => {
      const h = (_e: unknown, p: unknown) => cb(p)
      ipcRenderer.on('mon:synced', h)
      return () => ipcRenderer.removeListener('mon:synced', h)
    }
  },
  monitor: {
    status: () => ipcRenderer.invoke('mon:status'),
    plan: (remove: boolean) => ipcRenderer.invoke('mon:plan', remove),
    apply: (remove: boolean) => ipcRenderer.invoke('mon:apply', remove),
    openBackups: () => ipcRenderer.invoke('mon:openBackups'),
    getNotes: () => ipcRenderer.invoke('mon:getNotes'),
    ctxStatus: () => ipcRenderer.invoke('ctx:status'),
    lessonProjects: () => ipcRenderer.invoke('les:projects'),
    lessons: (project?: string) => ipcRenderer.invoke('les:list', project),
    lessonUpdate: (id: string, ch: { status?: string; text?: string }) => ipcRenderer.invoke('les:update', id, ch),
    lessonAdd: (project: string, text: string) => ipcRenderer.invoke('les:add', project, text),
    lessonRemove: (id: string) => ipcRenderer.invoke('les:remove', id),
    ctxPlan: (remove: boolean) => ipcRenderer.invoke('ctx:plan', remove),
    ctxApply: (remove: boolean) => ipcRenderer.invoke('ctx:apply', remove),
    // the context server handed these notes to Claude (memory flash)
    onFlash: (cb: (p: unknown) => void) => {
      const h = (_e: unknown, p: unknown) => cb(p)
      ipcRenderer.on('mon:flash', h)
      return () => ipcRenderer.removeListener('mon:flash', h)
    },
    ruleStatus: () => ipcRenderer.invoke('rule:status'),
    guardrails: () => ipcRenderer.invoke('mon:guardrails'),
    mcpServers: () => ipcRenderer.invoke('mon:mcp'),
    apps: () => ipcRenderer.invoke('mon:apps'),
    overlaps: (hours?: number) => ipcRenderer.invoke('mon:overlaps', hours),
    recap: (since: string) => ipcRenderer.invoke('mon:recap', since),
    rulePlan: (remove: boolean) => ipcRenderer.invoke('rule:plan', remove),
    ruleApply: (remove: boolean) => ipcRenderer.invoke('rule:apply', remove),
    ruleReports: () => ipcRenderer.invoke('rule:reports'),
    setNotes: (on: boolean) => ipcRenderer.invoke('mon:setNotes', on),
    setLang: (l: string) => ipcRenderer.invoke('mon:setLang', l),
    sessions: () => ipcRenderer.invoke('mon:sessions'),
    events: (o?: { session?: string; limit?: number }) => ipcRenderer.invoke('mon:events', o ?? {}),
    changes: (o?: { session?: string; fileId?: string }) => ipcRenderer.invoke('mon:changes', o ?? {}),
    change: (id: string) => ipcRenderer.invoke('mon:change', id),
    mute: (id: string, on: boolean) => ipcRenderer.invoke('mon:mute', id, on),
    exclude: (id: string, on: boolean) => ipcRenderer.invoke('mon:exclude', id, on),
    // a live Claude Code event arrived
    onEvent: (cb: (e: unknown) => void) => {
      const h = (_e: unknown, p: unknown) => cb(p)
      ipcRenderer.on('mon:event', h)
      return () => ipcRenderer.removeListener('mon:event', h)
    }
  }
})
