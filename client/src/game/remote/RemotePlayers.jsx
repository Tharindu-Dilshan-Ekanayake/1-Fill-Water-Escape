import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Matrix4, Quaternion, Vector3 } from 'three'

import { TRAIN_INTERVAL } from '@shared/balance'
import { SWIM_DEPTH, WELL_X, wellAt, wellCenterZ } from '@shared/world'

import { remotePlayers } from '../../net/remotePlayers'
import { getQuality } from '../../store/quality'
import { createBoxInstances, disposeBlocks } from '../blocks'
import { BUCKET_GRIP, bucketMatrix, createBucketMesh, disposeBucketMesh } from '../bucket'
import { sharedMaterials, STYLE } from '../materials'
import { BUCKET_SIZE } from '../Player'
import { swimLift, swimTilt } from '../playerPose'
import { runtime } from '../runtime'
import { hideNameplatesFrom, NAMEPLATE_POOL_SIZE, placeNameplate } from './nameplates'

/** Remote players are drawn this far in the past, so 10 Hz updates interpolate. */
const INTERP_DELAY_MS = 110
const MAX_REMOTES = 8
const PARTS = 6
const S = 0.36
/** Swimming speed, for how flat a swimmer lies. */
const SWIM_SPEED = 8
const _tilt = new Quaternion()
const _tilt2 = new Quaternion()
const _xAxis = new Vector3(1, 0, 0)
const _lift = { lift: 0, back: 0 }
/** A real avatar's hand counts as current for this long (ms) after it was last placed. */
const HAND_FRESH = 250

/** Classic blocky figure, in studs-scaled units: [x, y(pivot), size, hangs from pivot]. */
const PART_LAYOUT = [
  { key: 'head', pos: [0, 1.62, 0], size: [1.2 * S, 1 * S, 1 * S] },
  { key: 'torso', pos: [0, 1.08, 0], size: [2 * S, 2 * S, 1 * S] },
  { key: 'armL', pos: [-1.5 * S, 1.44, 0], size: [1 * S, 2 * S, 1 * S], swing: -1 },
  { key: 'armR', pos: [1.5 * S, 1.44, 0], size: [1 * S, 2 * S, 1 * S], swing: 1 },
  { key: 'legL', pos: [-0.5 * S, 0.72, 0], size: [1 * S, 2 * S, 1 * S], swing: 1 },
  { key: 'legR', pos: [0.5 * S, 0.72, 0], size: [1 * S, 2 * S, 1 * S], swing: -1 },
]

// Parsed once: setColorAt runs for every limb of every player, every frame.
const palette = (list) => list.map((c) => new Color(c))
const SHIRTS = palette(['#e8423a', '#2f7fe6', '#3ccf4e', '#9b4dff', '#ff9a1f', '#1d1f26', '#ffffff', '#ff5fa8'])
const PANTS = palette(['#2d3a5c', '#1d1f26', '#4a3a2a', '#3a3a46', '#2f5aa8'])
const SKINS = palette(['#f5cd47', '#e8b48a', '#c98a5a', '#8a5a3a', '#ffd9b3'])

function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const _m = new Matrix4()
const _base = new Matrix4()
const _local = new Matrix4()
const _rot = new Matrix4()
const _scale = new Matrix4()
const _q = new Quaternion()
const _s = new Vector3()
const _v = new Vector3()
const _up = new Vector3(0, 1, 0)
const _target = new Vector3()
const _dir = new Vector3()
const _prev = new Vector3()

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Interpolates a remote player to `renderTime`. */
function interpolate(r, renderTime) {
  const snaps = r.snaps
  if (snaps.length === 0) return
  let i = snaps.length - 1
  while (i > 0 && snaps[i - 1].t > renderTime) i -= 1
  const b = snaps[i]
  const a = snaps[Math.max(0, i - 1)]
  const span = b.t - a.t
  const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1
  _prev.copy(r.position)
  r.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
  r.yaw = lerpAngle(a.r, b.r, t)
  // Drop snapshots we've moved past, keeping one to interpolate from.
  while (snaps.length > 2 && snaps[1].t < renderTime) snaps.shift()
}

/**
 * Writes one blocky figure's six parts from `base` (its feet), limbs swung by `swing`
 * (and arms by `armSwing`, if given). Returns the next free instance.
 */
