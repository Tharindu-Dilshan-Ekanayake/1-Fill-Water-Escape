import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'

import { actions } from '../net/actions'
import { getGame } from '../store/game'
import { tapPit } from './course/pits'
import { runtime } from './runtime'

/** A press counts as a tap if it lets go this soon, this close to where it started. */
const TAP_MS = 350
const TAP_PX = 12

/**
 * Tapping (or clicking) the 3D view gives Water: each tap is a bucketful, sent to the
 * authority (which limits how many count, balance.CLICK_RATE) and flicks your bucket;
 * pouring at a pit's rim, it pours faster too (balance.POUR_TAP).
 * A press that drags is turning the camera instead, and the HUD's buttons and the
 * joystick sit over the canvas, so pressing them is never a tap.
 */
export function TapToScoop() {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    const el = gl.domElement
    /** pointerId -> where and when it went down */
    const downs = new Map()
    const onDown = (e) => {
      if (e.button === 0) downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() })
    }
    const onUp = (e) => {
      const down = downs.get(e.pointerId)
      downs.delete(e.pointerId)
      if (!down) return
      const now = performance.now()
      if (now - down.t > TAP_MS || Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_PX) return
      if (runtime.player.frozen) return
      runtime.player.tappedAt = now
      actions.click()
      // At a pit's rim, a tap pours faster too.
      tapPit(getGame().profile)
    }
    const onCancel = (e) => downs.delete(e.pointerId)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
    }
  }, [gl])

  return null
}

export default TapToScoop
