import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  TorusGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { getQuality } from '../store/quality'
import { glowTime } from './glow'

/**
 * Buckets: what every player carries, scoops Water with in the wells and pours into the
 * course's pits.
 *
 * One bucket mesh for all of them: a tapered round pail, open at the top, with a rolled
 * lip, two bands, lugs either side and an arched wire handle with a grip, and a water
 * surface inside. What each bucket is made of - plastic, wood staves, tin, copper,
 * candy stripes, melon rind, coral, ice, slime, gold, lava, gems, rainbow, galaxy,
 * dragon scales, prism... - is its `skin`, drawn (and animated: sparkles, glowing cracks,
 * shifting colours) in the fragment shader along with its colours and how full it is,
 * all per instance. So every bucket in the game shares one geometry, one material and
 * one compiled shader program, and a shop of twenty-four different buckets is a single
 * draw call.
 *
 * Local frame: the origin is the centre of the bucket's base, +Y up; the body rises
 * BUCKET_HEIGHT to its open top. The handle's arc spans X (its lugs sit at +-X, so it
 * pivots about the X axis) and rises over the top to BUCKET_GRIP; the front faces -Z.
 * Scale the matrix by the size you want it shown at (BUCKET_HEIGHT units tall).
 */

/** Height of the body, base to lip. */
export const BUCKET_HEIGHT = 1
const R_BOTTOM = 0.36
const R_TOP = 0.5
/** The inside wall, as a share of the outside's radius. */
const INNER = 0.93
/** Where the handle's lugs sit, and the arc's radius from them. */
const LUG_Y = 0.86
const HANDLE_R = 0.52
/** The top of the handle: where a hand holds the bucket. */
export const BUCKET_GRIP = new Vector3(0, LUG_Y + HANDLE_R, 0)
/** The water surface's lowest and highest height inside. */
const WATER_LOW = 0.06
const WATER_HIGH = BUCKET_HEIGHT - 0.05

/** The body's outside radius at height `y`. */
const radiusAt = (y) => R_BOTTOM + ((R_TOP - R_BOTTOM) * y) / BUCKET_HEIGHT

/** What a bucket is made of: its `skin`, drawn by SKIN_GLSL. */
export const SKIN = {
  PLASTIC: 0,
  WOOD: 1,
  METAL: 2,
  COPPER: 3,
  CANDY: 4,
  MELON: 5,
  CORAL: 6,
  ICE: 7,
  SLIME: 8,
  GOLD: 9,
  LAVA: 10,
  GEM: 11,
  RAINBOW: 12,
  UNICORN: 13,
  GALAXY: 14,
  DRAGON: 15,
  COSMIC: 16,
  PRISM: 17,
  BUBBLE: 18,
  STRIPES: 19,
}

const WATER = '#3fb8ff'

/**
 * Looks by bucket id (ids and stats live in shared/balance.js): `body` the pail's
 * colour, `band` its bands, lugs and the skin's second colour (stripes, dots, cracks,
 * nebula...), `water` what it carries and `glow` the tint of its splashes and pour
 * stream; `skin` what it's made of (SKIN), `width` how squat it is (1 = the plain pail).
 * The dearer, the shinier and more magical.
 */
