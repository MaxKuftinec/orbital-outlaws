/** Reactive instruments emitted by the simulation, not a DOM polling layer. */
export const TELEMETRY_EVENT = 'orbital-telemetry-state'
export const TARGETING_EVENT = 'orbital-targeting-state'
export const NAVIGATION_EVENT = 'orbital-navigation-state'
export const NAV_OPTIONS_EVENT = 'orbital-navigation-options'
export interface TelemetryView {
  altitude: string; speed: string; periapsis: string; apoapsis: string
  period: string; predicted: string; reserve: string; flight: string
}
export interface TargetingView {
  status: string; name: string; range: string; hull: string
  shotTime: string; shotMiss: string
}
export interface NavOption { key: string; text: string }
export interface NavigationView {
  locked: boolean; phase: string; deltaV: string; eta: string
  fuel: string; status: string; quick: string; metrics: string
  engageText: string; engageDisabled: boolean; abortDisabled: boolean
  selected: string; reserveKg: number
}
