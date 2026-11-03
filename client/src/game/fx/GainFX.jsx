import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'

import { formatGain } from '@shared/format'

import { sfx } from '../../audio/sfx'
import { iconUrl } from '../../ui/icons'
import { runtime } from '../runtime'
import { burst, drainTrainFx } from './fxQueue'
import { spawnPopup, updatePopups } from './popups'

const _at = new Vector3()
const DROP_ICON = iconUrl('drop')
const LEVEL_GRADIENT = 'linear-gradient(180deg, #e0faff 0%, #7fe2ff 45%, #2fa8ff 100%)'

/** One gain's popup by your character: scooping in a well, or a tap. */
function showGain(event) {
  const at = runtime.player.position
  _at.set(at.x + (Math.random() - 0.5) * 3, at.y + 0.8 + Math.random() * 1.2, at.z + (Math.random() - 0.5) * 1.5)
  spawnPopup(`+${formatGain(event.gain)}`, _at, { iconUrl: DROP_ICON })
  sfx.gain()
  // A tap: a splash out of the bucket as it flicks up.
  if (event.source === 'click') {
    const lip = runtime.player.bucketLip
    burst({ x: lip.x, y: lip.y + 0.2, z: lip.z, count: 5, speed: 3.5, palette: 'water' })
  }
  if (event.leveledUp) {
    _at.set(at.x, at.y + 2.8, at.z)
    const text = event.maxed ? 'MAX LEVEL!' : event.levels > 1 ? `LEVEL UP! x${event.levels}` : 'LEVEL UP!'
    spawnPopup(text, _at, { gradient: LEVEL_GRADIENT, scale: 1.5, life: 1600 })
  }
}

/**
 * Water-gain feedback: a "+3" drop popup by your character for every gain - a scoop
 * in a well, or a tap - and LEVEL UP! when one lands. Also moves every live popup
 * each frame.
 */
export function GainFX() {
  const size = useThree((s) => s.size)

  useFrame((state) => {
    drainTrainFx(showGain)
    updatePopups(state.camera, size.width, size.height)
  })

  return null
}

export default GainFX