export const BUCKET_STYLES = {
  pail: { skin: SKIN.PLASTIC, body: '#ff4a3b', band: '#ffd23a', water: WATER, glow: '#7fd8ff', width: 0.95 },
  beach: { skin: SKIN.STRIPES, body: '#2f8ff2', band: '#ffd23a', water: WATER, glow: '#7fd8ff', width: 1 },
  wood: { skin: SKIN.WOOD, body: '#c98f52', band: '#5f636c', water: WATER, glow: '#9fe2ff', width: 1.05 },
  tin: { skin: SKIN.METAL, body: '#b8c2cf', band: '#7d8796', water: WATER, glow: '#bfeaff', width: 1 },
  copper: { skin: SKIN.COPPER, body: '#e08a52', band: '#8a4a24', water: WATER, glow: '#ffc07a', width: 1.05 },
  bubblegum: { skin: SKIN.BUBBLE, body: '#ff8fd0', band: '#ffffff', water: '#7fe2ff', glow: '#ff9cd6', width: 1.05 },
  candy: { skin: SKIN.CANDY, body: '#ffffff', band: '#ff2a4a', water: '#7fe2ff', glow: '#ff7a8a', width: 1 },
  melon: { skin: SKIN.MELON, body: '#46c03a', band: '#1f6a1a', water: '#5fd6ff', glow: '#7dff6a', width: 1.15 },
  coral: { skin: SKIN.CORAL, body: '#ff7a6a', band: '#ffd6c8', water: '#3fd6ff', glow: '#ff9a7a', width: 1.05 },
  ice: { skin: SKIN.ICE, body: '#bfe9ff', band: '#ffffff', water: '#9ff0ff', glow: '#bff4ff', width: 1 },
  silver: { skin: SKIN.METAL, body: '#e4ebf4', band: '#8f9bb0', water: '#7fe2ff', glow: '#e8f0ff', width: 1 },
  slime: { skin: SKIN.SLIME, body: '#62e63c', band: '#2f9a1f', water: '#7dff6a', glow: '#7dff5a', width: 1.1 },
  gold: { skin: SKIN.GOLD, body: '#ffbf1a', band: '#ff9a0a', water: '#5fd6ff', glow: '#ffd21f', width: 1.05 },
  lava: { skin: SKIN.LAVA, body: '#3a1610', band: '#ff6a1e', water: '#ff8a2a', glow: '#ff4a1c', width: 1.1 },
  emerald: { skin: SKIN.GEM, body: '#1fcf6a', band: '#ffd21f', water: '#5fffc8', glow: '#5fff9a', width: 1.05 },
  ruby: { skin: SKIN.GEM, body: '#e8203a', band: '#ffd21f', water: '#ff9ab8', glow: '#ff5a7a', width: 1.05 },
  sapphire: { skin: SKIN.GEM, body: '#2a5cff', band: '#c8efff', water: '#7fd0ff', glow: '#5f9aff', width: 1.05 },
  diamond: { skin: SKIN.GEM, body: '#dff6ff', band: '#7fe2ff', water: '#bff4ff', glow: '#bff4ff', width: 1.1 },
  rainbow: { skin: SKIN.RAINBOW, body: '#ff5fd2', band: '#ffffff', water: '#7fe8ff', glow: '#ff7ad9', width: 1.1 },
  unicorn: { skin: SKIN.UNICORN, body: '#ffd6f4', band: '#b07cff', water: '#d6b4ff', glow: '#ffb0f0', width: 1.1 },
  galaxy: { skin: SKIN.GALAXY, body: '#1a1030', band: '#c08bff', water: '#a46bff', glow: '#a46bff', width: 1.15 },
  dragon: { skin: SKIN.DRAGON, body: '#1f9a4a', band: '#ffd21f', water: '#5fffd8', glow: '#4cff7a', width: 1.15 },
  cosmic: { skin: SKIN.COSMIC, body: '#2a1460', band: '#ff9ed8', water: '#ff9ed8', glow: '#ff9ed8', width: 1.15 },
  infinity: { skin: SKIN.PRISM, body: '#ffffff', band: '#ffffff', water: '#e0faff', glow: '#ffffff', width: 1.2 },
}

const styleOf = (id) => BUCKET_STYLES[id] || BUCKET_STYLES.pail

// Parsed once, so frame code can look colours up without allocating.
const parse = (key) => Object.fromEntries(Object.entries(BUCKET_STYLES).map(([id, s]) => [id, new Color(s[key])]))
const BODIES = parse('body')
const BANDS = parse('band')
const WATERS = parse('water')
const GLOWS = parse('glow')

export const bucketBody = (id) => BODIES[id] || BODIES.pail
export const bucketBand = (id) => BANDS[id] || BANDS.pail
/** The water a bucket carries. */
export const bucketWater = (id) => WATERS[id] || WATERS.pail
/** The tint of its splashes and pour stream. */
export const bucketGlow = (id) => GLOWS[id] || GLOWS.pail
/** How wide a bucket is drawn: its X and Z scale, on top of whatever size it's shown at. */
export const bucketWidth = (id) => styleOf(id).width

