/** Typed boundary between the legacy game engine and Vue-owned cockpit panels. */
export const COMMS_EVENT = 'orbital-comms'

export interface CommsEntry {
  t: number
  occurredAtUtc?: number | null
  message: string
  category: string
}

export interface CommsPayload {
  events: CommsEntry[]
}
