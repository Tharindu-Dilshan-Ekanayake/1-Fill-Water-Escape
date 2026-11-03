import { isMegaStage, LAST_STAGE } from '@shared/balance'
import { mulberry32 } from '@shared/rng'
import {
  COURSE_END_Z,
  COURSE_HALF_WIDTH,
  COURSE_START_Z,
  ledgeRect,
  PAD_SIZE,
  PIT_DEPTH,
  pitFarZ,
  pitNearZ,
  skipPad,
  START_ARCH,
  START_LINE,
  winsPad,
} from '@shared/world'

import { BlockSet } from '../blocks'
import { STYLE } from '../materials'
import { decorate, PLATEAU, WALL_H } from './decor'
import { COURSE_COLORS as C } from './palette'

/**
 * The course's solid parts, built in chunks of CHUNK_STAGES stages. Each chunk is one
 * BlockSet (one InstancedMesh, one draw call); content is seeded by chunk, so every
 * client builds the same course and a chunk can be thrown away and rebuilt at will.
 *
 * A level corridor between two tall earth walls capped with grass, trees beyond them.
 * Along it, stage after stage: a pit lined with pool tiles under a striped gate that
 * carries the stage's sign, then a ledge of checkered grass with its two pads. The
 * water itself is Course.jsx's, as it rises and falls.
 *
 * No two visible faces here share a plane - coplanar faces flicker ("z-fighting"), worst
 * on phones' coarser depth buffers - so every layer stands a clear LAYER proud of what
 * it sits on, or is set back from it.
 */

export const CHUNK_STAGES = 4
export const CHUNK_COUNT = Math.ceil((LAST_STAGE + 1) / CHUNK_STAGES)
export const chunkOf = (stage) => Math.floor(Math.max(0, stage) / CHUNK_STAGES)

const HALF = COURSE_HALF_WIDTH
/** The walls' faces stand this far out from the corridor's centre. */
export const WALL_X = HALF - 0.1
/** Everything solid reaches this far down, under the pit floors. */
const FOOTING = PIT_DEPTH + 2
/** The smallest gap between two faces that could otherwise be seen together. */
const LAYER = 0.03
/** The gate over each pit: its pillars' height, and the middle of its sign board. */
export const GATE_TOP = 9.5
export const GATE_SIGN_Y = GATE_TOP - 3
/** The pads: Wins in gold, Skip in hot pink. */
export const PAD_COLORS = { wins: ['#ffb31f', '#fff27a'], skip: ['#d62fd0', '#ff9cf0'] }

/** Where the gate over pit `stage` stands: on the ledge before it, just short of the rim. */
export const gateZ = (stage) => pitNearZ(stage) + 0.9

/** Where a stage's stretch of the course starts and ends (z, south to north). */
function stageSpan(stage) {
  if (stage <= 0) return [COURSE_START_Z, pitNearZ(1)]
  if (stage >= LAST_STAGE) return [pitNearZ(stage), COURSE_END_Z]
  return [pitNearZ(stage), pitNearZ(stage + 1)]
}