// --- Geometry ------------------------------------------------------------------------

/**
 * The parts, by the `aPart` each vertex carries: 0 body (outside and base), 1 inside,
 * 2 rolled lip, 3 bands, 4 lugs, 5 handle wire, 6 grip, 7 water.
 */
const PART = { BODY: 0, INSIDE: 1, LIP: 2, BAND: 3, LUG: 4, HANDLE: 5, GRIP: 6, WATER: 7 }

/** Tags every vertex of `g` as part `part` (see PART). */
function tagged(g, part) {
  g.deleteAttribute('uv')
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(part), 1))
  return g
}

/** Turns an indexed geometry inside out: faces and normals pointing the other way. */
function flipped(g) {
  const index = g.getIndex()
  for (let i = 0; i < index.count; i += 3) {
    const b = index.getX(i + 1)
    index.setX(i + 1, index.getX(i + 2))
    index.setX(i + 2, b)
  }
  const normal = g.getAttribute('normal')
  for (let i = 0; i < normal.count; i += 1) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i))
  return g
}

/**
 * Mesh detail: the full bucket (about 610 triangles) and a lighter one for the LOW
 * preset (about 360) - a shop and a lobby full of buckets stay well inside a phone's
 * budget.
 */
const DETAIL = {
  full: { seg: 18, lip: [5, 18], handle: [5, 14], grip: 8, lug: 8 },
  low: { seg: 12, lip: [4, 12], handle: [4, 8], grip: 6, lug: 6 },
}
const baseGeometries = {}

function bucketBaseGeometry(level) {
  if (baseGeometries[level]) return baseGeometries[level]
  const d = DETAIL[level]
  const pieces = []
  // The body: an open, tapered wall, its base underneath, and the same again inside.
  const wall = new CylinderGeometry(R_TOP, R_BOTTOM, BUCKET_HEIGHT, d.seg, 1, true)
  wall.translate(0, BUCKET_HEIGHT / 2, 0)
  pieces.push(tagged(wall, PART.BODY))
  const base = new CircleGeometry(R_BOTTOM, d.seg)
  base.rotateX(Math.PI / 2)
  pieces.push(tagged(base, PART.BODY))
  const inside = new CylinderGeometry(R_TOP * INNER, R_BOTTOM * INNER, BUCKET_HEIGHT, d.seg, 1, true)
  inside.translate(0, BUCKET_HEIGHT / 2, 0)
  pieces.push(tagged(flipped(inside), PART.INSIDE))
  const floor = new CircleGeometry(R_BOTTOM * INNER, d.seg)
  floor.rotateX(-Math.PI / 2)
  floor.translate(0, 0.04, 0)
  pieces.push(tagged(floor, PART.INSIDE))
  // The rolled lip round the top, closing the gap between the walls.
  const lip = new TorusGeometry(R_TOP * (1 + INNER) * 0.5, R_TOP * (1 - INNER) * 0.5 + 0.03, d.lip[0], d.lip[1])
  lip.rotateX(Math.PI / 2)
  lip.translate(0, BUCKET_HEIGHT, 0)
  pieces.push(tagged(lip, PART.LIP))
  // Two bands, following the taper a hair proud of the wall.
  for (const [y0, y1] of [
    [0.14, 0.24],
    [0.64, 0.74],
  ]) {
    const band = new CylinderGeometry(radiusAt(y1) + 0.018, radiusAt(y0) + 0.018, y1 - y0, d.seg, 1, true)
    band.translate(0, (y0 + y1) / 2, 0)
    pieces.push(tagged(band, PART.BAND))
  }
  // A lug either side, the handle's arc between them and its grip on top.
  for (const side of [-1, 1]) {
    const lug = new CylinderGeometry(0.075, 0.075, 0.09, d.lug)
    lug.rotateZ(Math.PI / 2)
    lug.translate(side * (radiusAt(LUG_Y) + 0.035), LUG_Y, 0)
    pieces.push(tagged(lug, PART.LUG))
  }
  const handle = new TorusGeometry(HANDLE_R, 0.032, d.handle[0], d.handle[1], Math.PI)
  handle.translate(0, LUG_Y, 0)
  pieces.push(tagged(handle, PART.HANDLE))
  const grip = new CylinderGeometry(0.06, 0.06, 0.34, d.grip)
  grip.rotateZ(Math.PI / 2)
  grip.translate(BUCKET_GRIP.x, BUCKET_GRIP.y, BUCKET_GRIP.z)
  pieces.push(tagged(grip, PART.GRIP))
  // The water: a unit disc the vertex shader sizes and lifts to the bucket's level.
  const water = new CircleGeometry(1, d.seg)
  water.rotateX(-Math.PI / 2)
  pieces.push(tagged(water, PART.WATER))

  const merged = mergeGeometries(pieces, false)
  for (const piece of pieces) piece.dispose()
  merged.computeBoundingSphere()
  baseGeometries[level] = merged
  return merged
}