function writeFigure(body, instance, r, base, swing, armSwing) {
  const h = hashString(r.sessionId)
  const shirt = SHIRTS[h % SHIRTS.length]
  const pants = PANTS[(h >>> 8) % PANTS.length]
  const skin = SKINS[(h >>> 16) % SKINS.length]
  for (const part of PART_LAYOUT) {
    const hangs = part.swing !== undefined
    const isArm = part.key.startsWith('arm')
    const angle = hangs ? (isArm && armSwing !== null ? armSwing : swing * part.swing) : 0
    _local.makeTranslation(part.pos[0], part.pos[1], part.pos[2])
    _rot.makeRotationX(angle)
    _scale.makeScale(part.size[0], part.size[1], part.size[2])
    // Limbs hang from their pivot; head and torso are centred on theirs.
    if (hangs) _scale.setPosition(0, -part.size[1] / 2, 0)
    _m.copy(base).multiply(_local).multiply(_rot).multiply(_scale)
    body.setMatrixAt(instance, _m)
    // Classic look: shirt on the torso, trousers on the legs, bare arms and head.
    body.setColorAt(instance, part.key === 'torso' ? shirt : part.key.startsWith('leg') ? pants : skin)
    instance += 1
  }
  return instance
}

/** Puts a name tag over `at`, if it's on screen; returns the next free tag. */
function writeNameplate(plate, name, at, distance, maxDistance, camera, size, uid, tag) {
  if (plate >= NAMEPLATE_POOL_SIZE) return plate
  if (distance < maxDistance) {
    _v.copy(at).project(camera)
    if (_v.z < 1) {
      const fade = Math.min(1, (maxDistance - distance) / 6)
      placeNameplate(plate, name, (_v.x * 0.5 + 0.5) * size.width, (-_v.y * 0.5 + 0.5) * size.height, fade, uid, tag)
      return plate + 1
    }
  }
  placeNameplate(plate, '', null)
  return plate + 1
}

/**
 * Everyone else: blocky avatars (one InstancedMesh for every limb of every player),
 * every player's bucket (one more, real avatars included: it hangs from their hand),
 * name tags and their pets (handed to the shared pet renderer). Hidden past the
 * preset's draw distance.
 */
