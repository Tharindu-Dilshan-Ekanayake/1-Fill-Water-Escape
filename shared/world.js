import { LAST_STAGE, pitLength } from './balance.js'

/**
 * Lobby and course layout: every gameplay-relevant position and trigger area.
 *
 * Shared by the client (which renders it) and the server (which validates positions
 * against it), so the two can never disagree about where a well, a pit or a pad is.
 *
 * Units are roughly metres - the avatar is 1.8 tall. +X is east, -Z is north, which is
 * "forward" from spawn and the way up the escape course.
 *
 * Seen from spawn: the course's start arch straight ahead (north) with the course
 * climbing away beyond it, the training wells along the left (west) side, the bucket
 * shop on the right (east), eggs and leaderboards behind.
 *
 * Rects are `{ minX, maxX, minZ, maxZ }` on the ground plane.
 */

export const SPAWN = { x: 0, z: 14 }

/** The flat, walkable plaza. Hills surround it on every side but the course. */
export const PLAZA = { minX: -50, maxX: 50, minZ: -40, maxZ: 36 }

// --- The escape course ----------------------------------------------------------------

/**
 * The course runs north from the plaza's north edge: a long, level walled corridor,
 * its floor at ground height all the way. Stage 0 is the start ledge; every stage s
 * after it is, in order going north:
 *
 *   pit s      balance.pitLength(s) long - longer the further you go - and PIT_DEPTH
 *              deep. Pour its water in and it fills to the brim, level with the floor;
 *              you swim across.
 *   ledge s    LEDGE_LENGTH of flat ground, with the Wins pad on the west side and the
 *              Skip pad (for pit s + 1) on the east. The last one runs on as the finish.
 */
export const COURSE_START_Z = PLAZA.minZ
/** Half the width of the corridor between its walls. */
export const COURSE_HALF_WIDTH = 14
/** The course's own ground - its walls and the grass on top - runs this far out either side. */
export const COURSE_SIDE_GROUND = 56
export const START_LENGTH = 16
export const LEDGE_LENGTH = 12
export const PIT_DEPTH = 5
/** A swimmer's feet hang this far under the water, which is level with the rims. */
export const SWIM_DEPTH = 0.95
/** The last ledge runs on this far past its pit: the finish. */
export const FINISH_LENGTH = 20

/** z of every pit's near (south) rim, where you stand to pour, by stage (index 0 unused). */
const NEAR_Z = (() => {
  const near = new Float64Array(LAST_STAGE + 2)
  let z = COURSE_START_Z - START_LENGTH
  for (let s = 1; s <= LAST_STAGE + 1; s += 1) {
    near[s] = z
    if (s <= LAST_STAGE) z -= pitLength(s) + LEDGE_LENGTH
  }
  return near
})()

/** z of pit `stage`'s near (south) rim, where you stand to pour. */
export const pitNearZ = (stage) => NEAR_Z[Math.max(1, Math.min(LAST_STAGE + 1, stage))]
/** z of pit `stage`'s far rim, where its ledge starts. */
export const pitFarZ = (stage) => pitNearZ(stage) - pitLength(stage)
/** The north end of the whole course. */
export const COURSE_END_Z = pitFarZ(LAST_STAGE) - FINISH_LENGTH

export function pitRect(stage) {
  return { minX: -COURSE_HALF_WIDTH, maxX: COURSE_HALF_WIDTH, minZ: pitFarZ(stage), maxZ: pitNearZ(stage) }
}

/** Ledge `stage`'s flat top (the start ledge for 0, the finish for the last). */
export function ledgeRect(stage) {
  if (stage <= 0) return { minX: -COURSE_HALF_WIDTH, maxX: COURSE_HALF_WIDTH, minZ: pitNearZ(1), maxZ: COURSE_START_Z }
  const maxZ = pitFarZ(stage)
  const length = stage >= LAST_STAGE ? FINISH_LENGTH : LEDGE_LENGTH
  return { minX: -COURSE_HALF_WIDTH, maxX: COURSE_HALF_WIDTH, minZ: maxZ - length, maxZ }
}

