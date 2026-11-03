/**
 * The player's body language, shared by the Bloxity avatar and the blocky stand-in so
 * both move the same way.
 *
 * `computePose` turns the motion state into joint angles; each avatar applies them to
 * its own limbs. Angles are radians in character space (the character faces +Z, its
 * left side is +X), about each joint's pivot:
 *   swing - about X: negative swings a limb forward (arm up in front, knee up)
 *   sway  - about Z: positive moves a limb towards +X
 *   twist - about Y: positive turns the right shoulder forward
 * `lift` raises (or, to keep bent legs on the ground, lowers) the body, in metres.
 */

export const POSED_BONES = [
  'Spine1',
  'Neck1',
  'ArmL1',
  'ArmL2',
  'ArmR1',
  'ArmR2',
  'LegL1',
  'LegL2',
  'LegR1',
  'LegR2',
]

/** Written by `computePose` every frame; one shared result, never reallocated. */
export const pose = {
  lift: 0,
  bones: Object.fromEntries(POSED_BONES.map((name) => [name, { swing: 0, sway: 0, twist: 0 }])),
}

/** Sway sign that moves a limb away from the body, per side. */
const OUT_L = 1
const OUT_R = -1

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Adds to a joint, scaled by weight `w`. */
function add(name, swing, sway, twist, w) {
  const b = pose.bones[name]
  b.swing += swing * w
  b.sway += sway * w
  b.twist += twist * w
}

/** Relaxed stance: arms hanging a little out from the sides, knees soft, breathing. */
function stance(w, time) {
  const breath = Math.sin(time * 1.8)
  add('LegL1', -0.04, 0.06 * OUT_L, 0, w)
  add('LegL2', 0.08, 0, 0, w)
  add('LegR1', 0.04, 0.06 * OUT_R, 0, w)
  add('LegR2', 0.08, 0, 0, w)
  add('Spine1', -0.03 + breath * 0.015, 0, 0, w)
  add('ArmL1', -0.08 + breath * 0.03, 0.14 * OUT_L, 0, w)
  add('ArmL2', -0.25, 0, 0, w)
  add('ArmR1', -0.08 + breath * 0.03, 0.14 * OUT_R, 0, w)
  add('ArmR2', -0.25, 0, 0, w)
  pose.lift += (-0.01 + breath * 0.006) * w
}

/**
 * Walk to sprint: arms and legs swing against each other, the body leans in and bobs
 * once per step. `phase` advances faster with speed, so the steps quicken.
 */
function stride(phase, ratio) {
  const cycle = Math.sin(phase)
  const leg = 0.85 * ratio
  const arm = 0.75 * ratio
  add('LegL1', cycle * leg, 0, 0, 1)
  add('LegR1', -cycle * leg, 0, 0, 1)
  // Knees fold on the back swing only.
  add('LegL2', Math.max(0, -cycle) * 1.1 * ratio, 0, 0, 1)
  add('LegR2', Math.max(0, cycle) * 1.1 * ratio, 0, 0, 1)
  add('ArmL1', -cycle * arm, 0.08 * OUT_L * ratio, 0, 1)
  add('ArmR1', cycle * arm, 0.08 * OUT_R * ratio, 0, 1)
  add('ArmL2', -(0.35 + Math.max(0, -cycle) * 0.5) * ratio, 0, 0, 1)
  add('ArmR2', -(0.35 + Math.max(0, cycle) * 0.5) * ratio, 0, 0, 1)
  add('Spine1', -(0.08 + 0.14 * ratio) * ratio, 0, cycle * 0.12 * ratio, 1)
  pose.lift += (Math.abs(Math.cos(phase)) * 0.05 - 0.015) * ratio
}

/**
 * In the air: one knee up and the arms out on the way up; falling, the legs straighten
 * and reach down for the ground.
 */
