import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CylinderGeometry, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three'

import { LAST_STAGE } from '@shared/balance'
import { coinAt, COINS_PER_LEDGE, onCourse, stageAtZ } from '@shared/world'

import { sfx } from '../../audio/sfx'
import { burst } from '../fx/fxQueue'
import { runtime } from '../runtime'
import { keyOf, SPOTS, taken } from './coinState'
import { pits } from './pits'

/** Ledges' coins drawn: the one you're on, one behind and AHEAD in front. */
const AHEAD = 6
const BEHIND = 1
const MAX_COINS = (AHEAD + BEHIND + 1) * COINS_PER_LEDGE

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _s = new Vector3(1, 1, 1)

/**
 * The Wins coins over the ledges (world.coinsOf): gold, spinning and bobbing, one
 * instanced draw call for every coin near you. Walking through one hides it at once
 * and chimes; the authority's 'coin' event pays it. They're all back on every run.
 */
export default function Coins() {
  const ref = useRef(null)
  const mesh = useMemo(() => {
    const geometry = new CylinderGeometry(0.75, 0.75, 0.2, 20)
    geometry.rotateX(Math.PI / 2)
    const material = new MeshLambertMaterial({ color: '#ffd21f', emissive: '#9a6200' })
    const m = new InstancedMesh(geometry, material, MAX_COINS)
    m.instanceMatrix.setUsage(DynamicDrawUsage)
    m.count = 0
    m.frustumCulled = false
    return m
  }, [])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )

  useFrame((state) => {
    const coins = ref.current
    if (!coins) return
    const pos = runtime.player.position
    const course = onCourse(pos.x, pos.z)
    // Back in the lobby: every coin is back for the next run.
    if (!course) taken.clear()
    const here = course ? stageAtZ(pos.z) : 0
    if (here >= 1 && here <= pits.open) {
      const index = coinAt(here, pos.x, pos.z)
      if (index >= 0 && !taken.has(keyOf(here, index))) {
        taken.add(keyOf(here, index))
        const spot = SPOTS[here][index]
        sfx.coins(1)
        burst({ x: spot.x, y: 1.4, z: spot.z, count: 14, speed: 5, palette: 'gold' })
      }
    }
    const t = state.clock.elapsedTime
    let n = 0
    for (let s = Math.max(1, here - BEHIND); s <= Math.min(LAST_STAGE, here + AHEAD); s += 1) {
      const spots = SPOTS[s]
      for (let i = 0; i < spots.length; i += 1) {
        if (taken.has(keyOf(s, i))) continue
        _p.set(spots[i].x, 1.3 + Math.sin(t * 2.4 + s + i) * 0.18, spots[i].z)
        _q.setFromEuler(_e.set(0, t * 2.2 + i, 0))
        coins.setMatrixAt(n, _m.compose(_p, _q, _s))
        n += 1
      }
    }
    coins.count = n
    coins.instanceMatrix.needsUpdate = true
  })

  return <primitive ref={ref} object={mesh} />
}
