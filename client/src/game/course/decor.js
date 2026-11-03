import { COURSE_SIDE_GROUND, COURSE_START_Z, ledgeRect, PAD_SIZE, stageAtZ, winsPad } from '@shared/world'

import { STYLE } from '../materials'
import { COURSE_COLORS } from './palette'

/**
 * The course's scenery: blocky trees on the grass beyond its walls, and bushes and
 * rocks along the edges of every ledge - greens and browns, as the lobby's hills. All
 * plain boxes added to a BlockSet, so a whole chunk of the course is one draw call.
 * Placement is seeded (the caller's `rand`), so every client builds the same course.
 *
 * Positions along the course are in metres `m` north of its start (z = COURSE_START_Z - m).
 */

/** How high the corridor's walls stand, and how far their grassy tops run out. */
export const WALL_H = 10
export const PLATEAU = COURSE_SIDE_GROUND
/** Trees stand this far apart (give or take TREE_JITTER), never overlapping. */
const TREE_PITCH = 9
const TREE_JITTER = 1
/** No scenery on the first few metres, beside the lobby's hills. */
const DECOR_START = 8
/** Props along a ledge keep this far in from its rims. */
const RIM_CLEAR = 1.6

export const zAtM = (m) => COURSE_START_Z - m

const pick = (rand, list) => list[Math.floor(rand() * list.length)]

/** A blocky tree: trunk and three tiers of leaves. */
function tree(b, x, base, z, s, rand) {
  b.addOn(x, base, z, 0.9 * s, 3 * s, 0.9 * s, COURSE_COLORS.trunk)
  const green = pick(rand, COURSE_COLORS.leaves)
  let y = base + 2.6 * s
  for (const width of [4.8, 3.6, 2.4]) {
    b.addOn(x, y, z, width * s, 1.7 * s, width * s, green)
    y += 1.5 * s
  }
}

function bush(b, x, y, z, s, color) {
  b.addOn(x, y, z, 2.2 * s, 1.3 * s, 2.2 * s, color)
  b.addOn(x + 0.3 * s, y + 0.8 * s, z - 0.2 * s, 1.4 * s, 0.9 * s, 1.4 * s, color)
}

function rock(b, x, y, z, s) {
  b.addOn(x, y, z, 2.4 * s, 1.3 * s, 2 * s, COURSE_COLORS.rock, STYLE.STUDS, s * 0.7)
  b.addOn(x + 0.5 * s, y + 1.1 * s, z, 1.3 * s, 0.7 * s, 1.2 * s, COURSE_COLORS.rock, STYLE.STUDS, s * 1.3)
}

/** Whether metre `m` is on a ledge, clear of both its rims and of its pads. */
function onLedge(m) {
  const z = zAtM(m)
  const stage = stageAtZ(z)
  if (stage < 1) return false
  const ledge = ledgeRect(stage)
  const clearOfPads = Math.abs(z - winsPad(stage).z) > PAD_SIZE / 2 + 1
  return clearOfPads && z < ledge.maxZ - RIM_CLEAR && z > ledge.minZ + RIM_CLEAR
}

/**
 * Dresses metres [m0, m1) of the course. `wallX` is where the walls' faces stand (the
 * corridor's half width); `density` (0-1) thins it all out on lower quality presets.
 */
export function decorate(b, m0, m1, wallX, rand, density) {
  // Trees on a jittered grid over the grass beyond each wall, so no two ever overlap
  // (equal canopies overlapping would flicker).
  const first = Math.ceil((Math.max(m0, DECOR_START) - TREE_PITCH / 2) / TREE_PITCH)
  for (let row = first; (row + 0.5) * TREE_PITCH < m1; row += 1) {
    const m = (row + 0.5) * TREE_PITCH
    if (m < m0) continue
    for (const side of [-1, 1]) {
      for (let col = 0; col < 4; col += 1) {
        if (rand() > 0.45 * density) continue
        const x = side * (wallX + 7 + col * TREE_PITCH + (rand() - 0.5) * 2 * TREE_JITTER)
        tree(b, x, WALL_H, zAtM(m + (rand() - 0.5) * 2 * TREE_JITTER), 0.9 + rand() * 0.4, rand)
      }
    }
  }
  // Bushes and the odd rock along the ledges' edges, by the walls.
  const edgeDensity = density < 0.5 ? density * 0.6 : density
  for (let m = m0 + 5 * rand(); m < m1; m += 5 * (0.8 + rand() * 0.5)) {
    if (m < DECOR_START || rand() > edgeDensity || !onLedge(m)) continue
    for (const side of [-1, 1]) {
      if (rand() > 0.75) continue
      const x = side * (wallX - 1.4 - rand() * 0.5)
      if (rand() < 0.75) bush(b, x, 0, zAtM(m), 0.45 + rand() * 0.15, pick(rand, COURSE_COLORS.leaves))
      else rock(b, x, 0, zAtM(m), 0.35 + rand() * 0.1)
    }
  }
}
