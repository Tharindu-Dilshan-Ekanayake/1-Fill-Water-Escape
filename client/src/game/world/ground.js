import {
  BufferAttribute,
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearMipmapLinearFilter,
  NearestFilter,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'

import {
  COURSE_HALF_WIDTH,
  COURSE_START_Z,
  EGG_STANDS,
  FREE_REWARD,
  LEADERBOARDS,
  PORTALS,
  SHOP,
  WATERFALL,
  WELL_COUNT,
  WELL_RADIUS,
  WELL_X,
  wellCenterZ,
} from '@shared/world'

import { PALETTE } from '../sceneStyle'

/**
 * The plaza floor: one big plane whose colours come from a tiny "ground map" texture
 * painted at one texel per world unit. Paths, aprons and wells are rectangles painted
 * into it, so their edges always fall on the stud-tile seams, and the whole floor is a
 * single draw call regardless of how many painted regions it has.
 */

const MAP = { minX: -64, maxX: 64, minZ: -44, maxZ: 48 }
const MAP_W = MAP.maxX - MAP.minX
const MAP_H = MAP.maxZ - MAP.minZ

/** Where the ground plane ends to the north: the course's own floor takes over there. */
export const GROUND_NORTH_EDGE = COURSE_START_Z

function painter(ctx) {
  const rect = (r, color) => {
    ctx.fillStyle = color
    ctx.fillRect(
      Math.round(r.minX - MAP.minX),
      Math.round(r.minZ - MAP.minZ),
      Math.round(r.maxX - r.minX),
      Math.round(r.maxZ - r.minZ),
    )
  }
  const bordered = (r, fill, edge) => {
    rect(r, edge)
    rect({ minX: r.minX + 1, maxX: r.maxX - 1, minZ: r.minZ + 1, maxZ: r.maxZ - 1 }, fill)
  }
  const disc = (x, z, radius, color) => {
    ctx.fillStyle = color
    for (let dz = -radius; dz < radius; dz += 1) {
      for (let dx = -radius; dx < radius; dx += 1) {
        if ((dx + 0.5) ** 2 + (dz + 0.5) ** 2 <= radius * radius) {
          ctx.fillRect(Math.floor(x + dx - MAP.minX), Math.floor(z + dz - MAP.minZ), 1, 1)
        }
      }
    }
  }
  return { rect, bordered, disc }
}

export function createGroundMap(maxTexture) {
  const canvas = document.createElement('canvas')
  canvas.width = MAP_W
  canvas.height = MAP_H
  const ctx = canvas.getContext('2d')
  const { rect, bordered, disc } = painter(ctx)

  rect(MAP, PALETTE.plaza)

  // The wells' apron along the west side, under them.
  const wellsMinZ = wellCenterZ(WELL_COUNT - 1) - WELL_RADIUS - 2.5
  const wellsMaxZ = wellCenterZ(0) + WELL_RADIUS + 2.5
  const wellsEast = WELL_X + WELL_RADIUS + 2.5
  bordered({ minX: WELL_X - WELL_RADIUS - 2.5, maxX: wellsEast, minZ: wellsMinZ, maxZ: wellsMaxZ }, PALETTE.apron, PALETTE.apronEdge)

  // Paths: a walkway along the wells, spawn up to the course, spawn to the wells, the
  // bucket shop, the eggs over to the Sphinx, and a spur up to the portal from the
  // shop path.
  const eggsZ = EGG_STANDS[0].z
  const apronZ = COURSE_START_Z + 8
  const paths = [
    { minX: wellsEast, maxX: wellsEast + 5, minZ: wellsMinZ, maxZ: wellsMaxZ },
    { minX: -5, maxX: 5, minZ: apronZ, maxZ: 16 },
    { minX: wellsEast + 5, maxX: -5, minZ: 11, maxZ: 17 },
    { minX: 5, maxX: SHOP.minX + 1, minZ: -12, maxZ: -6 },
    { minX: 16, maxX: 46, minZ: eggsZ - 2, maxZ: eggsZ + 2 },
    ...PORTALS.map((p) => ({ minX: p.x - 3, maxX: p.x + 3, minZ: p.z + 3, maxZ: -12 })),
  ]
  for (const p of paths) bordered(p, PALETTE.path, PALETTE.pathEdge)
  // Paths overlap; repaint the interiors so crossings don't show edges.
  for (const p of paths) {
    rect({ minX: p.minX + 1, maxX: p.maxX - 1, minZ: p.minZ + 1, maxZ: p.maxZ - 1 }, PALETTE.path)
  }
  bordered({ minX: -9, maxX: 9, minZ: 7, maxZ: 21 }, PALETTE.path, PALETTE.pathEdge)
  // A sandy apron before the mouth of the course (not the pale blue of the others: by
  // the pits' pool tiles that would read as water).
  bordered({ minX: -COURSE_HALF_WIDTH - 5, maxX: COURSE_HALF_WIDTH + 5, minZ: COURSE_START_Z, maxZ: apronZ }, PALETTE.path, PALETTE.pathEdge)

  // Egg plaza and the shop yard.
  bordered({ minX: -18, maxX: 18, minZ: eggsZ - 4, maxZ: LEADERBOARDS[0].z - 1 }, PALETTE.apron, PALETTE.apronEdge)
  rect({ minX: SHOP.minX, maxX: SHOP.maxX, minZ: SHOP.minZ, maxZ: SHOP.maxZ }, PALETTE.shopFloor)

  for (const p of PORTALS) {
    disc(p.x, p.z, 6, PALETTE.apronEdge)
    disc(p.x, p.z, 5, PALETTE.apron)
  }
  disc(FREE_REWARD.x, FREE_REWARD.z, 4, PALETTE.apronEdge)

  // Waterfall pool at the foot of the north cliff.
  rect({ minX: WATERFALL.x - 6, maxX: WATERFALL.x + 6, minZ: WATERFALL.z, maxZ: WATERFALL.z + 5 }, PALETTE.water)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.anisotropy = maxTexture > 512 ? 4 : 1
  return texture
}

/**
 * The ground plane, with UVs computed from world position so the map lands exactly
 * on the world grid. Outside the map, clamp-to-edge repeats the plaza colour.
 */
export function createGroundGeometry() {
  const minX = -280
  const maxX = 280
  const minZ = GROUND_NORTH_EDGE
  const maxZ = 280
  const geometry = new PlaneGeometry(maxX - minX, maxZ - minZ)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)

  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    uv.setXY(i, (x - MAP.minX) / MAP_W, 1 - (z - MAP.minZ) / MAP_H)
  }
  uv.needsUpdate = true
  geometry.setAttribute('aStyle', new BufferAttribute(new Float32Array(position.count), 1))
  return geometry
}
