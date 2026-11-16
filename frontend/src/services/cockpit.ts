/** Typed interface between the legacy simulator and Vue Options API cockpit. */
export const COCKPIT_STATE_EVENT = 'orbital-cockpit-state'
export const MARKET_PURCHASE_EVENT = 'orbital-market-purchase'

export type TechnologyKey = 'predictive' | 'trajectory' | 'ephemeris' | 'nav' | 'capture'

export interface ShipView {
  hp: number
  fuel: number
  fuelMax: number
  repairParts: number
  repairCapacity: number
  ammo: number
  credits: number
  captureHeatMJ: number
  captureCapacityMJ: number
  cargoKg: number
  captureTensionN: number
  captureStatus: string
  deltaV: number
  status: string
  statusColor: string
  repairDisabled: boolean
  repairing: boolean
}

export interface MarketView {
  credits: number
  ended: boolean
  owned: Record<TechnologyKey, boolean>
}

export interface CockpitState {
  ship: ShipView
  market: MarketView
}
