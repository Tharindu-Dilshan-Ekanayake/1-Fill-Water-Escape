import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, Color, DoubleSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, RingGeometry, Vector3 } from 'three'

import { isMegaStage, ITEMS, LAST_STAGE, MEGA_CHESTS, MEGA_PRIZE, pitLength, STREAMS } from '@shared/balance'
import { formatNumber } from '@shared/format'
import { skipPrice } from '@shared/logic'
import {
  COURSE_END_Z,
  COURSE_HALF_WIDTH,
  COURSE_START_Z,
  pitFarZ,
  pitNearZ,
  skipPad,
  stageAtZ,
  START_ARCH,
  winsPad,
} from '@shared/world'

import { sfx } from '../../audio/sfx'
import { getGame } from '../../store/game'
import { getQuality, useQuality } from '../../store/quality'
import { disposeBlocks } from '../blocks'
import { burst } from '../fx/fxQueue'
import { spawnPopup } from '../fx/popups'
import { LabelBatch } from '../labels/LabelBatch'
import { TEXT } from '../labels/lobbyLabels'
import { sharedMaterials } from '../materials'
import { runtime } from '../runtime'
import { zones } from '../worldLook'
import Coins from './Coins'
import { buildChunk, chestAt, CHUNK_COUNT, CHUNK_STAGES, chunkOf, GATE_SIGN_Y, gateZ } from './build'
import { pits, resetPits, updatePits, waterY } from './pits'
import { SIGN_GRADIENT } from './palette'
import { createPoolMaterial, createStreamGeometry, createStreamMaterial, streamTint, WATER_GOLD, WATER_WHITE } from './water'

/**
 * The escape course: its chunks of stages streamed in around you, the water in every
 * pit near you rising and falling with your pours (pits.js), the stream from your
 * bucket while you pour, and the signs over its gates and pads.
 *
 * Lazy-loaded once the lobby is on screen (GameScene), and remounted with the world.
 */

/** Chunks kept built either side of yours, and the two always there (seen from the lobby). */
const AHEAD = 1
const PINNED = 1
const CACHE_LIMIT = 5
/** How often the chunk builder runs (between frames, not inside them). */
const BUILD_INTERVAL_MS = 60
/** Pools drawn at once: the pits around you. */
const MAX_POOLS = 10
/** Rings spreading on the water where your stream lands: how many, and each one's life. */
const POUR_RINGS = 3
const RING_LIFE = 0.9
/** Seconds between splashes where your stream lands. */
const SPLASH_EVERY = 0.18

const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()
const _dir = new Vector3()
const _color = new Color()
const _yAxis = new Vector3(0, 1, 0)
const _flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
const _labelAt = new Vector3()
/** Each pour colour (balance.STREAMS), made once: a Color, or 'rainbow'. */
const STREAM_COLORS = Object.fromEntries(Object.entries(STREAMS).map(([id, s]) => [id, s.color === 'rainbow' ? 'rainbow' : new Color(s.color)]))