export function RemotePlayers() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const bodyRef = useRef(null)
  const bucketsRef = useRef(null)

  const assets = useMemo(() => {
    // Smooth toy boxes: the shared toy material, so no extra shader program.
    const body = createBoxInstances(MAX_REMOTES * PARTS, sharedMaterials().toy, STYLE.SMOOTH)
    body.castShadow = true
    // Everyone's bucket.
    const buckets = createBucketMesh(MAX_REMOTES)
    return { body, buckets }
  }, [])

  useEffect(
    () => () => {
      disposeBlocks(assets.body)
      disposeBucketMesh(assets.buckets)
      hideNameplatesFrom(0)
    },
    [assets],
  )

  useFrame((state, rawDelta) => {
    const body = bodyRef.current
    const buckets = bucketsRef.current
    if (!body || !buckets) return
    const delta = Math.min(rawDelta, 0.05)
    const settings = getQuality()
    const now = performance.now()
    const renderTime = now - INTERP_DELAY_MS
    const t = state.clock.elapsedTime

    let instance = 0
    let plate = 0
    let carried = 0
    runtime.remotePets.length = 0

    for (const r of remotePlayers.values()) {
      interpolate(r, renderTime)
      const moved = _prev.distanceTo(r.position)
      r.speed = r.speed * 0.8 + (moved / Math.max(delta, 1e-3)) * 0.2

      // --- In the lobby -----------------------------------------------------------
      const distance = camera.position.distanceTo(r.position)
      const visible = distance < settings.remoteDrawDistance
      r.shadow.visible = visible
      const scooping = r.anim === 'scoop'
      const swimming = r.anim === 'swim'
      // Scooping they face their well.
      const well = scooping ? wellAt(r.position.x, r.position.z, 1) : -1
      const yaw = well >= 0 ? Math.atan2(WELL_X - r.position.x, wellCenterZ(well) - r.position.z) : r.yaw
      _q.setFromAxisAngle(_up, yaw)

      // Players drawn as their real avatar (RemoteAvatars) skip the blocky figure, and
      // carry their bucket in the hand it tracks; the figure holds its own out in front.
      const fullHand = r.fullAvatar && now - r.handSeen < HAND_FRESH
      let rightArm = 0
      if (visible && !r.fullAvatar && instance + PARTS <= MAX_REMOTES * PARTS) {
        const walking = !scooping && r.speed > 0.6
        if (walking) r.walkPhase += delta * (swimming ? 4 : 6 + Math.min(r.speed, 10) * 0.5)
        const swing = walking ? Math.sin(r.walkPhase) * 0.9 : 0
        // Scooping: both arms dip down in front; swimming: they reach and pull.
        const dip = scooping ? Math.sin(((t / TRAIN_INTERVAL) % 1) * Math.PI) : 0
        const armSwing = scooping ? -0.4 - 0.8 * dip : swimming ? -2.4 + Math.sin(r.walkPhase) * 1.2 : null
        // Swimming, lying down flat on the water like everyone's real avatar does.
        const tilt = swimming ? swimTilt(1, Math.min(1, r.speed / SWIM_SPEED)) : 0
        swimLift(tilt, SWIM_DEPTH, _lift)
        _v.set(r.position.x - Math.sin(yaw) * _lift.back, r.position.y + (swimming ? _lift.lift : 0), r.position.z - Math.cos(yaw) * _lift.back)
        _base.compose(_v, _tilt.copy(_q).multiply(_tilt2.setFromAxisAngle(_xAxis, tilt)), _s.set(1, 1, 1))
        instance = writeFigure(body, instance, r, _base, swing, armSwing)
        rightArm = armSwing ?? swing
      }

      // Their bucket, hanging from the grip in their hand (out of sight while they swim).
      if (visible && !swimming && carried < MAX_REMOTES) {
        if (fullHand) _target.copy(r.hand)
        else {
          // The blocky figure's right hand: the bottom of its swung right arm.
          _target.set(1.5 * S, 1.44 - 2 * S * Math.cos(rightArm), -2 * S * Math.sin(rightArm)).applyQuaternion(_q).add(r.position)
        }
        _target.y -= BUCKET_GRIP.y * BUCKET_SIZE
        buckets.setMatrixAt(carried, bucketMatrix(_target, _q, BUCKET_SIZE, r.bucketId, _m))
        buckets.setStyle(carried, r.bucketId)
        carried += 1
      }

      // Name tag, just above the head (players are 1.8 tall).
      if (visible) {
        _v.set(r.position.x, r.position.y + 2.05, r.position.z)
        plate = writeNameplate(plate, r.name, _v, distance, settings.remoteNameDistance, camera, size, r.uid, r.tag)
      }

      // Their pets: follow in formation, drawn by the shared pet renderer.
      if (visible) {
        const sin = Math.sin(r.yaw)
        const cos = Math.cos(r.yaw)
        for (let i = 0; i < r.petIds.length && i < r.pets.length; i += 1) {
          const pet = r.pets[i]
          pet.id = r.petIds[i]
          const sx = i === 0 ? -1.5 : i === 1 ? 1.5 : 0
          const sz = i === 2 ? -2.5 : -1.3
          _target.set(r.position.x - cos * sx + sin * sz, r.position.y, r.position.z + sin * sx + cos * sz)
          _dir.copy(pet.position)
          pet.position.lerp(_target, 1 - Math.exp(-6 * delta))
          const stepped = _dir.distanceTo(pet.position)
          if (stepped > 0.005) pet.yaw = Math.atan2(pet.position.x - _dir.x, pet.position.z - _dir.z)
          pet.hop = Math.abs(Math.sin(t * 7 + i)) * (stepped > 0.01 ? 0.35 : 0.08)
          runtime.remotePets.push(pet)
        }
      }
    }
    hideNameplatesFrom(plate)
    body.count = instance
    body.instanceMatrix.needsUpdate = true
    if (body.instanceColor) body.instanceColor.needsUpdate = true
    buckets.count = carried
    buckets.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <primitive ref={bodyRef} object={assets.body} />
      <primitive ref={bucketsRef} object={assets.buckets} />
    </>
  )
}

export default RemotePlayers