function airborne(vy) {
  const f = smooth(0, 1, clamp01((2 - vy) / 9))
  add('LegL1', lerp(-1.3, -0.35, f), 0.08 * OUT_L, 0, 1)
  add('LegL2', lerp(1.6, 0.25, f), 0, 0, 1)
  add('LegR1', lerp(0.25, -0.1, f), 0.08 * OUT_R, 0, 1)
  add('LegR2', lerp(0.5, 0.2, f), 0, 0, 1)
  add('ArmL1', lerp(-0.35, -0.6, f), lerp(1.15, 1.45, f) * OUT_L, 0, 1)
  add('ArmL2', -0.35, 0, 0, 1)
  add('ArmR1', lerp(-0.25, -0.5, f), lerp(1.05, 1.35, f) * OUT_R, 0, 1)
  add('ArmR2', -0.4, 0, 0, 1)
  add('Spine1', lerp(-0.15, 0.06, f), 0, 0, 1)
}

/**
 * Carrying the bucket in the right hand: the arm held a little out from the side with
 * the elbow bent, so the bucket hangs clear of the legs, swinging less than a free arm.
 */
function carrying(w) {
  add('ArmR1', -0.12, 0.2 * OUT_R, 0, w)
  add('ArmR2', -0.55, 0, 0, w)
}

/**
 * Hauling Water out of a well: one full "heave-ho" every SCOOP_CYCLE seconds (faster
 * while you tap), `phase` 0..1 through it, keyframed (SCOOP_KEYS) and eased between:
 *   0.00  the full bucket held high in the right hand, the left arm out for balance
 *   0.18  wind-up: leaning back, the bucket swung up behind the head in both hands
 *   0.36  the plunge: a deep bow, both arms thrust down into the well - the bucket goes
 *         in mouth first and the water sprays up (SCOOP_SPLASH)
 *   0.50  down in the water, filling, the arms shaking with the weight
 *   0.70  hauled up to the chest, elbows bent
 *   0.86  heaved up high on tiptoe, Water slopping over the rim (SCOOP_SPILL)
 * Each key also sets how far the bucket is tipped forward (`tilt`, radians) and how full
 * it looks (`water`, 0-1): the Water you held goes into you on the wind-up.
 */
export const SCOOP_CYCLE = 1.2
export const SCOOP_SPLASH = 0.4
export const SCOOP_SPILL = 0.84