/** The labels of chunk `index`: each gate's sign, each ledge's pads, the start and finish. */
function chunkLabels(index, profile) {
  const stages = zones()
  const first = index * CHUNK_STAGES
  const last = Math.min(LAST_STAGE, first + CHUNK_STAGES - 1)
  const out = []
  if (first === 0) {
    out.push({
      id: 'start',
      // Printed on the start arch's board (build.js).
      position: [0, 8.9, START_ARCH.z + 0.87],
      spec: { lines: [{ text: 'ESCAPE!', size: 84, gradient: SIGN_GRADIENT }, { text: 'Fill the pits with Water', size: 40, fill: '#ffffff' }], pxPerUnit: 34 },
      fade: 220,
      flat: true,
      fit: [13.4, 2.2],
    })
  }
  for (let s = Math.max(1, first); s <= last; s += 1) {
    const stage = stages[s]
    out.push({
      id: `gate-${s}`,
      // Printed on the gate's board (build.js), so it stays on it from any angle.
      position: [0, GATE_SIGN_Y, gateZ(s) + 0.32],
      spec: {
        lines: [
          { text: `${isMegaStage(s) ? 'MEGA PIT' : 'STAGE'} ${s} · LEVEL ${stage.level}`, size: 46, gradient: isMegaStage(s) ? TEXT.gold : SIGN_GRADIENT },
          { text: `Holds ${formatNumber(stage.capacity)} Water`, size: 40, icon: 'drop', fill: '#ffffff' },
        ],
        pxPerUnit: 38,
      },
      fade: 160,
      flat: true,
      fit: [10.4, 2.2],
    })
    // A Mega Pit's chest: what's in it, until you've opened it.
    const chest = MEGA_CHESTS[profile.world]?.[s]
    if (chest) {
      const at = chestAt(s)
      const opened = (profile.world === 1 ? profile.stats.bestStage2 : profile.stats.bestStage) >= s
      const item = ITEMS[chest.item].name
      out.push({
        id: `chest-${s}`,
        // Over the pad's outer half and above its sign, clear of the wall it faces.
        position: [at.x + 3.4, 4.9, at.z],
        spec: {
          lines: opened
            ? [{ text: 'MEGA CHEST', size: 44, gradient: TEXT.gold }, { text: 'Opened!', size: 34, fill: '#ffffff' }]
            : [
                { text: 'MEGA CHEST', size: 44, gradient: TEXT.gold },
                { text: `${chest.amount} ${item}${chest.amount > 1 ? 's' : ''} + x${MEGA_PRIZE} prize`, size: 32, fill: '#ffffff' },
              ],
          pxPerUnit: 52,
        },
        fade: 90,
      })
    }
    const w = winsPad(s)
    out.push({
      id: `wins-${s}`,
      position: [w.x, 2.4, w.z],
      spec: {
        lines: [
          { text: `+${formatNumber(stage.wins * (profile.passes.winsX2 ? 2 : 1))} Wins`, size: 50, icon: 'trophy', gradient: TEXT.gold },
          { text: s === LAST_STAGE ? 'YOU ESCAPED!' : 'Claim & go home', size: 34, fill: '#ffffff' },
        ],
        pxPerUnit: 52,
      },
      fade: 90,
    })
    if (s < LAST_STAGE) {
      const k = skipPad(s)
      out.push({
        id: `skip-${s}`,
        position: [k.x, 2.4, k.z],
        spec: {
          lines: [
            { text: 'SKIP STAGE!', size: 46, gradient: ['#ffe6fb', '#ff8ae8', '#d62fd0'] },
            { text: `${formatNumber(skipPrice(profile, s + 1))} Wins`, size: 38, icon: 'trophy', gradient: TEXT.gold },
          ],
          pxPerUnit: 52,
        },
        fade: 90,
      })
    }
  }
  if (last === LAST_STAGE) {
    out.push({
      id: 'finish',
      position: [0, 10.55, COURSE_END_Z + 5],
      spec: { lines: [{ text: 'YOU ESCAPED!', size: 80, gradient: SIGN_GRADIENT }], pxPerUnit: 34 },
      fade: 220,
      flat: true,
      fit: [14, 3.3],
    })
  }
  return out
}