/** A box spanning x0..x1, y0..y1 and z from `z0` (south) to `z1` (north). */
function box(b, x0, x1, y0, y1, z0, z1, color, style = STYLE.STUDS) {
  b.add((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z0 - z1, color, style)
}

/**
 * The walls either side of a stage: one block each from the corridor's edge out under
 * the grass beyond, earth below and a grass cap with a lip down its face (the toy
 * material's TERRAIN style), so wall and ground beyond are the same piece.
 */
function walls(b, stage) {
  const [z0, z1] = stageSpan(stage)
  for (const side of [-1, 1]) {
    const inner = side * WALL_X
    const outer = side * (WALL_X + PLATEAU)
    box(b, Math.min(inner, outer), Math.max(inner, outer), -FOOTING, WALL_H, z0, z1, C.wall, STYLE.TERRAIN)
  }
}

/** A flat ledge (or the start, or the finish) of checkered grass from z0 to z1. */
function ledge(b, z0, z1) {
  box(b, -HALF, HALF, -FOOTING, 0, z0, z1, C.floor, STYLE.CHECKER)
  // A light strip along the foot of each wall, set out from it.
  for (const side of [-1, 1]) {
    const x = side * (WALL_X - 0.3)
    box(b, x - 0.2, x + 0.2, 0, 0.05, z0 - 0.4, z1 + 0.4, C.lamp, STYLE.GLOW)
  }
}

/** Pit `stage`: its floor, pool tiles round its sides, kerbs along both rims, and its gate. */
function pit(b, stage) {
  const near = pitNearZ(stage)
  const far = pitFarZ(stage)
  const bottom = -PIT_DEPTH
  box(b, -HALF, HALF, bottom - 1, bottom, near, far, C.poolFloor)
  // Tiles up the four sides, in front of the walls and ledges they line; the end ones
  // stop short of the side ones, so no two overlap.
  const top = -LAYER
  for (const side of [-1, 1]) {
    const x0 = side * (WALL_X - 0.12)
    box(b, Math.min(x0, side * WALL_X), Math.max(x0, side * WALL_X), bottom, top, near, far, C.pool)
  }
  box(b, -(WALL_X - 0.12), WALL_X - 0.12, bottom, top, near, near - 0.12, C.pool)
  box(b, -(WALL_X - 0.12), WALL_X - 0.12, bottom, top, far + 0.12, far, C.pool)
  // Rims: a low kerb on the ledge either side, a glowing line along its middle.
  for (const [k0, k1] of [
    [near + 0.6, near],
    [far, far - 0.6],
  ]) {
    box(b, -(WALL_X - 0.05), WALL_X - 0.05, 0, 0.06, k0, k1, C.kerb, STYLE.SMOOTH)
    box(b, -(WALL_X - 0.2), WALL_X - 0.2, 0.06, 0.06 + LAYER, k0 - 0.2, k1 + 0.2, C.lamp, STYLE.GLOW)
  }

  // The gate: striped pillars set into the walls just short of the near rim, a beam
  // across, the stage's sign board (its words are a label, Course.jsx) and a lamp on
  // each pillar.
  const gz = gateZ(stage)
  for (const side of [-1, 1]) {
    const x0 = side * (WALL_X - 0.4)
    const x1 = side * (WALL_X + 0.8)
    box(b, Math.min(x0, x1), Math.max(x0, x1), 0, GATE_TOP, gz + 0.5, gz - 0.5, C.gate, STYLE.STRIPES)
    b.add(side * (WALL_X + 0.2), GATE_TOP + 0.7, gz, 1.4, 1.4, 1.4, C.lamp, STYLE.GLOW)
  }
  box(b, -(WALL_X - 0.3), WALL_X - 0.3, GATE_TOP - 1.1, GATE_TOP - 0.2, gz + 0.45, gz - 0.45, C.gate, STYLE.STRIPES)
  const mega = isMegaStage(stage)
  box(b, -5.8, 5.8, GATE_SIGN_Y - 1.45, GATE_SIGN_Y + 1.45, gz + 0.2, gz - 0.2, mega ? C.gold : C.gate, mega ? STYLE.GLOW : STYLE.STUDS)
  box(b, -5.5, 5.5, GATE_SIGN_Y - 1.25, GATE_SIGN_Y + 1.25, gz + 0.27, gz + 0.2 - LAYER, C.navy, STYLE.SMOOTH)
  if (mega) megaCrown(b, gz)
}

/**
 * A Mega Pit's gate: a gold band along its beam, gold lamps, and a crown of three
 * glowing gold blocks over the middle - seen from a long way down the course.
 */
function megaCrown(b, gz) {
  box(b, -(WALL_X - 0.4), WALL_X - 0.4, GATE_TOP - 0.2, GATE_TOP + 0.2, gz + 0.5, gz - 0.5, C.gold, STYLE.GLOW)
  for (const side of [-1, 1]) b.add(side * (WALL_X + 0.2), GATE_TOP + 2.3, gz, 1.8, 1.8, 1.8, C.gold, STYLE.GLOW)
  b.add(0, GATE_TOP + 1.4, gz, 2.4, 2.4, 0.8, C.gold, STYLE.GLOW, 0, 0, Math.PI / 4)
  for (const side of [-1, 1]) b.add(side * 2.2, GATE_TOP + 0.9, gz, 1.4, 1.4, 0.7, C.gold, STYLE.GLOW, 0, 0, Math.PI / 4)
}

/** Where a Mega Pit's treasure chest stands: by its ledge's Wins pad, against the wall. */
export const chestAt = (stage) => {
  const pad = winsPad(stage)
  return { x: pad.x - PAD_SIZE / 2 - 1.9, z: pad.z }
}

/** A treasure chest: a wooden box under a rounded lid, gold bands and a gold lock. */
function megaChest(b, stage) {
  const { x, z } = chestAt(stage)
  b.addOn(x, 0, z, 2, 1.1, 1.6, C.chest)
  b.addOn(x, 1.1, z, 2.1, 0.55, 1.7, C.chestLid)
  b.addOn(x, 1.65, z, 1.7, 0.25, 1.3, C.chestLid)
  // Bands over the lid, front to back, and the lock on its front (facing the path).
  for (const dx of [-0.65, 0.65]) b.addOn(x + dx, 0, z, 0.22, 1.92, 1.74, C.gold, STYLE.GLOW)
  b.add(x + 1.06, 1.05, z, 0.12, 0.5, 0.4, C.gold, STYLE.GLOW)
}

/**
 * A pad on a ledge, nearly flush with it so feet don't sink in: a white frame, the
 * glowing pad in `colors[0]`, a lighter inset and its emblem on top - each a LAYER up.
 */
function pad(b, at, colors, emblem) {
  const s = PAD_SIZE
  box(b, at.x - s / 2 - 0.2, at.x + s / 2 + 0.2, 0, LAYER, at.z + s / 2 + 0.2, at.z - s / 2 - 0.2, C.kerb, STYLE.SMOOTH)
  box(b, at.x - s / 2, at.x + s / 2, LAYER, 2 * LAYER, at.z + s / 2, at.z - s / 2, colors[0], STYLE.GLOW)
  box(b, at.x - s / 2 + 0.45, at.x + s / 2 - 0.45, 2 * LAYER, 3 * LAYER, at.z + s / 2 - 0.45, at.z - s / 2 + 0.45, colors[1], STYLE.GLOW)
  emblem(b, at.x, 3 * LAYER, at.z)
}

/** A trophy painted on the Wins pad. */
function trophyEmblem(b, x, y, z) {
  b.add(x, y + LAYER / 2, z + 0.6, 1.4, LAYER, 0.4, '#ffffff', STYLE.GLOW)
  b.add(x, y + LAYER / 2, z, 0.35, LAYER, 0.8, '#ffffff', STYLE.GLOW)
  b.add(x, y + LAYER / 2, z - 0.7, 1.6, LAYER, 0.9, '#ffffff', STYLE.GLOW)
}

/** Two chevrons painted on the Skip pad, pointing on up the course. */
function skipEmblem(b, x, y, z) {
  for (const dz of [0.45, -0.45]) {
    for (const side of [-1, 1]) b.add(x + side * 0.38, y + LAYER / 2, z + dz, 1.1, LAYER, 0.32, '#ffffff', STYLE.GLOW, side * 0.75)
  }
}

/** The start: the arch over the course's mouth and the checkered start line. */
function start(b) {
  const z = START_ARCH.z
  const top = 12
  for (const side of [-1, 1]) {
    const x0 = side * (WALL_X - 0.6)
    const x1 = side * (WALL_X + 1.2)
    box(b, Math.min(x0, x1), Math.max(x0, x1), 0, top, z + 0.9, z - 0.9, C.gate, STYLE.STRIPES)
    b.add(side * (WALL_X + 0.3), top + 1.2, z, 2.4, 2.4, 2.4, C.lamp, STYLE.GLOW)
  }
  box(b, -(WALL_X + 1.2), WALL_X + 1.2, top - 1.6, top, z + 0.7, z - 0.7, C.gate, STYLE.STRIPES)
  // Its sign board (the words are a label, Course.jsx).
  box(b, -7.3, 7.3, top - 4.5, top - 1.6 - LAYER, z + 0.75, z + 0.45, C.gate)
  box(b, -7, 7, top - 4.3, top - 1.9, z + 0.82, z + 0.75 - LAYER, C.navy, STYLE.SMOOTH)
  // The start line: two rows of black and white squares.
  const zc = (START_LINE.minZ + START_LINE.maxZ) / 2
  for (let i = 0; i < HALF * 2; i += 1) {
    for (let row = 0; row < 2; row += 1) {
      const black = (i + row) % 2 === 0
      box(b, -HALF + i, -HALF + i + 1, 0, 0.04, zc + 1 - row, zc - row, black ? '#1d1f22' : '#ffffff', STYLE.SMOOTH)
    }
  }
}

/** The finish: an arch at the end of the last ledge, a giant trophy, and the wall that ends it all. */
function finish(b) {
  const z = COURSE_END_Z + 4
  for (const side of [-1, 1]) {
    const x0 = side * (WALL_X - 1.6)
    const x1 = side * (WALL_X - 0.2)
    box(b, Math.min(x0, x1), Math.max(x0, x1), 0, 14, z + 0.8, z - 0.8, C.gate, STYLE.STRIPES)
    b.add(side * (WALL_X - 0.9), 15.4, z, 2.4, 2.4, 2.4, C.lamp, STYLE.GLOW)
  }
  box(b, -(WALL_X - 0.5), WALL_X - 0.5, 12.5, 14, z + 0.75, z - 0.75, C.gate, STYLE.STRIPES)
  box(b, -7.5, 7.5, 8.6, 12.5 - LAYER, z + 0.95, z + 0.75 - LAYER, C.navy, STYLE.SMOOTH)
  // The end wall, in under the side walls.
  box(b, -(WALL_X + 1), WALL_X + 1, -FOOTING, WALL_H - 0.5, COURSE_END_Z + 1, COURSE_END_Z - 3, C.wall, STYLE.TERRAIN)
  // A giant trophy on a plinth before the arch.
  const tz = COURSE_END_Z + 9
  b.addOn(0, 0, tz, 3, 1.4, 3, C.kerb)
  b.addOn(0, 1.4, tz, 1.2, 1.4, 1.2, '#ffd21f', STYLE.GLOW)
  b.addOn(0, 2.8, tz, 3.2, 2.6, 3.2, '#ffd21f', STYLE.GLOW)
  for (const side of [-1, 1]) b.add(side * 2, 4.6, tz, 0.6, 1.6, 0.6, '#ffd21f', STYLE.GLOW)
}

/**
 * Builds chunk `index` (stages [index * CHUNK_STAGES, ...)).
 * @param {{ density?: number }} options 0-1 scenery density (quality)
 */
export function buildChunk(index, { density = 1 } = {}) {
  const b = new BlockSet()
  const rand = mulberry32(index * 7919 + 13)
  const first = index * CHUNK_STAGES
  const last = Math.min(LAST_STAGE, first + CHUNK_STAGES - 1)
  for (let s = first; s <= last; s += 1) {
    const [z0, z1] = stageSpan(s)
    walls(b, s)
    if (s === 0) {
      ledge(b, z0, z1)
      start(b)
    } else {
      pit(b, s)
      const r = ledgeRect(s)
      ledge(b, r.maxZ, r.minZ)
      pad(b, winsPad(s), PAD_COLORS.wins, trophyEmblem)
      if (s < LAST_STAGE) pad(b, skipPad(s), PAD_COLORS.skip, skipEmblem)
      else finish(b)
      if (isMegaStage(s)) megaChest(b, s)
    }
    decorate(b, COURSE_START_Z - z0, COURSE_START_Z - z1, WALL_X, rand, density)
  }
  return b
}
