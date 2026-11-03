import { CatmullRomCurve3, Color, MeshBasicMaterial, TubeGeometry, Vector3 } from 'three'

import { COURSE_HALF_WIDTH } from '@shared/world'

import { glowTime } from '../glow'

/**
 * The course's water: the pools in its pits and the stream you pour them from. Unlit
 * (the colours do all the work), drawn in world-space patterns so pits of any size
 * ripple alike, and fogged like everything else. No textures.
 */

const WATER_HEAD = /* glsl */ `
  uniform float uTime;
  uniform float uHalf;
  varying vec3 vWaterPos;
`

/** Pools: two crossing swells, bright ripple crests, and foam against the walls. */
const POOL_FRAGMENT = /* glsl */ `
  {
    vec2 p = vWaterPos.xz;
    float w1 = sin(p.x * 0.9 + uTime * 1.7) * sin(p.y * 0.7 - uTime * 1.3);
    float w2 = sin((p.x + p.y) * 1.6 - uTime * 2.4);
    float crest = smoothstep(0.62, 0.98, w1 * 0.5 + 0.5 + w2 * 0.16);
    vec3 col = mix(vec3(0.05, 0.5, 0.95), vec3(0.32, 0.84, 1.0), 0.5 + 0.5 * w1);
    col = mix(col, vec3(0.9, 0.98, 1.0), crest * 0.55);
    float wall = uHalf - abs(p.x);
    float foam = 1.0 - smoothstep(0.0, 0.7 + 0.25 * sin(p.y * 3.0 + uTime * 2.0), wall);
    col = mix(col, vec3(1.0), foam * 0.75);
    diffuseColor.rgb *= col;
  }
`

/** The stream: bright bands rushing along it from the bucket to the pool, in its colour (uStreamTint). */
const STREAM_FRAGMENT = /* glsl */ `
  {
    float band = fract(vStreamUv.x * 7.0 - uTime * 4.0);
    float edge = abs(vStreamUv.y - 0.5) * 2.0;
    vec3 col = mix(uStreamTint, vec3(0.95, 1.0, 1.0), smoothstep(0.55, 1.0, band) * 0.8 + edge * 0.25);
    diffuseColor.rgb *= col;
  }
`

/**
 * The colour of the Water you pour (a cosmetic, balance.STREAMS): set its `value` and
 * the stream follows.
 */
export const streamTint = { value: new Color(0.2, 0.75, 1.0) }

function waterMaterial({ fragment, stream = false, opacity }) {
  const material = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = glowTime
    shader.uniforms.uHalf = { value: COURSE_HALF_WIDTH }
    if (stream) shader.uniforms.uStreamTint = streamTint
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WATER_HEAD}${stream ? 'varying vec2 vStreamUv;' : ''}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 waterWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          waterWorld = instanceMatrix * waterWorld;
        #endif
        vWaterPos = (modelMatrix * waterWorld).xyz;
        ${stream ? 'vStreamUv = uv;' : ''}`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_HEAD}${stream ? 'varying vec2 vStreamUv;\nuniform vec3 uStreamTint;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragment}`)
  }
  material.customProgramCacheKey = () => (stream ? 'water-stream-v1' : 'water-pool-v1')
  return material
}

/** The pools' material, for an InstancedMesh of flat quads (instance colour tints them). */
export const createPoolMaterial = () => waterMaterial({ fragment: POOL_FRAGMENT, opacity: 0.86 })

/** The stream's material. */
export const createStreamMaterial = () => waterMaterial({ fragment: STREAM_FRAGMENT, stream: true, opacity: 0.95 })

/**
 * The stream's shape, made once: a tube from the origin (the bucket's lip) along +Z to
 * (0, -1, 1), arcing up a little first, and fanning out as it falls - a narrow gush at
 * the lip, a broad splash at the bottom. Placed per frame by scaling Y by the drop and Z
 * by the reach (stretching a thin tube that way just flattens it a bit) and turning it
 * to face the landing point.
 */
export function createStreamGeometry(segments = 20) {
  const points = []
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8
    points.push(new Vector3(0, 0.5 * t * (1 - t) * 0.9 - t * t, t))
  }
  const curve = new CatmullRomCurve3(points)
  const geometry = new TubeGeometry(curve, segments, 0.16, 10, false)
  // Widen it along its length: each ring of vertices pushed out from the curve.
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const centre = new Vector3()
  const v = new Vector3()
  for (let i = 0; i < position.count; i += 1) {
    const along = uv.getX(i)
    curve.getPointAt(Math.min(1, along), centre)
    v.fromBufferAttribute(position, i).sub(centre).multiplyScalar(0.75 + 1.6 * along * along).add(centre)
    position.setXYZ(i, v.x, v.y, v.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** Pool tints: plain water, and a Skip pad's gold. */
export const WATER_WHITE = new Color('#ffffff')
export const WATER_GOLD = new Color('#ffd84a')
