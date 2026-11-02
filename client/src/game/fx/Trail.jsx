import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'

import { TRAILS } from '@shared/balance'

import { getGame } from '../../store/game'
import { useQuality } from '../../store/quality'
import { runtime } from '../runtime'
import { burst } from './fxQueue'

/** Seconds between puffs of your trail while you move. */
const EVERY = 0.09

/**
 * Your trail (a cosmetic, balance.TRAILS): a few sparkles at your feet as you go, in its
 * colours, through the shared particle pool - so it's off on graphics levels without
 * particles, like every other burst.
 */
export function Trail() {
  const enabled = useQuality((s) => s.settings.particles)
  const timer = useRef(0)
  useFrame((_state, delta) => {
    if (!enabled) return
    const trail = TRAILS[getGame().profile.cosmetics?.trail]
    if (!trail?.palette || runtime.player.speed < 2) return
    timer.current -= delta
    if (timer.current > 0) return
    timer.current = EVERY
    const p = runtime.player.position
    burst({ x: p.x, y: p.y + 0.3, z: p.z, count: 3, speed: 1.6, palette: trail.palette })
  })
  return null
}

export default Trail
