import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Quaternion, Vector3 } from 'three'

import { TRAIN_INTERVAL } from '@shared/balance'
import { SWIM_DEPTH, WELL_X, wellAt, wellCenterZ } from '@shared/world'

import { emoteFromAnim } from '../../bloxity/emotes'
import { remotePlayers } from '../../net/remotePlayers'
import { getQuality } from '../../store/quality'
import { BloxityAvatar } from '../PlayerAvatar'
import { swimLift, swimTilt } from '../playerPose'

/** How often the set of fully drawn players is reconsidered. */
const PICK_MS = 500
/** Top walking and swimming speeds: full stride amplitude, as for your own character. */
const MAX_SPEED = 10.875
const SWIM_SPEED = 8

const _up = new Vector3(0, 1, 0)
const _xAxis = new Vector3(1, 0, 0)
const _tilt = new Quaternion()
const _lift = { lift: 0, back: 0 }

/**
 * One other player as their real Bloxity avatar, dressed as they are and posed by the
 * same playerPose as yours, from what the network says they're doing: walking pace,
 * scooping at a well (facing it), swimming the crawl across a pit, jumping. Their bucket hangs from the hand
 * this tracks (RemotePlayers draws every bucket in one go).
 */
function RemoteAvatar({ sessionId, look }) {
  const groupRef = useRef(null)
  const handRef = useRef(null)
  const lastY = useRef(null)
  const motionRef = useRef({ time: 0, speed: 0, grounded: true, maxSpeed: MAX_SPEED, vy: 0, stride: 0, carry: 1, scoop: -1, swim: 0, stroke: 0 })

  useFrame((_state, rawDelta) => {
    const group = groupRef.current
    const r = remotePlayers.get(sessionId)
    if (!group || !r) return
    const delta = Math.min(rawDelta, 0.05)
    const m = motionRef.current
    m.time += delta

    const scooping = r.anim === 'scoop'
    const swimming = r.anim === 'swim'
    group.visible = true
    group.position.copy(r.position)
    // Scooping they face their well; swimming they lie down flat on the water.
    const well = scooping ? wellAt(r.position.x, r.position.z, 1) : -1
    const yaw = well >= 0 ? Math.atan2(WELL_X - r.position.x, wellCenterZ(well) - r.position.z) : r.yaw
    const ratio = Math.min(1, r.speed / SWIM_SPEED)
    const tilt = swimTilt(m.swim, ratio)
    swimLift(tilt, SWIM_DEPTH, _lift)
    group.quaternion.setFromAxisAngle(_up, yaw).multiply(_tilt.setFromAxisAngle(_xAxis, tilt))
    group.position.x -= Math.sin(yaw) * _lift.back
    group.position.y += _lift.lift
    group.position.z -= Math.cos(yaw) * _lift.back

    const speed = scooping ? 0 : r.speed
    m.speed = speed
    m.maxSpeed = swimming ? SWIM_SPEED : MAX_SPEED
    if (swimming) m.stroke += delta * (2.4 + 3.6 * ratio)
    m.grounded = r.anim !== 'jump'
    m.scoop = scooping ? (m.time / TRAIN_INTERVAL) % 1 : -1
    m.swim = swimming ? Math.min(1, m.swim + delta * 6) : Math.max(0, m.swim - delta * 6)
    // A Boxity emote they're playing (stood still while it lasts).
    m.emote = emoteFromAnim(r.anim)
    if (m.emote) m.speed = 0
    // Vertical speed from the interpolated height, smoothed: rising vs falling.
    const y = r.position.y
    if (lastY.current !== null) m.vy += ((y - lastY.current) / Math.max(delta, 1e-3) - m.vy) * 0.3
    lastY.current = y
    m.stride += delta * (5 + 6 * Math.min(1, speed / MAX_SPEED))

    // Where their hand was put last frame, in the world, for their bucket.
    const hand = handRef.current
    if (hand) {
      group.updateMatrixWorld()
      r.hand.copy(hand.position).applyMatrix4(group.matrixWorld)
      r.handSeen = performance.now()
    }
  })

  return (
    <group ref={groupRef}>
      <BloxityAvatar equipped={look?.equipped} proportions={look?.proportions} motionRef={motionRef} handRef={handRef} targetHeight={1.8} />
      <group ref={handRef} />
    </group>
  )
}

/**
 * The other players nearest the camera, as their real avatars - standing, walking or
 * training: as many as the quality preset allows (`remoteAvatars`), within
 * `remoteAvatarDistance` - on every preset, everyone in the room, near or far. Anyone
 * beyond those limits would be the cheap blocky figure RemotePlayers draws
 * (`r.fullAvatar` tells it who's covered).
 * Chosen twice a second, never per frame, so React only re-renders when the set of
 * players (or an outfit) actually changes.
 */
export function RemoteAvatars() {
  const camera = useThree((s) => s.camera)
  const [shown, setShown] = useState([])

  useEffect(() => {
    const pick = () => {
      const settings = getQuality()
      const near = []
      for (const r of remotePlayers.values()) {
        r.fullAvatar = false
        const d = camera.position.distanceTo(r.position)
        if (d < settings.remoteAvatarDistance) near.push([d, r])
      }
      near.sort((a, b) => a[0] - b[0])
      const next = near
        .slice(0, settings.remoteAvatars)
        .map(([, r]) => r)
        .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
      for (const r of next) r.fullAvatar = true
      setShown((prev) => {
        const same = prev.length === next.length && prev.every((p, i) => p.sessionId === next[i].sessionId && p.lookKey === next[i].lookKey)
        return same ? prev : next.map((r) => ({ sessionId: r.sessionId, look: r.look, lookKey: r.lookKey }))
      })
    }
    pick()
    const id = setInterval(pick, PICK_MS)
    return () => clearInterval(id)
  }, [camera])

  return shown.map((s) => (
    <Suspense key={`${s.sessionId}:${s.lookKey}`} fallback={null}>
      <RemoteAvatar sessionId={s.sessionId} look={s.look} />
    </Suspense>
  ))
}

export default RemoteAvatars