const key = (t, lift, tilt, water, b) => ({ t, lift, tilt, water, bones: b })
const SCOOP_TROPHY = key(0, 0.03, -0.1, 1, {
  Spine1: [0.12, 0, 0],
  Neck1: [-0.15, 0, 0],
  ArmR1: [-2.45, 0.22 * OUT_R, 0],
  ArmR2: [-0.25, 0, 0],
  ArmL1: [-0.55, 0.75 * OUT_L, 0],
  ArmL2: [-0.35, 0, 0],
  LegL1: [-0.08, 0.06 * OUT_L, 0],
  LegL2: [0.1, 0, 0],
  LegR1: [0.06, 0.06 * OUT_R, 0],
  LegR2: [0.1, 0, 0],
})
const SCOOP_KEYS = [
  SCOOP_TROPHY,
  key(0.18, 0, -0.45, 0.3, {
    Spine1: [0.32, 0, -0.15],
    Neck1: [-0.3, 0, 0],
    ArmR1: [-2.95, 0.12 * OUT_R, 0],
    ArmR2: [-0.7, 0, 0],
    ArmL1: [-2.7, 0.18 * OUT_L, 0],
    ArmL2: [-0.7, 0, 0],
    LegL1: [-0.3, 0.08 * OUT_L, 0],
    LegL2: [0.35, 0, 0],
    LegR1: [0.2, 0.08 * OUT_R, 0],
    LegR2: [0.25, 0, 0],
  }),
  key(0.36, -0.26, 1.35, 0.25, {
    Spine1: [-1.05, 0, 0.1],
    Neck1: [0.4, 0, 0],
    ArmR1: [-0.95, 0.04 * OUT_R, 0],
    ArmR2: [-0.12, 0, 0],
    ArmL1: [-1.05, 0.12 * OUT_L, 0],
    ArmL2: [-0.2, 0, 0],
    LegL1: [-0.62, 0.08 * OUT_L, 0],
    LegL2: [1.05, 0, 0],
    LegR1: [-0.4, 0.08 * OUT_R, 0],
    LegR2: [0.85, 0, 0],
  }),
  key(0.5, -0.3, 1.0, 1, {
    Spine1: [-1.12, 0, -0.05],
    Neck1: [0.45, 0, 0],
    ArmR1: [-0.78, 0.04 * OUT_R, 0],
    ArmR2: [-0.1, 0, 0],
    ArmL1: [-0.88, 0.12 * OUT_L, 0],
    ArmL2: [-0.15, 0, 0],
    LegL1: [-0.66, 0.08 * OUT_L, 0],
    LegL2: [1.12, 0, 0],
    LegR1: [-0.45, 0.08 * OUT_R, 0],
    LegR2: [0.9, 0, 0],
  }),
  key(0.7, -0.06, 0.05, 1, {
    Spine1: [-0.18, 0, 0],
    Neck1: [0.05, 0, 0],
    ArmR1: [-1.35, 0.14 * OUT_R, 0],
    ArmR2: [-1.65, 0, 0],
    ArmL1: [-1.25, 0.2 * OUT_L, 0],
    ArmL2: [-1.55, 0, 0],
    LegL1: [-0.22, 0.07 * OUT_L, 0],
    LegL2: [0.38, 0, 0],
    LegR1: [-0.12, 0.07 * OUT_R, 0],
    LegR2: [0.3, 0, 0],
  }),
  key(0.86, 0.12, -0.2, 1, {
    Spine1: [0.22, 0, 0],
    Neck1: [-0.3, 0, 0],
    ArmR1: [-2.65, 0.2 * OUT_R, 0],
    ArmR2: [-0.15, 0, 0],
    ArmL1: [-0.45, 1.0 * OUT_L, 0],
    ArmL2: [-0.3, 0, 0],
    LegL1: [-0.05, 0.05 * OUT_L, 0],
    LegL2: [0.04, 0, 0],
    LegR1: [0.05, 0.05 * OUT_R, 0],
    LegR2: [0.04, 0, 0],
  }),
  { ...SCOOP_TROPHY, t: 1 },
]

/** The two keys `phase` lies between, and how far (eased) from the first to the second. */
const scoopSpan = { a: SCOOP_TROPHY, b: SCOOP_TROPHY, s: 0 }
function findSpan(phase) {
  const x = clamp01(phase)
  let i = 0
  while (i < SCOOP_KEYS.length - 2 && x >= SCOOP_KEYS[i + 1].t) i += 1
  const a = SCOOP_KEYS[i]
  const b = SCOOP_KEYS[i + 1]
  scoopSpan.a = a
  scoopSpan.b = b
  scoopSpan.s = smooth(0, 1, (x - a.t) / (b.t - a.t))
  return scoopSpan
}

/** How far the bucket is tipped forward (radians) at `phase` of a scoop. */
export function scoopBucketTilt(phase) {
  const { a, b, s } = findSpan(phase)
  return lerp(a.tilt, b.tilt, s)
}

/** How full the bucket looks (0-1) at `phase` of a scoop. */
export function scoopWater(phase) {
  const { a, b, s } = findSpan(phase)
  return lerp(a.water, b.water, s)
}

/** The right arm's swing at `phase` of a scoop, for figures with no more joints than that. */
export function scoopArm(phase) {
  const { a, b, s } = findSpan(phase)
  return lerp(a.bones.ArmR1[0], b.bones.ArmR1[0], s) + lerp(a.bones.Spine1[0], b.bones.Spine1[0], s)
}

function scooping(phase, time, w) {
  const { a, b, s } = findSpan(phase)
  for (const name in a.bones) {
    const from = a.bones[name]
    const to = b.bones[name]
    add(name, lerp(from[0], to[0], s), lerp(from[1], to[1], s), lerp(from[2], to[2], s), w)
  }
  pose.lift += lerp(a.lift, b.lift, s) * w
  // Down in the water, the arms shake with the weight of the filling bucket.
  const strain = smooth(0.38, 0.44, phase) * (1 - smooth(0.52, 0.6, phase))
  const shake = Math.sin(time * 34) * 0.07 * strain
  add('ArmR1', shake, 0, 0, w)
  add('ArmL1', -shake, 0, 0, w)
}