// --- Material ------------------------------------------------------------------------

const vertexHead = /* glsl */ `
  attribute vec3 aBand;
  attribute vec3 aWater;
  attribute vec2 aSkinLevel;
  attribute float aPart;
  uniform float uBTime;
  varying vec3 vBLocal;
  varying vec3 vBBand;
  varying vec3 vBWater;
  varying float vBPart;
  varying float vBSkin;
`

const vertexBody = /* glsl */ `
  // The water disc: lifted to the bucket's level and sized to the wall there; folded
  // away entirely when the bucket is empty.
  if (aPart > 6.5) {
    float level = clamp(aSkinLevel.y, 0.0, 1.0);
    float wy = mix(${WATER_LOW.toFixed(3)}, ${WATER_HIGH.toFixed(3)}, level);
    float wr = (${R_BOTTOM.toFixed(3)} + ${(R_TOP - R_BOTTOM).toFixed(3)} * wy / ${BUCKET_HEIGHT.toFixed(3)}) * ${(INNER * 0.99).toFixed(3)};
    transformed.xz *= wr;
    transformed.y = wy + sin(uBTime * 3.0 + transformed.x * 9.0 + transformed.z * 6.0) * 0.012 * length(position.xz);
    if (level < 0.01) transformed *= 0.0;
  }
  vBLocal = transformed;
  vBBand = aBand;
  vBWater = aWater;
  vBPart = aPart;
  vBSkin = aSkinLevel.x;
`

