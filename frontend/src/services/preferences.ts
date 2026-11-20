import { accountId, restoreSession } from './session'

type Prefs = { layout?: Record<string, unknown>; frame?: 'planet' | 'star'; ephemeris_frame?: 'planet' | 'star'; frame_scope?: 'canvas' | 'all'; show_axes?: boolean; hotkeys?: Record<string, string> }
type ServerPrefs = { revision: number; preferences: Prefs; updated_at: number | null }
type Status = 'local' | 'syncing' | 'saved' | 'error' | 'conflict'
const KEYS = {
  layout: 'orbital-outlaws.hud-layout.v2',
  frame: 'orbital-outlaws.map-frame.v1',
  ephemerisFrame: 'orbital-outlaws.ephemeris-frame.v1',
  frameScope: 'orbital-outlaws.frame-scope.v1',
  axes: 'orbital-outlaws.show-axes.v1',
  hotkeys: 'orbital-outlaws.hotkeys.v1'
}
const ownerKey = 'orbital-outlaws.preferences-owner.v1'
let revision = 0
let activeId = ''
let ready = false
let installed = false
let applying = false
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
let generation = 0
let saving: Promise<void> | null = null

function notify(status: Status, detail = '') {
  window.dispatchEvent(new CustomEvent('orbital-cloud-sync', { detail: { status, detail } }))
}
function parseObject(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch { return undefined }
}
function snapshot(): Prefs {
  const prefs: Prefs = {}
  const layout = parseObject(localStorage.getItem(KEYS.layout))
  if (layout) prefs.layout = layout
  const frame = localStorage.getItem(KEYS.frame)
  if (frame === 'star' || frame === 'planet') prefs.frame = frame
  const ephemerisFrame = localStorage.getItem(KEYS.ephemerisFrame)
  if (ephemerisFrame === 'star' || ephemerisFrame === 'planet') prefs.ephemeris_frame = ephemerisFrame
  const scope = localStorage.getItem(KEYS.frameScope)
  if (scope === 'canvas' || scope === 'all') prefs.frame_scope = scope
  const axes = localStorage.getItem(KEYS.axes)
  if (axes !== null) prefs.show_axes = axes !== 'false'
  const hotkeys = parseObject(localStorage.getItem(KEYS.hotkeys))
  if (hotkeys) prefs.hotkeys = hotkeys as Record<string, string>
  return prefs
}
function clearLocal() {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key)
}
function applyRemote(prefs: Prefs) {
  applying = true
  try {
    clearLocal()
    if (prefs.layout) localStorage.setItem(KEYS.layout, JSON.stringify(prefs.layout))
    if (prefs.frame) localStorage.setItem(KEYS.frame, prefs.frame)
    if (prefs.ephemeris_frame) localStorage.setItem(KEYS.ephemerisFrame, prefs.ephemeris_frame)
    if (prefs.frame_scope) localStorage.setItem(KEYS.frameScope, prefs.frame_scope)
    if (typeof prefs.show_axes === 'boolean') localStorage.setItem(KEYS.axes, String(prefs.show_axes))
    if (prefs.hotkeys) localStorage.setItem(KEYS.hotkeys, JSON.stringify(prefs.hotkeys))
    window.dispatchEvent(new Event('orbital-preferences-applied'))
  } finally { applying = false }
}
function baseUrl() { return String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') }
async function request(method: string, body?: object): Promise<{response: Response; data: any}> {
  const response = await fetch(baseUrl() + '/auth/me/preferences', {
    method,
    headers: {
      Authorization: 'Bearer ' + restoreSession(),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store'
  })
  const data = await response.json().catch(() => ({}))
  return { response, data }
}
function changed() {
  if (applying || !ready || !activeId) return
  dirty = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void pushPreferences() }, 850)
}
export async function pushPreferences(): Promise<void> {
  if (!ready || !activeId || !restoreSession()) return
  if (saving) { await saving; if (dirty) return pushPreferences(); return }
  if (!dirty) return
  const id = activeId, gen = generation, document = snapshot()
  dirty = false
  notify('syncing')
  saving = (async () => {
    try {
      let { response, data } = await request('PUT', { revision, preferences: document })
      if (response.status === 409) {
        // A second device saved first. Rebase local edits against the latest revision;
        // the most recent deliberate local edit wins rather than silently failing.
        const latest = await request('GET')
        if (!latest.response.ok) throw new Error('Could not resolve preference conflict')
        if (id !== activeId || gen !== generation) return
        revision = latest.data.revision
        ;({ response, data } = await request('PUT', { revision, preferences: document }))
      }
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to save preferences')
      if (id !== activeId || gen !== generation) return
      revision = data.revision
      notify('saved')
    } catch (error) {
      if (id === activeId && gen === generation) {
        dirty = true
        notify('error', (error as Error).message)
      }
    }
  })()
  try { await saving } finally { saving = null }
}
export async function hydratePreferences(): Promise<void> {
  const gen = ++generation
  if (saveTimer) clearTimeout(saveTimer)
  ready = false
  dirty = false
  const id = accountId()
  if (!id || !restoreSession()) {
    activeId = ''
    revision = 0
    if (localStorage.getItem(ownerKey)) {
      clearLocal()
      localStorage.removeItem(ownerKey)
      window.dispatchEvent(new Event('orbital-preferences-applied'))
    }
    notify('local')
    return
  }
  notify('syncing')
  try {
    const { response, data } = await request('GET')
    if (!response.ok) throw new Error('Cannot retrieve cockpit preferences from the server')
    if (gen !== generation || id !== accountId()) return
    const storedOwner = localStorage.getItem(ownerKey)
    if (storedOwner && storedOwner !== id) clearLocal()
    activeId = id
    revision = (data as ServerPrefs).revision
    localStorage.setItem(ownerKey, id)
    if (revision > 0) {
      applyRemote((data as ServerPrefs).preferences)
    } else {
      // Existing local configuration is migrated once to a new account;
      // an account switching on the same browser never inherits another pilot's layout.
      dirty = Object.keys(snapshot()).length > 0
    }
    ready = true
    if (dirty) await pushPreferences()
    else notify('saved')
  } catch (error) {
    if (gen !== generation) return
    activeId = ''
    revision = 0
    ready = false
    notify('error', (error as Error).message)
  }
}
export function setupPreferenceSync(): void {
  if (installed) return
  installed = true
  window.addEventListener('orbital-preferences-changed', changed)
  window.addEventListener('orbital-auth', () => { void hydratePreferences() })
}
export function currentSyncStatus(): string {
  return ready && activeId ? 'Cloud sync enabled' : 'Local preferences'
}
