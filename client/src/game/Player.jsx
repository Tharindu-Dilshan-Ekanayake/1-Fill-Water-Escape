import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { DoubleSide, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3 } from 'three'

import { TRAIN_INTERVAL } from '@shared/balance'
import { isWellUnlocked } from '@shared/logic'
import { clampToWalkable, COURSE_START_Z, courseFloorAt, groundHeightAt, STATIC_COLLIDERS, SWIM_DEPTH, WELL_STAND, WELL_X, wellAt, wellCenterZ } from '@shared/world'

import { sfx } from '../audio/sfx'
import { getGame } from '../store/game'
import ErrorBoundary from '../ui/ErrorBoundary'
import { BUCKET_GRIP, BUCKET_HEIGHT, createBucketModel } from './bucket'
import { pits } from './course/pits'
import FallbackAvatar from './FallbackAvatar'
import { burst } from './fx/fxQueue'
import PlayerAvatar from './PlayerAvatar'
import { swimLift, swimTilt } from './playerPose'
import { runtime } from './runtime'
import useKeyboard from './useKeyboard'

export const PLAYER_HEIGHT = 1.8
const RADIUS = 0.45

const WALK_SPEED = 10.875
/** Swimming across a pit is a little slower than running. */
const SWIM_SPEED = 8
const ACCELERATION = 16
const GRAVITY = 32
const JUMP_SPEED = 10.5
/** Ledges up to this high are walked straight onto (stairs, climbing out of a pit). */
const STEP_UP = 1.05
/** Pouring, you face up the course into the pit. */
const POUR_YAW = Math.PI
/** How tall the bucket you carry is, in metres. */
export const BUCKET_SIZE = 0.62
/** How far the bucket tips over to pour (radians, forward about its X axis). */
const POUR_TILT = 1.95

/** A tap's quick flick of the bucket, in seconds. */
const FLICK = 0.28
/** Ripples spreading round a swimmer: how many at once, and how long each lasts. */
const RIPPLES = 2
const RIPPLE_LIFE = 1.1

// Scratch objects, reused each frame so the loop allocates nothing.
const _input = new Vector3()
const _move = new Vector3()
const _camForward = new Vector3()
const _camRight = new Vector3()
const _targetQuat = new Quaternion()
const _tiltQuat = new Quaternion()
const _lift = { lift: 0, back: 0 }
const _up = new Vector3(0, 1, 0)
const _xAxis = new Vector3(1, 0, 0)
const _clamped = { x: 0, z: 0 }
const _floor = { height: 0, swim: false }
/**
 * The bucket's lip, in the holder's frame (the grip at its origin): the rim on the side
 * that dips lowest as it tips forward, where the water spills out.
 */
const LIP = new Vector3(0, (BUCKET_HEIGHT - BUCKET_GRIP.y) * BUCKET_SIZE, 0.3 * BUCKET_SIZE)
/** Tipped out, the bucket is held out this far in front (and up), clear of your chest. */
const POUR_REACH = 0.5
const POUR_LIFT = 0.25

/** Pushes a circle out of an axis-aligned rect. Returns true on contact. */
function pushOut(pos, rect) {
  const cx = Math.min(rect.maxX, Math.max(rect.minX, pos.x))
  const cz = Math.min(rect.maxZ, Math.max(rect.minZ, pos.z))
  const dx = pos.x - cx
  const dz = pos.z - cz
  const d2 = dx * dx + dz * dz
  if (d2 >= RADIUS * RADIUS) return false

  if (d2 > 1e-8) {
    const d = Math.sqrt(d2)
    const push = (RADIUS - d) / d
    pos.x += dx * push
    pos.z += dz * push
    return true
  }

  // Centre inside the rect (spawned in, or a wall appeared on top of us): leave by the
  // nearest side.
  const left = pos.x - rect.minX
  const right = rect.maxX - pos.x
  const near = pos.z - rect.minZ
  const far = rect.maxZ - pos.z
  const m = Math.min(left, right, near, far)
  if (m === left) pos.x = rect.minX - RADIUS
  else if (m === right) pos.x = rect.maxX + RADIUS
  else if (m === near) pos.z = rect.minZ - RADIUS
  else pos.z = rect.maxZ + RADIUS
  return true
}

/**
 * The local player: a kinematic character controller.
 *
 * No physics engine: the world is flat ground, raised floors (the wells, the shop, the
 * course's ledges and stairs) and a list of rectangular walls, which a circle-vs-rect
 * push-out handles exactly. That saves the ~2 MB Rapier WASM download and keeps the
 * active rigid body count at zero.
 *
 * You always carry your bucket, in your right hand. At a well you step up to its edge
 * and scoop with it; at a pit's rim you tip it out (course/pits.js decides when, and
 * Course.jsx draws the stream from its lip); in a filled pit you swim the crawl, lying
 * flat on the water. Tapping the screen flicks it (a tap's Water: TapToScoop.jsx).
 *
 * Reads and writes `runtime.player`; never touches React state per frame.
 *
 * @param {{ onAvatarReady?: () => void }} props
 */
