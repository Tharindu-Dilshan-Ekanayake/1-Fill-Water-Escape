import { CylinderGeometry, TorusGeometry } from 'three'

import { SHOP_SIGN, SHOP_STAGES, WELL_COUNT, WELL_HEIGHT, WELL_RADIUS, WELL_X, wellCenterZ } from '@shared/world'

import { STYLE } from '../materials'

/**
 * Static lobby structures, added to the world's shared BlockSet and prop builder so they
 * render in the same few draw calls as the hills.
 */

const WELL_LOOK = {
  paving: '#d6b48c',
  base: '#9c7650',
  ring: '#8fe6ff',
  stone: '#a8916f',
  cap: '#dcc6a2',
  water: '#3fb8ff',
  wood: '#7c4d29',
  log: '#9a6a42',
  rope: '#e6d2a6',
  roof: '#3fbf3a',
  text: '#7fe2ff',
}
/**
 * Every well's look, in well order (WELLS in shared/balance.js): all alike, in the
 * game's browns, greens and blues. Which one is which is on its sign.
 */
export const WELL_THEMES = Array.from({ length: WELL_COUNT }, () => WELL_LOOK)

const DISC = new CylinderGeometry(1, 1, 1, 32)
const LOG = new CylinderGeometry(1, 1, 1, 12)
const RING = new TorusGeometry(1, 0.08, 6, 40)
/** The well's round stone wall: a fat ring, stretched upright. */
const WALL = new TorusGeometry(1, 0.28, 10, 32)
const CAP = new TorusGeometry(1, 0.075, 6, 32)
/** The little bucket hanging over the water. */
const PAIL = new CylinderGeometry(0.22, 0.17, 0.3, 12)

/** The well's wall: its centre line's radius, its middle's height over the basin, half its height. */
const WALL_R = 1
const WALL_MID = 0.42
/** The frame: posts this far out either side, the windlass between them, the roof's ridge. */
const POST_X = 1.45
const WINDLASS_Y = WELL_HEIGHT + 1.75
const RIDGE_Y = WELL_HEIGHT + 3
const ROOF_PITCH = 0.62
const ROOF_SLOPE = 1.55
/** The top of the roof, in world y: labels float over it. */
export const WELL_TOP = RIDGE_Y + 0.35

/**
 * The training wells: a round paved basin, its edge ringed with light, and in the middle
 * a storybook well - a stone wall with water shining inside, a wooden frame with a
 * windlass and a little bucket on its rope, under a green A-frame roof. You stand on the
 * paving round it and dip your bucket in. Round parts go into the world's props, the
 * frame and roof into its blocks: no draw calls of their own.
 */
export function buildWells(blocks, props) {
  for (let i = 0; i < WELL_COUNT; i += 1) {
    const look = WELL_THEMES[i]
    const z = wellCenterZ(i)
    const r = WELL_RADIUS + 0.3
    const top = WELL_HEIGHT
    // The basin: a drum, its paving, and a ring of light round the edge.
    props.add(DISC, { position: [WELL_X, (top - 0.08) / 2, z], scale: [r + 0.15, top - 0.08, r + 0.15], color: look.base })
    props.add(DISC, { position: [WELL_X, top - 0.05, z], scale: [r, 0.1, r], color: look.paving, style: STYLE.STUDS })
    props.add(RING, { position: [WELL_X, top + 0.02, z], rotation: [Math.PI / 2, 0, 0], scale: [r - 0.2, r - 0.2, 1], color: look.ring, style: STYLE.GLOW })
    // The well: a stone wall, a lighter cap round its top, the water inside.
    const mid = top + WALL_MID
    props.add(WALL, { position: [WELL_X, mid, z], rotation: [Math.PI / 2, 0, 0], scale: [WALL_R, WALL_R, 1.5], color: look.stone, style: STYLE.STUDS })
    props.add(CAP, { position: [WELL_X, mid + 0.42, z], rotation: [Math.PI / 2, 0, 0], scale: [WALL_R, WALL_R, 1.2], color: look.cap })
    props.add(DISC, { position: [WELL_X, mid + 0.16, z], scale: [0.84, 0.04, 0.84], color: look.water, style: STYLE.WATER })
    // The frame: two posts, the windlass across them with a crank, and the rope and its
    // little bucket hanging over the water.
    for (const side of [-1, 1]) blocks.addOn(WELL_X + side * POST_X, top, z, 0.26, RIDGE_Y - top, 0.26, look.wood, STYLE.SMOOTH)
    props.add(LOG, { position: [WELL_X, WINDLASS_Y, z], rotation: [0, 0, Math.PI / 2], scale: [0.13, POST_X * 2 + 0.2, 0.13], color: look.log })
    blocks.add(WELL_X + POST_X + 0.25, WINDLASS_Y - 0.15, z, 0.09, 0.42, 0.09, look.wood, STYLE.SMOOTH)
    blocks.add(WELL_X + POST_X + 0.25, WINDLASS_Y - 0.36, z + 0.12, 0.09, 0.09, 0.3, look.wood, STYLE.SMOOTH)
    blocks.add(WELL_X + 0.2, (WINDLASS_Y + mid + 0.6) / 2, z, 0.05, WINDLASS_Y - mid - 0.6, 0.05, look.rope, STYLE.SMOOTH)
    props.add(PAIL, { position: [WELL_X + 0.2, mid + 0.45, z], color: look.log })
    props.add(CAP, { position: [WELL_X + 0.2, mid + 0.52, z], rotation: [Math.PI / 2, 0, 0], scale: [0.21, 0.21, 0.6], color: look.wood })
    // The roof: two slopes of green shingles meeting at a wooden ridge over the posts.
    for (const side of [-1, 1]) {
      const run = Math.cos(ROOF_PITCH) * ROOF_SLOPE
      const drop = Math.sin(ROOF_PITCH) * ROOF_SLOPE
      blocks.add(WELL_X, RIDGE_Y - drop / 2, z + (side * run) / 2, POST_X * 2 + 0.7, 0.12, ROOF_SLOPE, look.roof, STYLE.STUDS, 0, side * ROOF_PITCH)
    }
    blocks.add(WELL_X, RIDGE_Y + 0.05, z, POST_X * 2 + 0.9, 0.2, 0.2, look.wood, STYLE.SMOOTH)
  }
}

