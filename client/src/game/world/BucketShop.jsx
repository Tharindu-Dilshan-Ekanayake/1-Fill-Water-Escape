import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three'

import { BUCKETS } from '@shared/balance'
import { bucketStars } from '@shared/logic'
import { BUCKET_STANDS, SHOP_STAGES, STAND_SIZE } from '@shared/world'

import { useGame } from '../../store/game'
import { BlockSet, disposeBlocks } from '../blocks'
import { bucketBand, bucketGlow, bucketMatrix, createBucketMesh, disposeBucketMesh } from '../bucket'
import { collectionLabelSpec, standLabelSpec, standState } from '../labels/lobbyLabels'
import { updateWorldLabel } from '../labels/registry'
import { sharedMaterials, STYLE } from '../materials'

/** Stand colours by state: green equipped, blue owned, red not yet. */
const STAND_COLORS = {
  equipped: new Color('#3fdc4a'),
  owned: new Color('#38c8ff'),
  buy: new Color('#ff3b3b'),
}

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()

/** Height of a stand's glowing cap above its pad; the bucket floats over it. */
const CAP_TOP = 1.12
/** Shop buckets' size (body height). */
const SHOWN_SIZE = 1.7
const HOVER = CAP_TOP + 0.3

/**
 * Display stands, all in one block set. The first BUCKET_STANDS.length blocks are the
 * stands' tops themselves (recoloured by state, so their instance index is the stand
 * index); the trimmings follow.
 */
function buildStands() {
  const set = new BlockSet()
  const slab = STAND_SIZE - 0.4
  for (const stand of BUCKET_STANDS) set.addOn(stand.x, stand.y - 0.1, stand.z, slab, 0.3, slab, '#ffffff', STYLE.STUDS)
  for (const stand of BUCKET_STANDS) {
    const id = BUCKETS[stand.index].id
    const { x, y, z } = stand
    // Grey stepped frame, standing clear of the stand's top.
    const e = slab / 2 + 0.1
    for (const side of [-1, 1]) {
      set.addOn(x, y - 0.1, z + side * e, slab + 0.5, 0.45, 0.3, '#c4ccd8', STYLE.SMOOTH)
      set.addOn(x + side * e, y - 0.1, z, 0.3, 0.45, slab + 0.2, '#c4ccd8', STYLE.SMOOTH)
    }
    // A glowing square ring on the stand in the bucket's own splash colour.
    const glow = bucketGlow(id)
    for (const side of [-1, 1]) {
      set.addOn(x, y + 0.2, z + side * 1.25, 2.68, 0.06, 0.18, glow, STYLE.GLOW)
      set.addOn(x + side * 1.25, y + 0.2, z, 0.18, 0.06, 2.32, glow, STYLE.GLOW)
    }
    // Low pedestal with a cap in the bucket's band colour.
    set.addOn(x, y + 0.2, z, 1.1, 0.7, 1.1, '#f4f7fb', STYLE.SMOOTH)
    set.addOn(x, y + 0.9, z, 1.5, CAP_TOP - 0.9, 1.5, bucketBand(id), STYLE.GLOW)
  }
  // A blue carpet down the aisle between the two stages, edged in gold.
  const [front, back] = SHOP_STAGES
  const aisleX = (front.maxX + back.minX) / 2
  const length = front.maxZ - front.minZ
  const midZ = (front.minZ + front.maxZ) / 2
  set.addOn(aisleX, 0, midZ, 2.4, 0.06, length, '#1f6fe0', STYLE.SMOOTH)
  for (const side of [-1, 1]) set.addOn(aisleX + side * 1.25, 0, midZ, 0.18, 0.1, length, '#ffd21f', STYLE.GLOW)
  return set.build(sharedMaterials().blocks)
}

/**
 * The bucket shop: twenty-four display stands on the two shop stages, each with its
 * bucket hovering brimful above it, slowly turning to show itself off. Stands recolour
 * and their labels rewrite as you buy and equip. Two draw calls: stands, buckets.
 */
export function BucketShop() {
  const owned = useGame((s) => s.profile.ownedBuckets)
  const equipped = useGame((s) => s.profile.equippedBucket)
  const stars = useGame((s) => s.profile.bucketStars)
  const standsRef = useRef(null)
  const bucketsRef = useRef(null)

  const assets = useMemo(() => {
    const stands = buildStands()
    // Every shop bucket, in one draw call.
    const count = BUCKETS.length
    const buckets = createBucketMesh(count)
    BUCKETS.forEach((bucket, i) => buckets.setStyle(i, bucket.id))
    buckets.count = count
    return { stands, buckets }
  }, [])

  useEffect(
    () => () => {
      disposeBlocks(assets.stands)
      disposeBucketMesh(assets.buckets)
    },
    [assets],
  )

  // Recolour stands and rewrite their labels whenever ownership or stars change.
  useEffect(() => {
    const stands = standsRef.current
    const profile = { ownedBuckets: owned, equippedBucket: equipped, bucketStars: stars }
    for (const stand of BUCKET_STANDS) {
      const state = standState(profile, stand.index)
      stands?.setColorAt(stand.index, STAND_COLORS[state])
      updateWorldLabel(`stand-${stand.index}`, standLabelSpec(stand.index, state, bucketStars(profile, BUCKETS[stand.index].id)))
    }
    if (stands?.instanceColor) stands.instanceColor.needsUpdate = true
    updateWorldLabel('collection', collectionLabelSpec(profile))
  }, [owned, equipped, stars])

  useFrame((state) => {
    const buckets = bucketsRef.current
    if (!buckets) return
    const t = state.clock.elapsedTime
    for (const stand of BUCKET_STANDS) {
      const id = BUCKETS[stand.index].id
      _p.set(stand.x, stand.y + HOVER + Math.sin(t * 1.6 + stand.index) * 0.15, stand.z)
      // Upright, slowly turning round, with a little sway.
      _q.setFromEuler(_e.set(Math.sin(t * 1.1 + stand.index) * 0.08, t * 0.6 + stand.index, 0))
      buckets.setMatrixAt(stand.index, bucketMatrix(_p, _q, SHOWN_SIZE, id, _m))
    }
    buckets.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <primitive ref={standsRef} object={assets.stands} />
      <primitive ref={bucketsRef} object={assets.buckets} />
    </>
  )
}

export default BucketShop