const fragmentHead = /* glsl */ `
  varying vec3 vBLocal;
  varying vec3 vBBand;
  varying vec3 vBWater;
  varying float vBPart;
  varying float vBSkin;
  uniform float uBTime;
  const float BTAU = 6.2831853;
  float bHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float bNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = bHash(i);
    float b = bHash(i + vec2(1.0, 0.0));
    float c = bHash(i + vec2(0.0, 1.0));
    float d = bHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  vec3 bHue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }
  float bBand(float v, float a, float b, float w) {
    return smoothstep(a - w, a + w, v) * (1.0 - smoothstep(b - w, b + w, v));
  }
  // A twinkle in cell 'g': mostly nothing, now and then a bright point.
  float bSparkle(vec2 g, float density) {
    vec2 cell = floor(g);
    float h = bHash(cell);
    vec2 f = fract(g) - 0.5;
    float tw = pow(max(0.0, sin(uBTime * (2.0 + h * 3.0) + h * 40.0)), 12.0);
    return step(1.0 - density, h) * tw * (1.0 - smoothstep(0.05, 0.22, length(f)));
  }

  // The bucket's skin at (u round it 0-1, y up it): body colour, second colour, glow out.
  vec3 bSkin(int skin, vec3 body, vec3 band, float u, float y, inout float emi) {
    vec3 col = body;
    if (skin == 1) {
      // Wooden staves: ten planks, each its own shade, grained, dark seams between.
      float x = u * 10.0;
      float id = floor(x);
      float seam = smoothstep(0.86, 0.97, abs(fract(x) - 0.5) * 2.0);
      float grain = bNoise(vec2(id * 13.0 + fract(x) * 3.0, y * 9.0));
      col = body * (0.82 + 0.3 * bHash(vec2(id, 3.0))) * (0.88 + 0.2 * grain);
      col *= 1.0 - seam * 0.5;
    } else if (skin == 2 || skin == 3 || skin == 9) {
      // Metal: fine brushed streaks and bright bands of reflection round it.
      float brushed = 0.9 + 0.1 * bNoise(vec2(u * 140.0, y * 2.0));
      float sheen = 0.82 + 0.4 * pow(0.5 + 0.5 * sin(u * BTAU * 2.0 + 0.8), 3.0);
      col = body * brushed * sheen;
      if (skin == 3) {
        // Copper's green patina, in blotches.
        float patina = smoothstep(0.6, 0.74, bNoise(vec2(u * 12.0, y * 5.0)));
        col = mix(col, vec3(0.32, 0.78, 0.62), patina * 0.75);
      }
      if (skin == 9) {
        col += vec3(1.0, 0.95, 0.7) * bSparkle(vec2(u * 40.0, y * 20.0), 0.12);
        emi = 0.1;
      }
    } else if (skin == 4) {
      // Candy cane: fat stripes spiralling round.
      float s = smoothstep(0.46, 0.54, fract(u * 6.0 + y * 1.4));
      col = mix(body, band, s);
    } else if (skin == 5) {
      // Melon rind: wobbly dark stripes from top to bottom.
      float s = abs(fract(u * 9.0 + 0.06 * sin(y * 16.0)) - 0.5) * 2.0;
      col = mix(body * 1.1, band, smoothstep(0.55, 0.75, s));
    } else if (skin == 6) {
      // Coral: knobbly pale bumps all over.
      vec2 g = vec2(u * 16.0, y * 8.0);
      vec2 f = fract(g) - 0.5 + (vec2(bHash(floor(g)), bHash(floor(g) + 7.0)) - 0.5) * 0.3;
      float bump = 1.0 - smoothstep(0.16, 0.26, length(f));
      col = mix(body, band, bump * 0.85);
    } else if (skin == 7) {
      // Ice: frosted facets, whiter towards the rim.
      vec2 g = vec2(u * 9.0 + floor(y * 4.0) * 0.5, y * 4.0);
      col = mix(body, vec3(1.0), bHash(floor(g)) * 0.35 + smoothstep(0.75, 1.0, y) * 0.3);
      col += vec3(0.9, 1.0, 1.0) * bSparkle(vec2(u * 30.0, y * 15.0), 0.1);
      emi = 0.12;
    } else if (skin == 8) {
      // Slime: dribbles running down from the lip, glowing a little.
      float x = u * 12.0;
      float id = floor(x);
      float len = 0.2 + bHash(vec2(id, 5.0)) * 0.55;
      float width = 0.22 + 0.2 * bHash(vec2(id, 9.0));
      float drip = (1.0 - smoothstep(width - 0.05, width, abs(fract(x) - 0.5))) * step(1.0 - len, y);
      float blob = 1.0 - smoothstep(0.0, 0.12, length(vec2((fract(x) - 0.5) * 0.6, y - (1.0 - len))));
      col = mix(body, band, max(drip, blob));
      col *= 0.9 + 0.15 * sin(y * 20.0 + uBTime * 2.0);
      emi = 0.2;
    } else if (skin == 10) {
      // Lava: dark crust split by glowing cracks that pulse.
      vec2 g = vec2(u * 11.0, y * 5.5);
      vec2 cell = floor(g);
      vec2 f = fract(g) - 0.5;
      float crack = 1.0 - smoothstep(0.03, 0.1, min(abs(f.x), abs(f.y)) + bHash(cell) * 0.05);
      vec3 glow = band * (0.85 + 0.35 * sin(uBTime * 3.0 + y * 7.0 + u * 9.0));
      col = mix(body * (0.7 + 0.5 * bHash(cell)), glow, crack);
      emi = crack * 1.1;
    } else if (skin == 11) {
      // Gems: cut facets, each its own shade, catching the light now and then.
      float row = floor(y * 3.0);
      float facet = bHash(vec2(floor(u * 12.0 + row * 0.5), row));
      col = body * (0.7 + 0.55 * facet);
      col = mix(col, vec3(1.0), smoothstep(0.85, 1.0, facet) * 0.4);
      col += vec3(1.0) * bSparkle(vec2(u * 24.0, y * 12.0), 0.15);
      emi = 0.14;
    } else if (skin == 12) {
      // Rainbow: hues sweeping up the bucket.
      col = mix(bHue(y * 0.8 + u - uBTime * 0.2), vec3(1.0), 0.15);
      emi = 0.22;
    } else if (skin == 13) {
      // Unicorn: soft pastel swirls and a sprinkle of stars.
      col = mix(bHue(u + y * 0.3 + uBTime * 0.05), vec3(1.0), 0.55);
      col = mix(col, band, smoothstep(0.47, 0.53, fract(u * 4.0 - y * 1.2)) * 0.35);
      col += vec3(1.0) * bSparkle(vec2(u * 30.0, y * 15.0), 0.12);
      emi = 0.12;
    } else if (skin == 14 || skin == 16) {
      // Galaxy: drifting nebula over the dark, and twinkling stars; Cosmic swirls colour.
      float n = bNoise(vec2(u * 6.0, y * 3.0) + uBTime * 0.05) * bNoise(vec2(u * 13.0, y * 6.0) - uBTime * 0.03);
      col = mix(body, band, n * 1.4);
      if (skin == 16) col = mix(col, bHue(fract(u * 2.0 + y * 0.6 + uBTime * 0.08)), 0.35);
      col += vec3(1.0) * bSparkle(vec2(u * 36.0, y * 18.0), 0.2);
      emi = 0.4;
    } else if (skin == 15) {
      // Dragon: overlapping scales, dark-edged, a little gold where they catch.
      vec2 g = vec2(u * 14.0, y * 7.0);
      g.x += mod(floor(g.y), 2.0) * 0.5;
      vec2 f = fract(g) - vec2(0.5, 0.0);
      float edge = smoothstep(0.42, 0.52, length(f));
      col = mix(body * (1.15 - f.y * 0.4), body * 0.3, edge);
      col = mix(col, band, smoothstep(0.8, 1.0, 1.0 - f.y) * (1.0 - edge) * 0.25);
    } else if (skin == 17) {
      // Prism: white crystal flashing every colour along its facets.
      float row = floor(y * 4.0);
      float facet = bHash(vec2(floor(u * 10.0 + row * 0.5), row));
      col = mix(vec3(1.0), bHue(u * 3.0 + y + facet + uBTime * 0.3), 0.3 + 0.4 * facet);
      col += vec3(1.0) * bSparkle(vec2(u * 30.0, y * 15.0), 0.18);
      emi = 0.3;
    } else if (skin == 18) {
      // Bubblegum: big polka dots.
      vec2 g = vec2(u * 10.0, y * 5.0);
      g.x += mod(floor(g.y), 2.0) * 0.5;
      float spot = 1.0 - smoothstep(0.2, 0.25, length(fract(g) - 0.5));
      col = mix(body, band, spot);
    } else if (skin == 19) {
      // Seaside stripes: a wavy band round the middle.
      float s = bBand(y + 0.04 * sin(u * BTAU * 6.0), 0.4, 0.55, 0.01);
      col = mix(body, band, s);
    }
    return col;
  }
`