/** Pouring at a pit's rim: both arms up and out in front, tipping the bucket over. */
function pouring(time, w) {
  const shake = Math.sin(time * 14) * 0.04
  add('ArmR1', -1.55 + shake, 0.1 * OUT_R, 0, w)
  add('ArmR2', -0.35, 0, 0, w)
  add('ArmL1', -1.7 - shake, 0.35 * OUT_L, 0, w)
  add('ArmL2', -0.6, 0, 0, w)
  add('Spine1', 0.08, 0, 0, w)
  add('Neck1', 0.25, 0, 0, w)
  add('LegL1', -0.2, 0.06 * OUT_L, 0, w)
  add('LegR1', 0.15, 0.06 * OUT_R, 0, w)
}

/**
 * Swimming. The holder lies the body down flat on the water as you get going (see
 * `swimTilt`); this is the pose within that. Moving (`ratio` of top speed): a front
 * crawl - one arm reaching forward over the water while the other pulls through under
 * it, the body rolling with each stroke, legs flutter-kicking, head up to see ahead.
 * Still: treading water, arms sculling out to the sides, legs cycling. `stroke` is the
 * stroke cycle's phase (radians), advanced by the holder.
 */
function swimming(time, stroke, ratio, w) {
  const tread = 1 - ratio
  const scull = Math.sin(time * 4)
  add('ArmL1', -0.35 * tread, (1 + scull * 0.3) * OUT_L * tread, 0, w)
  add('ArmR1', -0.35 * tread, (1 - scull * 0.3) * OUT_R * tread, 0, w)
  add('ArmL2', -0.7 * tread, 0, 0, w)
  add('ArmR2', -0.7 * tread, 0, 0, w)
  add('LegL1', Math.sin(time * 3) * 0.35 * tread, 0.1 * OUT_L, 0, w)
  add('LegR1', -Math.sin(time * 3) * 0.35 * tread, 0.1 * OUT_R, 0, w)
  add('LegL2', (0.5 + 0.3 * Math.max(0, Math.sin(time * 3))) * tread, 0, 0, w)
  add('LegR2', (0.5 + 0.3 * Math.max(0, -Math.sin(time * 3))) * tread, 0, 0, w)

  // The crawl: each arm goes all the way round, half a turn behind the other - from
  // reaching out ahead (-PI) it pulls down through the water to the hip (0), then
  // recovers, elbow bent, up over the back to the front again.
  const left = (stroke % (Math.PI * 2)) - Math.PI
  const right = ((stroke + Math.PI) % (Math.PI * 2)) - Math.PI
  add('ArmL1', left * ratio, 0.18 * OUT_L * ratio, 0, w)
  add('ArmR1', right * ratio, 0.18 * OUT_R * ratio, 0, w)
  add('ArmL2', -0.9 * Math.max(0, Math.sin(left)) * ratio, 0, 0, w)
  add('ArmR2', -0.9 * Math.max(0, Math.sin(right)) * ratio, 0, 0, w)
  const kick = Math.sin(time * 11) * 0.32
  add('LegL1', kick * ratio, 0.05 * OUT_L * ratio, 0, w)
  add('LegR1', -kick * ratio, 0.05 * OUT_R * ratio, 0, w)
  add('LegL2', 0.2 * ratio, 0, 0, w)
  add('LegR2', 0.2 * ratio, 0, 0, w)
  add('Spine1', -0.08 * ratio, 0, Math.sin(stroke) * 0.3 * ratio, w)
  add('Neck1', -0.75 * ratio, 0, -Math.sin(stroke) * 0.2 * ratio, w)
}

/**
 * How far to lie the body down while swimming, radians forward about its feet, for
 * `swim` (0-1) at `ratio` of top speed: nearly upright treading water, flat out in the
 * crawl. With `swimLift`, what holders turn and raise the body by.
 */
export const swimTilt = (swim, ratio) => swim * (0.22 + 1.2 * clamp01(ratio))