export function Player({ onAvatarReady }) {
  const groupRef = useRef(null)
  const visualRef = useRef(null)
  /** Moved onto the avatar's right palm every frame (PlayerAvatar / FallbackAvatar). */
  const handRef = useRef(null)
  const holderRef = useRef(null)
  const keys = useKeyboard()
  const velocity = useRef(new Vector3())
  const vy = useRef(0)
  /** Eased 0-1: how far into pouring, and into swimming. */
  const pour = useRef(0)
  const swim = useRef(0)
  const wasSwimming = useRef(false)
  /** How far through the current scoop. */
  const scoopAt = useRef(0)
  /** Eased 0-1: stepping up to a well's edge to scoop. */
  const atWell = useRef(0)
  /** The crawl's half-strokes so far, for a splash at each hand's entry. */
  const strokes = useRef(0)
  /** Your facing, eased; the swimming tilt goes on top of it. */
  const yawQuat = useRef(new Quaternion())
  /** The ripple meshes as mounted, to move each frame. */
  const rippleRefs = useRef([])
  const bucket = useMemo(() => createBucketModel(), [])
  /** Rings spreading on the water round you while you swim. */
  const ripples = useMemo(() => {
    const geometry = new RingGeometry(0.55, 0.8, 28)
    geometry.rotateX(-Math.PI / 2)
    return Array.from({ length: RIPPLES }, () => {
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }))
      mesh.visible = false
      mesh.renderOrder = 3
      return mesh
    })
  }, [])

  /** Handed to the avatar so it can pose itself. A ref: written every frame. */
  const motionRef = useRef({
    time: 0,
    speed: 0,
    grounded: true,
    maxSpeed: WALK_SPEED,
    vy: 0,
    stride: 0,
    carry: 1,
    scoop: -1,
    pour: 0,
    swim: 0,
    stroke: 0,
    flick: 0,
  })

  // The blob shadow follows the character.
  const shownAt = useMemo(() => new Vector3().copy(runtime.player.position), [])
  useEffect(() => {
    const caster = { position: shownAt, size: 1.1 }
    runtime.shadowCasters.add(caster)
    return () => runtime.shadowCasters.delete(caster)
  }, [shownAt])

  useEffect(() => () => bucket.dispose(), [bucket])
  useEffect(
    () => () => {
      ripples[0].geometry.dispose()
      for (const ring of ripples) ring.material.dispose()
    },
    [ripples],
  )

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const player = runtime.player
    const pos = player.position
    const k = keys.current
    const joy = runtime.input
    const motion = motionRef.current
    const profile = getGame().profile
    motion.time += delta

    const group = groupRef.current
    const visual = visualRef.current

    // --- Input, relative to the camera ----------------------------------------
    _input.set(0, 0, 0)
    if (!player.frozen) {
      _input.set(
        (k.right ? 1 : 0) - (k.left ? 1 : 0) + joy.joyX,
        0,
        (k.backward ? 1 : 0) - (k.forward ? 1 : 0) - joy.joyY,
      )
    }
    const inputLength = Math.min(1, _input.length())
    const swimming = wasSwimming.current
    const topSpeed = swimming ? SWIM_SPEED : WALK_SPEED

    if (inputLength > 0.02) {
      _input.normalize()
      // Flatten the camera's forward onto the ground plane so "up" always means
      // "away from the camera".
      state.camera.getWorldDirection(_camForward)
      _camForward.y = 0
      _camForward.normalize()
      _camRight.crossVectors(_camForward, _up).normalize()
      _move
        .set(0, 0, 0)
        .addScaledVector(_camForward, -_input.z)
        .addScaledVector(_camRight, _input.x)
        .normalize()
        .multiplyScalar(topSpeed * inputLength)
    } else {
      _move.set(0, 0, 0)
    }

    // Ease towards the target velocity: crisp, but no instant 0->max snaps.
    const blend = 1 - Math.exp(-(swimming ? ACCELERATION * 0.5 : ACCELERATION) * delta)
    velocity.current.lerp(_move, blend)

    // --- Horizontal move + collision --------------------------------------------
    const prevX = pos.x
    const prevZ = pos.z
    pos.x += velocity.current.x * delta
    pos.z += velocity.current.z * delta

    for (const rect of STATIC_COLLIDERS) pushOut(pos, rect)
    for (const rect of runtime.dynamicColliders) pushOut(pos, rect)
    if (runtime.pitWall) pushOut(pos, runtime.pitWall)
    clampToWalkable(pos.x, pos.z, _clamped)
    pos.x = _clamped.x
    pos.z = _clamped.z

    // A ledge too tall to step onto acts as a wall. Out on the course, only the pits
    // you've filled this run hold water to swim in.
    let floor = groundHeightAt(pos.x, pos.z, pits.open)
    if (floor - pos.y > STEP_UP) {
      pos.x = prevX
      pos.z = prevZ
      floor = groundHeightAt(pos.x, pos.z, pits.open)
    }
    const inWater = pos.z < COURSE_START_Z && courseFloorAt(pos.z, pits.open, _floor).swim

    // --- Vertical ---------------------------------------------------------------
    const wantJump = !player.frozen && (k.jump || joy.jump)
    if (wantJump && player.grounded && !inWater) {
      vy.current = JUMP_SPEED
      player.grounded = false
      sfx.jump()
    }
    vy.current -= GRAVITY * delta
    pos.y += vy.current * delta

    if (pos.y <= floor) {
      // Coming down from a jump (not just stepping off a kerb) lands with a thump.
      if (!player.grounded && vy.current < -5 && !inWater) sfx.jumpLand()
      pos.y = floor
      vy.current = 0
      player.grounded = true
    } else if (pos.y - floor > 0.05) {
      // Walked off a ledge, or still rising from a jump.
      player.grounded = false
    }

    // --- Into the water, and swimming -------------------------------------------
    const nowSwimming = inWater && pos.y - floor < 0.3
    if (nowSwimming && !wasSwimming.current) {
      sfx.splash()
      burst({ x: pos.x, y: floor + 0.95, z: pos.z, count: 22, speed: 6, palette: 'water' })
    }
    wasSwimming.current = nowSwimming
    swim.current = nowSwimming ? Math.min(1, swim.current + delta * 6) : Math.max(0, swim.current - delta * 6)

    // --- What you're doing with your bucket --------------------------------------
    const speed = Math.hypot(velocity.current.x, velocity.current.z)
    const well = wellAt(pos.x, pos.z)
    const scooping = well >= 0 && player.grounded && speed < 0.5 && !player.frozen && isWellUnlocked(profile, well)
    atWell.current = scooping ? Math.min(1, atWell.current + delta * 4) : Math.max(0, atWell.current - delta * 6)
    const pouring = Boolean(player.pourAt) && !nowSwimming
    pour.current = pouring ? Math.min(1, pour.current + delta * 5) : Math.max(0, pour.current - delta * 4)
    if (scooping) {
      const before = scoopAt.current
      scoopAt.current = (scoopAt.current + delta / TRAIN_INTERVAL) % 1
      // The bucket hits the water in the well at the bottom of each dip.
      if (before < 0.4 && scoopAt.current >= 0.4) {
        sfx.scoop()
        burst({ x: WELL_X, y: pos.y + 0.75, z: wellCenterZ(well), count: 6, speed: 3.5, palette: 'water' })
      }
    } else {
      scoopAt.current = 0
    }
    const swimRatio = Math.min(1, speed / SWIM_SPEED)
    if (nowSwimming) {
      // The crawl: a splash where each hand goes in, and a stroke's wash of sound.
      motion.stroke += delta * (2.4 + 3.6 * swimRatio)
      const half = Math.floor(motion.stroke / Math.PI)
      if (half !== strokes.current && swimRatio > 0.3) {
        strokes.current = half
        const side = half % 2 ? 0.35 : -0.35
        const fx = Math.sin(player.yaw)
        const fz = Math.cos(player.yaw)
        burst({ x: pos.x + fx * 1.3 + fz * side, y: 0.05, z: pos.z + fz * 1.3 - fx * side, count: 4, speed: 3, palette: 'water' })
        sfx.swim()
      }
    }

    // --- Facing -----------------------------------------------------------------
    // At a well you turn to face it; tipping the bucket out, up the course.
    const wellZ = well >= 0 ? wellCenterZ(well) : 0
    if (scooping) player.yaw = Math.atan2(WELL_X - pos.x, wellZ - pos.z)
    else if (pouring && speed < 2) player.yaw = POUR_YAW
    else if (speed > 0.3) player.yaw = Math.atan2(velocity.current.x, velocity.current.z)
    if (visual) {
      _targetQuat.setFromAxisAngle(_up, player.yaw)
      yawQuat.current.slerp(_targetQuat, 1 - Math.pow(0.0005, delta))
      // Swimming, the body lies down flat on the water, its hips just under the surface.
      const tilt = swimTilt(swim.current, swimRatio)
      swimLift(tilt, SWIM_DEPTH, _lift)
      visual.quaternion.copy(yawQuat.current).multiply(_tiltQuat.setFromAxisAngle(_xAxis, tilt))
      const fx = Math.sin(player.yaw)
      const fz = Math.cos(player.yaw)
      visual.position.set(-fx * _lift.back, _lift.lift + Math.sin(motion.time * 3) * 0.04 * swim.current, -fz * _lift.back)
      // Scooping, you step up to the well's edge.
      if (atWell.current > 0 && well >= 0) {
        const dx = pos.x - WELL_X
        const dz = pos.z - wellZ
        const d = Math.max(1e-3, Math.hypot(dx, dz))
        const k = (WELL_STAND - d) * atWell.current
        visual.position.x += (dx / d) * k
        visual.position.z += (dz / d) * k
      }
    }
    if (group) {
      // Step-ups ease in over a few frames on the visual only; the logical position
      // snaps so collision and triggers stay exact.
      const steppingUp = player.grounded && pos.y > group.position.y
      const visualY = steppingUp ? group.position.y + (pos.y - group.position.y) * Math.min(1, delta * 18) : pos.y
      group.position.set(pos.x, visualY, pos.z)
    }
    shownAt.copy(pos)

    // --- Ripples spreading round you on the water --------------------------------
    for (let i = 0; i < RIPPLES; i += 1) {
      const ring = rippleRefs.current[i]
      if (!ring) continue
      ring.visible = swim.current > 0.5
      if (!ring.visible) continue
      const age = ((motion.time + (i * RIPPLE_LIFE) / RIPPLES) % RIPPLE_LIFE) / RIPPLE_LIFE
      ring.position.set(0, SWIM_DEPTH - 0.03, 0)
      ring.scale.setScalar(1 + age * (2.2 + swimRatio))
      ring.material.opacity = 0.55 * (1 - age)
    }

    // --- The bucket, hanging from your hand (or tipped out over a pit) ----------
    const holder = holderRef.current
    const hand = handRef.current
    if (holder && hand) {
      // Swimming, it's out of sight under the water.
      holder.visible = swim.current < 0.3
      bucket.setBucket(profile.equippedBucket)
      // Brimming once you've scooped some, emptying as you pour.
      bucket.setWater(profile.water > 0 ? 1 - pour.current * 0.85 : 0.15)
      holder.position.copy(hand.position)
      holder.position.z += POUR_REACH * pour.current
      holder.position.y += POUR_LIFT * pour.current
      const sway = Math.sin(motion.stride) * 0.12 * Math.min(1, speed / WALK_SPEED) * (1 - pour.current)
      holder.quaternion.setFromAxisAngle(_xAxis, pour.current * POUR_TILT + sway)
      holder.updateMatrixWorld()
      holder.localToWorld(player.bucketLip.copy(LIP))
    }

    // --- Publish motion ---------------------------------------------------------
    player.speed = speed
    player.anim = !player.grounded && !nowSwimming ? 'jump' : nowSwimming ? 'swim' : scooping ? 'scoop' : speed > 0.5 ? 'walk' : 'idle'

    const shownSpeed = scooping ? 0 : speed
    motion.speed = shownSpeed
    motion.maxSpeed = topSpeed
    motion.grounded = player.grounded || nowSwimming
    motion.vy = vy.current
    motion.scoop = scooping ? scoopAt.current : -1
    motion.pour = pour.current
    motion.swim = swim.current
    // A tap's flick of the bucket, eased in and out.
    const sinceTap = (performance.now() - player.tappedAt) / 1000
    motion.flick = sinceTap >= 0 && sinceTap < FLICK ? Math.sin((sinceTap / FLICK) * Math.PI) : 0
    // Steps quicken with speed: the stride phase runs faster rather than jumping.
    motion.stride += delta * (5 + 6 * Math.min(1, shownSpeed / topSpeed))
  })

  return (
    <group ref={groupRef}>
      <group ref={visualRef}>
        <ErrorBoundary fallback={<FallbackAvatar motionRef={motionRef} handRef={handRef} onReady={onAvatarReady} />}>
          <Suspense fallback={<FallbackAvatar motionRef={motionRef} handRef={handRef} />}>
            <PlayerAvatar onReady={onAvatarReady} targetHeight={PLAYER_HEIGHT} motionRef={motionRef} handRef={handRef} />
          </Suspense>
        </ErrorBoundary>
        <group ref={handRef} />
        <group ref={holderRef}>
          <primitive object={bucket} position={[0, -BUCKET_GRIP.y * BUCKET_SIZE, 0]} scale={BUCKET_SIZE} />
        </group>
      </group>
      {ripples.map((ring, i) => (
        <primitive
          key={ring.uuid}
          ref={(el) => {
            rippleRefs.current[i] = el
          }}
          object={ring}
        />
      ))}
    </group>
  )
}

export default Player