/**
 * Every part's colour: the body and its inside in the bucket's skin (the inside in its
 * shade), the lip a touch lighter, bands and lugs in the second colour, the handle a
 * wire tinted by it, the grip the body's, and the water rippling in its own colour.
 */
const PART_GLSL = /* glsl */ `
  {
    vec3 body = diffuseColor.rgb;
    float u = atan(vBLocal.z, vBLocal.x) / BTAU + 0.5;
    float y = vBLocal.y;
    int skin = int(vBSkin + 0.5);
    float emi = 0.0;
    vec3 col = body;
    if (vBPart < 1.5) {
      col = bSkin(skin, body, vBBand, u, y, emi);
      if (vBPart > 0.5) {
        col *= 0.6;
        emi *= 0.5;
      }
    } else if (vBPart < 2.5) {
      col = mix(bSkin(skin, body, vBBand, u, 0.98, emi), vec3(1.0), 0.18);
    } else if (vBPart < 3.5) {
      col = vBBand * (0.92 + 0.16 * sin(u * BTAU * 3.0));
    } else if (vBPart < 4.5) {
      col = vBBand * 0.85;
    } else if (vBPart < 5.5) {
      col = mix(vBBand, vec3(0.86, 0.89, 0.94), 0.45);
    } else if (vBPart < 6.5) {
      col = body * 0.92;
    } else {
      float r = length(vBLocal.xz);
      float ripple = 0.5 + 0.5 * sin(r * 40.0 - uBTime * 5.0);
      col = mix(vBWater, vec3(1.0), ripple * 0.18 + 0.1);
      emi = 0.3;
    }
    diffuseColor.rgb = col;
    totalEmissiveRadiance += col * emi;
  }
`