/**
 * Turned down by `tilt`, how far to raise the body (`lift`) and move it back (`back`,
 * along its facing) so its hips float just under the surface, `depth` above the feet,
 * right over where the swimmer is.
 */
export function swimLift(tilt, depth, out) {
  const hip = 0.9
  out.lift = Math.max(0, depth - 0.12 - hip * Math.cos(tilt))
  out.back = hip * Math.sin(tilt)
  return out
}

/** Arms up and waving, bouncing on the spot: the celebration once you've stopped. */
function cheering(time, w) {
  const wave = Math.sin(time * 10) * 0.28
  add('ArmL1', -2.7 + wave, 0.38 * OUT_L, 0, w)
  add('ArmR1', -2.7 - wave, 0.38 * OUT_R, 0, w)
  add('ArmL2', -0.25, 0, 0, w)
  add('ArmR2', -0.25, 0, 0, w)
  add('LegL1', -0.12, 0.06 * OUT_L, 0, w)
  add('LegR1', -0.12, 0.06 * OUT_R, 0, w)
  add('LegL2', 0.22, 0, 0, w)
  add('LegR2', 0.22, 0, 0, w)
  add('Spine1', 0.1, 0, 0, w)
  add('Neck1', -0.15, 0, 0, w)
  pose.lift += Math.abs(Math.sin(time * 7)) * 0.16 * w
}

/**
 * @param {{ time?: number, speed?: number, maxSpeed?: number, grounded?: boolean,
 *   vy?: number, stride?: number, carry?: number, scoop?: number, pour?: number,
 *   swim?: number, stroke?: number, flick?: number, cheer?: number, emote?: string|null }} motion
 *   `carry` (0-1) holds the bucket in the right hand; `scoop` is how far (0-1) through a
 *   haul from a well (below 0: not scooping; see SCOOP_KEYS); `pour` (0-1) tips the bucket out at a pit;
 *   `swim` (0-1) is swimming, `speed` then the swimming speed and `stroke` the phase of
 *   the stroke (radians); `flick` (0-1) swings the bucket up for a tap; `cheer` (0-1)
 *   waves.
 *   `emote` is a Boxity emote id to play over this pose, or null. It isn't posed here:
 *   the Bloxity avatar blends the emote clip on top of this pose (avatarRig.updateEmote),
 *   so the same motion object drives both. `emoteFromAnim(r.anim)` in bloxity/emotes.js
 *   turns another player's synced anim ('emote:<id>') into this field.
 */
export function computePose(motion) {
  const {
    time = 0,
    speed = 0,
    maxSpeed = 6,
    grounded = true,
    vy = 0,
    stride: phase = time * 5,
    carry = 0,
    scoop = -1,
    pour = 0,
    swim = 0,
    stroke = 0,
    flick = 0,
    cheer = 0,
  } = motion
  for (const name of POSED_BONES) {
    const b = pose.bones[name]
    b.swing = 0
    b.sway = 0
    b.twist = 0
  }
  pose.lift = 0
  const ratio = clamp01(speed / Math.max(maxSpeed, 0.001))

  if (swim > 0) {
    swimming(time, stroke, ratio, swim)
    if (swim >= 1) return pose
  }
  const land = 1 - swim
  if (scoop >= 0 && scoop <= 1) {
    scooping(scoop, time, land)
  } else if (grounded) {
    stance((1 - smooth(0.05, 0.4, ratio)) * land, time)
    if (ratio > 0.02) {
      // Walking with the bucket: only the free arm swings fully.
      stride(phase, ratio * land)
      add('ArmR1', Math.sin(phase) * -0.45 * ratio * carry, 0, 0, land)
    }
    if (carry > 0) carrying(carry * land * (1 - pour))
    if (pour > 0) pouring(time, pour * land)
    // A tap's flick: the bucket swung up in front and back down.
    if (flick > 0) add('ArmR1', -1.1, 0.1 * OUT_R, 0, flick * land)
    if (cheer > 0) cheering(time, cheer * land)
  } else {
    airborne(vy)
  }
  return pose
}
