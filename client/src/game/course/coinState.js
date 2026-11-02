import { Vector3 } from 'three'

import { LAST_STAGE } from '@shared/balance'
import { formatNumber } from '@shared/format'
import { COINS_PER_LEDGE, coinsOf } from '@shared/world'

import { iconUrl } from '../../ui/icons'
import { spawnPopup } from '../fx/popups'

/**
 * The coins over the ledges, as this client sees them (Coins.jsx draws them): where
 * every one is, and which this run has picked up. Plain module state.
 */

/** Every ledge's coins, worked out once. */
export const SPOTS = Array.from({ length: LAST_STAGE + 1 }, (_, s) => (s > 0 ? coinsOf(s) : []))
const TROPHY_ICON = iconUrl('trophy')

/** This run's coins as this client has seen them go: stage * COINS_PER_LEDGE + index. */
export const taken = new Set()
export const keyOf = (stage, index) => stage * COINS_PER_LEDGE + index

const _popup = new Vector3()

/**
 * The authority paid for a coin (its 'coin' event): gone, if it wasn't already, and its
 * Wins pop up where it was.
 */
export function coinPaid(stage, index, wins) {
  taken.add(keyOf(stage, index))
  const spot = SPOTS[stage]?.[index]
  if (spot) spawnPopup(`+${formatNumber(wins)} Wins`, _popup.set(spot.x, 2.2, spot.z), { iconUrl: TROPHY_ICON })
}