/**
 * The cartoon finish, after the toon lighting: a dark outline wherever the surface turns
 * away from the camera (drawn like a comic, with no extra geometry) and a small crisp
 * highlight, brighter on metal, ice, gems and crystal.
 */
const SHINE_GLSL = /* glsl */ `
  {
    vec3 bV = normalize(vViewPosition);
    vec3 bN = normalize(normal);
    if (dot(bN, bV) < 0.0) bN = -bN;
    float bFacing = max(dot(bN, bV), 0.0);
    vec3 bH = normalize(normalize(vec3(0.45, 0.85, 0.35)) + bV);
    int bSkinId = int(vBSkin + 0.5);
    float bShiny = (bSkinId == 2 || bSkinId == 3 || bSkinId == 7 || bSkinId == 9 || bSkinId == 11 || bSkinId == 17 || vBPart > 6.5) ? 1.0 : 0.0;
    float bSpec = pow(max(dot(bN, bH), 0.0), bShiny > 0.5 ? 40.0 : 24.0);
    bSpec = smoothstep(0.45, 0.55, bSpec) * (bShiny > 0.5 ? 0.32 : 0.16);
    outgoingLight += vec3(bSpec);
    float bInk = 1.0 - smoothstep(0.2, 0.34, bFacing);
    outgoingLight = mix(outgoingLight, vec3(0.06, 0.06, 0.12), bInk * 0.9 * step(vBPart, 6.5));
  }
`

/** Three flat bands of light: the cel shading that makes it read as a cartoon. */
let toonBands = null
function toonGradient() {
  if (!toonBands) {
    toonBands = new DataTexture(new Uint8Array([150, 210, 255]), 3, 1, RedFormat)
    toonBands.minFilter = NearestFilter
    toonBands.magFilter = NearestFilter
    toonBands.generateMipmaps = false
    toonBands.needsUpdate = true
  }
  return toonBands
}

let sharedMaterial = null

/** The one material every bucket uses. */
export function bucketMaterial() {
  if (!sharedMaterial) {
    sharedMaterial = new MeshToonMaterial({ color: 0xffffff, emissive: new Color('#ffffff'), emissiveIntensity: 0.06, gradientMap: toonGradient() })
    sharedMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vertexHead}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBody}`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragmentHead}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${PART_GLSL}`)
        .replace('#include <opaque_fragment>', `${SHINE_GLSL}\n#include <opaque_fragment>`)
      // The lobby's clock, which already ticks every frame for the halos.
      shader.uniforms.uBTime = glowTime
    }
    sharedMaterial.customProgramCacheKey = () => 'bucket-v1'
  }
  return sharedMaterial
}

/** How full a bucket is unless told otherwise: brimming, as it should look in a shop. */
const DEFAULT_LEVEL = 0.85