/** The stage whose pit or ledge z is on; 0 on the start or in the lobby. */
export function stageAtZ(z) {
  if (z >= NEAR_Z[1]) return 0
  // The last near rim at or south of z (rims run north, so z falls as stages rise).
  let lo = 1
  let hi = LAST_STAGE
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (NEAR_Z[mid] > z) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Whether z is over pit `stage`'s water (between its rims). */
export const inPit = (stage, z) => stage >= 1 && z < pitNearZ(stage) && z > pitFarZ(stage)

/**
 * The course floor at z: its height and whether it's water. Ledges are at ground level;
 * pit `stage` holds water level with them once it's filled (`open` = the furthest pit
 * filled this run), and an unfilled one has a wall across its near rim, so nobody
 * stands over it.
 */
export function courseFloorAt(z, open, out = { height: 0, swim: false }) {
  const stage = stageAtZ(z)
  const water = inPit(stage, z)
  out.swim = water && stage <= open
  out.height = !water ? 0 : out.swim ? -SWIM_DEPTH : -PIT_DEPTH
  return out
}

/** Standing within this far short of a pit's near rim (or a step into it), you pour. */
export const POUR_RANGE = 3.4
/** Whether (x, z) is where you pour into pit `stage`: at its near rim. */
export const atPitRim = (stage, x, z) =>
  stage >= 1 && stage <= LAST_STAGE && Math.abs(x) <= COURSE_HALF_WIDTH && z <= pitNearZ(stage) + POUR_RANGE && z >= pitNearZ(stage) - 0.6

/** The pads on ledge `stage`: Wins on the west side, Skip (for the next pit) on the east. */
export const PAD_SIZE = 4.8
export const PAD_OFFSET_X = 8
export function winsPad(stage) {
  const r = ledgeRect(stage)
  const z = stage >= LAST_STAGE ? r.maxZ - LEDGE_LENGTH / 2 : (r.minZ + r.maxZ) / 2
  return { stage, x: stage >= LAST_STAGE ? 0 : -PAD_OFFSET_X, z, y: 0 }
}
export function skipPad(stage) {
  const r = ledgeRect(stage)
  return { stage, x: PAD_OFFSET_X, z: (r.minZ + r.maxZ) / 2, y: 0 }
}
const onPadAt = (pad, x, z, margin) => Math.abs(x - pad.x) <= PAD_SIZE / 2 + margin && Math.abs(z - pad.z) <= PAD_SIZE / 2 + margin

/** The ledge whose Wins pad (x, z) stands on, or -1. */
export function winsPadAt(x, z, margin = 0) {
  const stage = stageAtZ(z)
  if (stage < 1) return -1
  return onPadAt(winsPad(stage), x, z, margin) ? stage : -1
}

/** The ledge whose Skip pad (x, z) stands on, or -1. There's none on the last ledge. */
export function skipPadAt(x, z, margin = 0) {
  const stage = stageAtZ(z)
  if (stage < 1 || stage >= LAST_STAGE) return -1
  return onPadAt(skipPad(stage), x, z, margin) ? stage : -1
}

/** The start line across the start ledge: standing on it is where Auto Win claims. */
export const START_LINE = { minX: -COURSE_HALF_WIDTH + 1, maxX: COURSE_HALF_WIDTH - 1, minZ: COURSE_START_Z - 10, maxZ: COURSE_START_Z - 6 }
export const onStartLine = (x, z, margin = 0) => inRect(START_LINE, x, z, margin)
/** The start arch's pillars, just inside the corridor's mouth. */
export const START_ARCH = { x: COURSE_HALF_WIDTH + 1.2, z: COURSE_START_Z - 2 }

/** The corridor: walkable from the plaza's edge to the finish. */
export const COURSE = { minX: -COURSE_HALF_WIDTH + 0.6, maxX: COURSE_HALF_WIDTH - 0.6, minZ: COURSE_END_Z + 1, maxZ: COURSE_START_Z + 0.5 }

/** Walkable ground; the controller clamps the player into it. */
export const WALKABLE = [PLAZA, COURSE]

/** Whether (x, z) is out on the course rather than in the lobby. */
export const onCourse = (x, z) => z < COURSE_START_Z && Math.abs(x) <= COURSE_HALF_WIDTH + 1

/**
 * The Wins coins floating over every ledge: COINS_PER_LEDGE of them zigzagging up the
 * middle, picked up by walking through one (within COIN_RADIUS). They're back on every
 * run.
 */
export const COINS_PER_LEDGE = 3
export const COIN_RADIUS = 1.6
export function coinsOf(stage) {
  const r = ledgeRect(stage)
  const mid = (r.minZ + r.maxZ) / 2
  return [-1, 0, 1].map((k) => ({ x: k * 2.6, z: mid - k * 3.2 }))
}

/** Which of ledge `stage`'s coins (x, z) is touching, or -1. */
export function coinAt(stage, x, z, radius = COIN_RADIUS) {
  if (stage < 1 || stage > LAST_STAGE) return -1
  const coins = coinsOf(stage)
  for (let i = 0; i < coins.length; i += 1) if (Math.hypot(x - coins[i].x, z - coins[i].z) <= radius) return i
  return -1
}

/**
 * How far north someone who has filled pits up to `open` this run may go: up to the near
 * rim of the first one still to fill (the finish if none is).
 */
export const courseLimitZ = (open) => (open >= LAST_STAGE ? COURSE_END_Z : pitNearZ(open + 1))

// --- Training wells -----------------------------------------------------------------

/**
 * Round wells line the west side of the plaza, south to north: a stone basin brimming
 * with water under a little roof. Stand in one to scoop Water with your bucket.
 */
export const WELL_COUNT = 7
export const WELL_PITCH = 7
/** Radius of a well's basin: standing within it is training. */
export const WELL_RADIUS = 2.7
/**
 * The stone well in the middle of each basin, and its frame: solid, WELL_CORE either
 * side of the centre (its windlass runs east-west, so a little wider that way).
 */
export const WELL_CORE = 1.3
export const WELL_FRAME = 1.55
/** Scooping, you stand this far from the well's centre: at its edge. */
export const WELL_STAND = 1.6
/** The wells' centre line, and the basin floor, a step up from the plaza. */
export const WELL_X = -33
export const WELL_HEIGHT = 0.5
/** Well 0 (the free one) is the southernmost, nearest spawn; the rest run north. */
const WELL0_Z = 24

export const wellCenterZ = (index) => WELL0_Z - index * WELL_PITCH

/** The square round well `index`: its raised basin (walkable, and a wall while locked). */
export function wellRect(index) {
  const cz = wellCenterZ(index)
  const r = WELL_RADIUS + 0.3
  return { minX: WELL_X - r, maxX: WELL_X + r, minZ: cz - r, maxZ: cz + r }
}

// --- Bucket shop --------------------------------------------------------------------

/**
 * The bucket shop: an open-air yard east of the plaza with two display stages, the
 * first twelve buckets on the low front one and the next twelve on the higher back one,
 * and a big BUCKETS sign behind. Both stages are low enough to walk straight onto.
 */
export const SHOP = { minX: 22, maxX: 48, minZ: -26, maxZ: 12 }
export const SHOP_STAGES = [
  { minX: 23.5, maxX: 34, minZ: -25, maxZ: 11, height: 0.5 },
  { minX: 36.5, maxX: 47, minZ: -25, maxZ: 11, height: 1 },
]
/** The sign along the back (east) edge, facing the plaza, high enough to clear the labels. */
export const SHOP_SIGN = { x: 48.6, minZ: -23, maxZ: 9, top: 16 }
export const STAND_SIZE = 4

/** Rows of display stands, nearest the plaza first: two rows on each stage. */
const STAND_ROWS_X = [26, 31.5, 39, 44.5]
/** Stands per row, and how far apart along it. */
const STANDS_PER_ROW = 6
const STAND_PITCH = 6.2

/**
 * Twenty-four stands, six to a row. `row` (0-3, front to back) lets the labels above
 * them step up so nearer ones don't hide farther ones.
 */
export const BUCKET_STANDS = Array.from({ length: 24 }, (_, i) => {
  const row = Math.floor(i / STANDS_PER_ROW)
  return {
    index: i,
    row,
    x: STAND_ROWS_X[row],
    z: (SHOP.minZ + SHOP.maxZ) / 2 - (STAND_PITCH * (STANDS_PER_ROW - 1)) / 2 + (i % STANDS_PER_ROW) * STAND_PITCH,
    y: SHOP_STAGES[row < 2 ? 0 : 1].height,
  }
})

export const standRect = (stand) => ({
  minX: stand.x - STAND_SIZE / 2,
  maxX: stand.x + STAND_SIZE / 2,
  minZ: stand.z - STAND_SIZE / 2,
  maxZ: stand.z + STAND_SIZE / 2,
})

// --- Eggs, showcases, leaderboards --------------------------------------------------

/** The egg row stands in the middle behind spawn, the leaderboards behind it. */
export const EGG_STANDS = [
  { eggId: 'basic', x: -12, z: 24 },
  { eggId: 'meadow', x: -4, z: 24 },
  { eggId: 'sunset', x: 4, z: 24 },
  { eggId: 'unicorn', x: 12, z: 24 },
  { eggId: 'volcano', x: -12, z: -14, big: true },
]
export const EGG_TRIGGER_RADIUS = 4.2

/** Limited premium pet on display. */
export const SPHINX_STAND = { x: 45, z: 21 }

/** Four boards along the back of the plaza. */
export const LEADERBOARDS = [
  { id: 'rebirths', x: -18, z: 33.5 },
  { id: 'wins', x: -6, z: 33.5 },
  { id: 'stage', x: 6, z: 33.5 },
  { id: 'playtime', x: 18, z: 33.5 },
]

/** The world portal beside the course's mouth, to the east. Name and Wins in balance.js. */
export const PORTALS = [{ id: 'world2', x: 28, z: -34, radius: 3.4 }]

export const FREE_REWARD = { x: 12, z: 10, radius: 3 }
export const WATERFALL = { x: 42, z: -40 }

// --- Collision ----------------------------------------------------------------------

const box = (x, z, halfX, halfZ) => ({
  minX: x - halfX,
  maxX: x + halfX,
  minZ: z - halfZ,
  maxZ: z + halfZ,
})

/**
 * Solid, never-changing obstacles. Locked wells and closed pits add their own walls
 * at runtime.
 */
export const STATIC_COLLIDERS = [
  // The shop's sign.
  { minX: SHOP_SIGN.x - 0.5, maxX: SHOP_SIGN.x + 0.5, minZ: SHOP_SIGN.minZ - 0.5, maxZ: SHOP_SIGN.maxZ + 0.5 },
  // Egg pedestals.
  ...EGG_STANDS.map((s) => box(s.x, s.z, s.big ? 2.1 : 1.6, s.big ? 2.1 : 1.6)),
  box(SPHINX_STAND.x, SPHINX_STAND.z, 3, 3),
  ...LEADERBOARDS.map((b) => box(b.x, b.z, 4.6, 0.5)),
  box(FREE_REWARD.x, FREE_REWARD.z, 1.4, 1.4),
  // Each well, and the frame over it, in the middle of its basin.
  ...Array.from({ length: WELL_COUNT }, (_, i) => box(WELL_X, wellCenterZ(i), WELL_FRAME, WELL_CORE)),
  // Each portal ring's base; the swirl itself is walk-through.
  ...PORTALS.flatMap((p) => [box(p.x - p.radius, p.z, 0.6, 0.8), box(p.x + p.radius, p.z, 0.6, 0.8)]),
  // The hills either side of the course's mouth.
  { minX: PLAZA.minX, maxX: -COURSE_HALF_WIDTH - 1, minZ: PLAZA.minZ - 1, maxZ: PLAZA.minZ + 0.6 },
  { minX: COURSE_HALF_WIDTH + 1, maxX: PLAZA.maxX, minZ: PLAZA.minZ - 1, maxZ: PLAZA.minZ + 0.6 },
]

/** Raised floors in the lobby the player stands on, as rects with a height. */
export const PLATFORMS = [
  ...SHOP_STAGES.map((s) => ({ ...s })),
  ...Array.from({ length: WELL_COUNT }, (_, i) => ({ ...wellRect(i), height: WELL_HEIGHT })),
]

// --- Helpers ------------------------------------------------------------------------

export const inRect = (r, x, z, margin = 0) =>
  x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin

/** Whether (x, z) is in well `index`'s basin, give or take `margin`. */
export const inWell = (index, x, z, margin = 0) => Math.hypot(x - WELL_X, z - wellCenterZ(index)) <= WELL_RADIUS + margin

/** Index of the well under (x, z), or -1. */
export function wellAt(x, z, margin = 0) {
  for (let i = 0; i < WELL_COUNT; i += 1) {
    if (inWell(i, x, z, margin)) return i
  }
  return -1
}

/** The portal whose swirl (x, z) is in, give or take `margin`, or null. */
export function portalAt(x, z, margin = 0) {
  for (const p of PORTALS) {
    if (Math.hypot(x - p.x, z - p.z) < p.radius + margin) return p
  }
  return null
}

/** Index of the bucket stand under (x, z), or -1. */
export function standAt(x, z) {
  for (const stand of BUCKET_STANDS) {
    if (inRect(standRect(stand), x, z)) return stand.index
  }
  return -1
}

/** The egg stand within reach of (x, z), or null. */
export function eggStandNear(x, z) {
  for (const stand of EGG_STANDS) {
    const reach = EGG_TRIGGER_RADIUS + (stand.big ? 1 : 0)
    if (Math.hypot(stand.x - x, stand.z - z) <= reach) return stand
  }
  return null
}

const _floor = { height: 0, swim: false }

/**
 * Height of the floor at (x, z): the course's (see courseFloorAt, `reach` deciding which
 * pits hold water), the lobby's raised platforms, else the ground at 0.
 */
export function groundHeightAt(x, z, reach = 0) {
  if (z < COURSE_START_Z) return courseFloorAt(z, reach, _floor).height
  let h = 0
  for (const p of PLATFORMS) {
    if (p.height > h && inRect(p, x, z)) h = p.height
  }
  return h
}

/** Clamps (x, z) into the walkable union, returning the nearest walkable point. */
export function clampToWalkable(x, z, out = { x: 0, z: 0 }) {
  let best = Infinity
  for (const r of WALKABLE) {
    const cx = Math.min(r.maxX, Math.max(r.minX, x))
    const cz = Math.min(r.maxZ, Math.max(r.minZ, z))
    const d = (cx - x) ** 2 + (cz - z) ** 2
    if (d < best) {
      best = d
      out.x = cx
      out.z = cz
      if (d === 0) break
    }
  }
  return out
}

/** Fastest a player can legitimately move, for the server's anti-teleport check. */
export const MAX_MOVE_SPEED = 14