export default function Course() {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const rootRef = useRef(null)
  const groupRef = useRef(null)
  const poolsRef = useRef(null)
  const streamRef = useRef(null)
  const ringsRef = useRef(null)
  /** Seconds the stream has been running, for its rings and wobble. */
  const pouredFor = useRef(0)
  const splashIn = useRef(0)
  const lastEvent = useRef(0)
  const shadows = useQuality((s) => s.settings.shadows === 'realtime')

  const assets = useMemo(() => {
    const plane = new PlaneGeometry(1, 1)
    const pools = new InstancedMesh(plane, createPoolMaterial(), MAX_POOLS)
    for (let i = 0; i < MAX_POOLS; i += 1) pools.setColorAt(i, WATER_WHITE)
    pools.count = 0
    pools.frustumCulled = false
    pools.renderOrder = 2
    const stream = new Mesh(createStreamGeometry(getQuality().decorDensity < 0.5 ? 12 : 24), createStreamMaterial())
    stream.visible = false
    stream.frustumCulled = false
    stream.renderOrder = 3
    // Rings of foam spreading out where the stream hits the water.
    const ringGeometry = new RingGeometry(0.5, 0.75, 24)
    ringGeometry.rotateX(-Math.PI / 2)
    // Additive, so a ring fades out as its colour darkens.
    const ringMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, side: DoubleSide, blending: AdditiveBlending })
    const rings = new InstancedMesh(ringGeometry, ringMaterial, POUR_RINGS)
    rings.count = 0
    rings.frustumCulled = false
    rings.renderOrder = 3
    return { plane, pools, stream, rings }
  }, [])

  // This module loads after the lobby is on screen; compile its shaders in the
  // background before showing it, so the first run doesn't stall on them.
  useEffect(() => {
    const root = rootRef.current
    // Skipped in dev, where StrictMode's remount disposes materials mid-compile.
    if (!root || import.meta.env.DEV) return undefined
    let cancelled = false
    root.visible = false
    gl.compileAsync(root, camera, scene)
      .catch(() => null)
      .finally(() => {
        if (!cancelled) root.visible = true
      })
    return () => {
      cancelled = true
    }
  }, [gl, camera, scene])

  // A new world is a new course: start it dry.
  useEffect(() => {
    resetPits()
  }, [])

  // Streams chunks (and their signs) in and out between frames, one build per pass.
  useEffect(() => {
    const group = groupRef.current
    /** chunk index -> { mesh, labels: LabelBatch, meshes: [] } */
    const cache = new Map()
    const build = (i) => {
      const { decorDensity, maxTexture } = getQuality()
      const mesh = buildChunk(i, { density: decorDensity }).build(sharedMaterials().blocks)
      mesh.receiveShadow = shadows
      mesh.castShadow = shadows
      group.add(mesh)
      const entry = { mesh, labels: new LabelBatch({ pageSize: Math.min(512, maxTexture) }), meshes: [], dead: false }
      for (const label of chunkLabels(i, getGame().profile)) entry.labels.add(label.id, label.position, label.spec, label)
      entry.labels.setMaxDistance(getQuality().labelDistance ?? 400)
      entry.labels.build().then((meshes) => {
        if (entry.dead) return
        entry.meshes = meshes
        for (const m of meshes) group.add(m)
      })
      cache.set(i, entry)
    }
    const drop = (i, entry) => {
      entry.dead = true
      group.remove(entry.mesh)
      for (const m of entry.meshes) group.remove(m)
      disposeBlocks(entry.mesh)
      entry.labels.dispose()
      cache.delete(i)
    }
    const id = setInterval(() => {
      const p = runtime.player.position
      const here = p.z < COURSE_START_Z ? chunkOf(stageAtZ(p.z)) : 0
      const first = Math.max(0, here - AHEAD)
      const last = Math.min(CHUNK_COUNT - 1, here + AHEAD)
      const wanted = (i) => (i >= first && i <= last) || i <= PINNED
      for (let i = 0; i < CHUNK_COUNT; i += 1) {
        if (!wanted(i) || cache.has(i)) continue
        build(i)
        break
      }
      if (cache.size <= CACHE_LIMIT) return
      for (const [i, entry] of cache) if (!wanted(i)) drop(i, entry)
    }, BUILD_INTERVAL_MS)
    return () => {
      clearInterval(id)
      for (const [i, entry] of cache) drop(i, entry)
    }
  }, [shadows])

  useEffect(
    () => () => {
      assets.plane.dispose()
      assets.pools.material.dispose()
      assets.pools.dispose()
      assets.stream.geometry.dispose()
      assets.stream.material.dispose()
      assets.rings.geometry.dispose()
      assets.rings.material.dispose()
      assets.rings.dispose()
      sfx.pourStop()
      runtime.player.pourAt = null
    },
    [assets],
  )

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const game = getGame()
    const pos = runtime.player.position
    updatePits(delta, game.profile, pos)
    // The colour you pour in (a cosmetic): rainbow cycles.
    const look = STREAM_COLORS[game.profile.cosmetics?.stream] ?? STREAM_COLORS.water
    if (look === 'rainbow') streamTint.value.setHSL((state.clock.elapsedTime * 0.25) % 1, 0.95, 0.6)
    else streamTint.value.copy(look)
    const pools = poolsRef.current
    const stream = streamRef.current
    const rings = ringsRef.current
    if (!pools || !stream || !rings) return

    // --- Pools in the pits around you ---------------------------------------------
    const here = pos.z < COURSE_START_Z ? stageAtZ(pos.z) : 0
    let n = 0
    for (let s = Math.max(1, here - 3); s <= LAST_STAGE && n < MAX_POOLS; s += 1) {
      const level = pits.level[s]
      if (level <= 0.002) continue
      _p.set(0, waterY(level), (pitNearZ(s) + pitFarZ(s)) / 2)
      _s.set(COURSE_HALF_WIDTH * 2 - 0.2, pitLength(s) - 0.2, 1)
      _m.compose(_p, _flat, _s)
      pools.setMatrixAt(n, _m)
      pools.setColorAt(n, _color.copy(WATER_WHITE).lerp(WATER_GOLD, pits.gold[s]))
      n += 1
    }
    pools.count = n
    pools.instanceMatrix.needsUpdate = true
    if (pools.instanceColor) pools.instanceColor.needsUpdate = true

    // --- Your stream, from the bucket to where it lands ----------------------------
    const at = runtime.player.pourAt
    const lip = runtime.player.bucketLip
    if (at && lip) {
      _dir.subVectors(at, lip)
      const drop = Math.max(0.5, -_dir.y)
      const reach = Math.max(0.5, Math.hypot(_dir.x, _dir.z))
      pouredFor.current += delta
      const time = pouredFor.current
      stream.position.copy(lip)
      stream.quaternion.setFromAxisAngle(_yAxis, Math.atan2(_dir.x, _dir.z))
      // Gushing in glugs: the stream swells and thins a little as it goes.
      stream.scale.set(1 + 0.18 * Math.sin(time * 17) + 0.1 * Math.sin(time * 7.3), drop, reach)
      stream.visible = true
      sfx.pourStart()
      // Foam rings spreading where it lands, one after another.
      for (let i = 0; i < POUR_RINGS; i += 1) {
        const age = ((time + (i * RING_LIFE) / POUR_RINGS) % RING_LIFE) / RING_LIFE
        _p.set(at.x, at.y + 0.03, at.z)
        rings.setMatrixAt(i, _m.compose(_p, _q.identity(), _s.setScalar(0.6 + age * 3.2)))
        rings.setColorAt(i, _color.setScalar(1 - age))
      }
      rings.count = POUR_RINGS
      rings.instanceMatrix.needsUpdate = true
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true
      splashIn.current -= delta
      if (splashIn.current <= 0) {
        splashIn.current = SPLASH_EVERY
        burst({ x: at.x, y: at.y + 0.1, z: at.z, count: 8, speed: 5, palette: 'water' })
      }
    } else if (stream.visible) {
      stream.visible = false
      rings.count = 0
      pouredFor.current = 0
      sfx.pourStop()
    }

    // --- Pits filling up, or coming up short -----------------------------------------
    if (pits.events.id !== lastEvent.current) {
      lastEvent.current = pits.events.id
      const { filled, short } = pits.events
      const s = filled >= 0 ? filled : short
      if (s >= 0) {
        _labelAt.set(pos.x, 3.2, pitNearZ(s) - 2)
        if (filled >= 0) {
          sfx.filled()
          spawnPopup('FILLED!', _labelAt, { gradient: 'linear-gradient(180deg, #e0faff 0%, #7fe2ff 45%, #2fa8ff 100%)', scale: 1.4, life: 1200 })
          burst({ x: pos.x, y: 0.5, z: pitNearZ(s) - 4, count: 24, speed: 7, palette: 'water' })
        } else {
          // The HUD's pit meter says what it needs.
          sfx.tooDeep()
        }
      }
    }
  })

  return (
    <group ref={rootRef}>
      <group ref={groupRef} />
      <primitive ref={poolsRef} object={assets.pools} />
      <primitive ref={streamRef} object={assets.stream} />
      <primitive ref={ringsRef} object={assets.rings} />
      <Coins />
    </group>
  )
}