/**
 * Up to `max` buckets in one draw call. Place them with setMatrixAt (scale X and Z by
 * bucketWidth, or use bucketMatrix) and style them with `setStyle(index, bucketId)`;
 * `setLevel(index, 0-1)` sets how full one is. Set `.count` to how many to draw.
 */
export function createBucketMesh(max) {
  // Chosen when the mesh is made: the LOW preset gets the lighter bucket.
  const base = bucketBaseGeometry(getQuality().decorDensity < 0.5 ? 'low' : 'full')
  // Own geometry object (it needs its own per-instance attributes), sharing the
  // bucket's vertex buffers.
  const geometry = new BufferGeometry()
  geometry.setIndex(base.index)
  for (const name of ['position', 'normal', 'aPart']) geometry.setAttribute(name, base.getAttribute(name))
  geometry.boundingSphere = base.boundingSphere
  const band = new InstancedBufferAttribute(new Float32Array(max * 3), 3)
  const water = new InstancedBufferAttribute(new Float32Array(max * 3), 3)
  const skinLevel = new InstancedBufferAttribute(new Float32Array(max * 2), 2)
  for (let i = 0; i < max; i += 1) skinLevel.setY(i, DEFAULT_LEVEL)
  geometry.setAttribute('aBand', band)
  geometry.setAttribute('aWater', water)
  geometry.setAttribute('aSkinLevel', skinLevel)

  const mesh = new InstancedMesh(geometry, bucketMaterial(), max)
  mesh.setColorAt(0, BODIES.pail)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.castShadow = true
  const styled = new Array(max).fill(null)
  const levels = new Float32Array(max).fill(DEFAULT_LEVEL)

  /** Styles instance `i` as bucket `id`; cheap to call every frame. */
  mesh.setStyle = (i, id) => {
    if (styled[i] === id) return
    styled[i] = id
    mesh.setColorAt(i, bucketBody(id))
    const b = bucketBand(id)
    const w = bucketWater(id)
    band.setXYZ(i, b.r, b.g, b.b)
    water.setXYZ(i, w.r, w.g, w.b)
    skinLevel.setX(i, styleOf(id).skin)
    mesh.instanceColor.needsUpdate = true
    band.needsUpdate = true
    water.needsUpdate = true
    skinLevel.needsUpdate = true
  }

  /** How full instance `i` is: 0 empty, 1 brimming. Cheap to call every frame. */
  mesh.setLevel = (i, level) => {
    // Small changes don't need a re-upload: nobody sees a millimetre of water.
    if (Math.abs(levels[i] - level) < 0.004) return
    levels[i] = level
    skinLevel.setY(i, level)
    skinLevel.needsUpdate = true
  }
  return mesh
}

/** Frees a mesh made by createBucketMesh (the shared bucket and material stay). */
export function disposeBucketMesh(mesh) {
  mesh.geometry.dispose()
  mesh.dispose()
}

const _m = new Matrix4()
const _s = new Vector3()

/**
 * A single bucket: the one you carry. `setBucket(id)` restyles it (and its width),
 * `setWater(level)` fills it (0 empty to 1 brimming), `dispose()` frees what it owns.
 * The group's origin is the bucket's base; BUCKET_GRIP is where to hold it.
 */
export function createBucketModel() {
  const bucket = createBucketMesh(1)
  bucket.count = 1

  const group = new Group()
  group.add(bucket)
  let current = null

  group.setBucket = (id) => {
    if (id === current) return
    current = id
    bucket.setStyle(0, id)
    const w = bucketWidth(id)
    bucket.setMatrixAt(0, _m.makeScale(w, 1, w))
    bucket.instanceMatrix.needsUpdate = true
  }
  group.setWater = (level) => bucket.setLevel(0, Math.min(1, Math.max(0, level)))
  group.dispose = () => disposeBucketMesh(bucket)

  group.setBucket('pail')
  return group
}

/** Writes a bucket's matrix: base at `position`, turned by `quaternion`, `size` tall. */
export function bucketMatrix(position, quaternion, size, id, out) {
  const w = size * bucketWidth(id)
  return out.compose(position, quaternion, _s.set(w, size, w))
}