const WHITE = '#f4f7fb'
const BLUE = '#2f7fe6'
const NAVY = '#1f3c96'
const SKY = '#7fe2ff'

/**
 * The bucket shop: two open display stages (the stands on them are BucketShop's) and
 * the big sign behind, built like the start arch - white decks on a blue band with
 * light strips round the edges. `detail` (off on LOW) adds the sign's bulbs.
 *
 * No two faces here share a plane: every layer stands a clear step proud of what it
 * sits on.
 */
export function buildShop(blocks, { detail = true } = {}) {
  for (const s of SHOP_STAGES) {
    const w = s.maxX - s.minX
    const d = s.maxZ - s.minZ
    const cx = (s.minX + s.maxX) / 2
    const cz = (s.minZ + s.maxZ) / 2
    blocks.addOn(cx, -0.1, cz, w, s.height + 0.1, d, WHITE)
    blocks.addOn(cx, 0, cz, w + 0.3, s.height * 0.5, d + 0.3, BLUE)
    // Light strips along all four top edges, and a gold post at each corner.
    for (const side of [-1, 1]) {
      blocks.addOn(cx + side * (w / 2 - 0.25), s.height, cz, 0.35, 0.08, d - 1.4, SKY, STYLE.GLOW)
      blocks.addOn(cx, s.height, cz + side * (d / 2 - 0.25), w - 1.4, 0.08, 0.35, SKY, STYLE.GLOW)
      for (const end of [-1, 1]) {
        blocks.addOn(cx + side * (w / 2 - 0.35), s.height, cz + end * (d / 2 - 0.35), 0.6, 0.7, 0.6, SKY, STYLE.GLOW)
      }
    }
  }

  // The sign: two striped legs, a navy panel in a blue frame, a gold cap.
  const { x, minZ, maxZ, top } = SHOP_SIGN
  const length = maxZ - minZ
  const midZ = (minZ + maxZ) / 2
  const bottom = top - 8.2
  for (const z of [minZ + 1.5, maxZ - 1.5]) blocks.addOn(x + 0.1, 0, z, 0.9, bottom + 0.3, 0.9, BLUE, STYLE.STRIPES)
  blocks.addOn(x, bottom, midZ, 0.6, top - bottom, length, BLUE)
  blocks.addOn(x - 0.1, bottom + 0.5, midZ, 0.6, top - bottom - 1, length - 1, NAVY, STYLE.SMOOTH)
  blocks.addOn(x, top, midZ, 0.9, 0.4, length + 0.4, SKY, STYLE.GLOW)
  if (detail) {
    for (let z = minZ + 1; z <= maxZ - 0.99; z += 1.5) {
      blocks.add(x - 0.42, bottom + 0.25, z, 0.16, 0.3, 0.3, Math.round(z) % 2 ? '#ffffff' : SKY, STYLE.GLOW)
      blocks.add(x - 0.42, top - 0.25, z + 0.75, 0.16, 0.3, 0.3, Math.round(z) % 2 ? SKY : '#ffffff', STYLE.GLOW)
    }
  }
}
