import { Vector3 } from 'three'

import { CLICK_RATE, coopSpeed, LAST_STAGE, POUR_TAP } from '@shared/balance'
import { canPour, pourSeconds } from '@shared/logic'
import { atPitRim, COURSE_HALF_WIDTH, onCourse, PIT_DEPTH, pitFarZ, pitNearZ, pitRect } from '@shared/world'

import { remotePlayers } from '../../net/remotePlayers'
import { burst } from '../fx/fxQueue'
import { runtime } from '../runtime'

/**
 * Your pits this run, on screen: how full each one is, and the one you're pouring into.
 *
 * Standing at the rim of the next pit you tip your bucket out and it fills - as fast as
 * your Water Power pours (logic.pourSeconds): a moment for an early pit when you're
 * strong, half a minute and more for a big one when you're only just strong enough, not
 * at all when you're too weak for it. Walk off and it stops where it is; come back and
 * it carries on. The authority (session.pourTick) pours the same way and says when a pit
 * is full (`confirm`, from its 'pit' event); only then does the wall across its rim
 * (runtime.pitWall) go and you can swim across. Back in the lobby the run is over and
 * every pit drains for the next one. A Skip pad fills a pit from afar, in gold.
 *
 * `updatePits` runs once a frame (Course.jsx); Player.jsx reads `open` to know which pits
 * hold water to swim in; the HUD reads `pourInfo`. Plain module state: nothing here
 * touches React.
 */

/** Pits empty this fast (of a full pit per second) once you're back in the lobby. */
const DRAIN_RATE = 0.7
/** A pit the authority says is full (or a skipped one) tops up this fast to the brim. */
const TOP_UP_RATE = 1.6
/** The water's surface sits this far under the rims (the floor) when a pit is full. */
const BRIM = 0.06
/** Filled by our own reckoning, a pit waits here for the authority to say it's full. */
const ALMOST = 0.985

export const pits = {
  /** 0..1 per pit (index = stage): how full it is now. */
  level: new Float32Array(LAST_STAGE + 1),
  /** 1 -> 0 after a Skip pad fills a pit: its water glows gold, fading. */
  gold: new Float32Array(LAST_STAGE + 1),
  /** The furthest pit the authority says is full this run: you can swim every pit up to it. */
  open: 0,
  /** The pit you're pouring into right now, or -1. */
  pouring: -1,
  /** Bumped when a pit fills (`filled` = its stage) or you try one too deep (`short`). */
  events: { filled: -1, short: -1, id: 0 },
}

/**
 * What the HUD's pour meter shows, refreshed every frame: the next pit this run, how
 * full it is (0-1), seconds left at your pour rate (Infinity if you're too weak for it),
 * whether you're at its rim, and whether you're out on the course at all.
 */
export const pourInfo = { stage: 1, fill: 0, secondsLeft: 0, atRim: false, onCourse: false, weak: false, helpers: 0 }

/** Height of a pit's water surface at fill `level` (0 = dry, 1 = brimming). */
export const waterY = (level) => -PIT_DEPTH + level * (PIT_DEPTH - BRIM)

const pourPoint = new Vector3()
runtime.pitWall = pitRect(1)
/** The pit we last told the player was too deep, so it's said once per try. */
let saidShort = -1

function event(kind, stage) {
  pits.events.filled = kind === 'filled' ? stage : -1
  pits.events.short = kind === 'short' ? stage : -1
  pits.events.id += 1
}

/** The authority says pit `stage` is full (its 'pit' event): open it, all the way up. */
export function confirmPit(stage) {
  if (stage < 1 || stage > LAST_STAGE || stage <= pits.open) return
  for (let s = pits.open + 1; s <= stage; s += 1) if (pits.level[s] < ALMOST) pits.level[s] = Math.max(pits.level[s], ALMOST)
  pits.open = stage
  event('filled', stage)
}

/** Taps that would still count right now (refilling at CLICK_RATE a second), as the authority counts them. */
let tapTokens = CLICK_RATE
let tapAt = 0

/**
 * A tap of the screen: if you're pouring, it pours POUR_TAP seconds' worth more at
 * once (as the authority will, for the taps it counts) with a splash where it lands.
 */
export function tapPit(profile) {
  const now = performance.now()
  tapTokens = Math.min(CLICK_RATE, tapTokens + ((now - tapAt) / 1000) * CLICK_RATE)
  tapAt = now
  if (tapTokens < 1) return
  tapTokens -= 1
  const s = pits.pouring
  if (s < 0) return
  const seconds = pourSeconds(profile, s)
  pits.level[s] = Math.min(ALMOST, pits.level[s] + (seconds > 0 ? POUR_TAP / seconds : 1))
  const at = runtime.player.pourAt
  if (at) burst({ x: at.x, y: at.y + 0.2, z: at.z, count: 12, speed: 6.5, palette: 'water' })
}

/** A Skip pad filled pit `stage` for you (the authority's 'skip' event): in gold. */
export function skipFill(stage) {
  if (stage < 1 || stage > LAST_STAGE) return
  pits.gold[stage] = 1
}

/** Empties every pit at once (a new world: different course, same pits). */
export function resetPits() {
  pits.level.fill(0)
  pits.gold.fill(0)
  pits.open = 0
  pits.pouring = -1
  runtime.pitWall = pitRect(1)
}

/** Advances every pit by `delta` seconds for a player at `pos` with `profile`. */
export function updatePits(delta, profile, pos) {
  const course = onCourse(pos.x, pos.z)
  const next = pits.open + 1
  pourInfo.onCourse = course
  pourInfo.stage = Math.min(LAST_STAGE, next)
  pits.pouring = -1

  if (!course) {
    // Back in the lobby: the run's over and the pits drain for the next one.
    pits.open = 0
    saidShort = -1
    for (let s = 1; s <= LAST_STAGE; s += 1) {
      if (pits.level[s] > 0) pits.level[s] = Math.max(0, pits.level[s] - DRAIN_RATE * delta)
      pits.gold[s] = 0
    }
  } else if (next <= LAST_STAGE) {
    const rim = atPitRim(next, pos.x, pos.z)
    // Others at the same rim pour with you (as the authority counts them).
    let helpers = 0
    if (rim) for (const r of remotePlayers.values()) if (atPitRim(next, r.position.x, r.position.z)) helpers += 1
    pourInfo.helpers = helpers
    const seconds = pourSeconds(profile, next) / coopSpeed(helpers)
    pourInfo.atRim = rim
    pourInfo.weak = !canPour(profile, next)
    if (rim && !pourInfo.weak) {
      // Pouring: the water rises as fast as the authority will fill it.
      pits.pouring = next
      pits.level[next] = Math.min(ALMOST, pits.level[next] + (seconds > 0 ? delta / seconds : 1))
    } else if (rim && saidShort !== next) {
      saidShort = next
      event('short', next)
    }
    if (!rim && saidShort === next) saidShort = -1
    pourInfo.fill = pits.level[next]
    pourInfo.secondsLeft = pourInfo.weak ? Infinity : (1 - pits.level[next]) * seconds
  }

  // Filled pits top up to the brim; skipped ones glow gold, fading.
  for (let s = 1; s <= pits.open; s += 1) {
    if (pits.level[s] < 1) pits.level[s] = Math.min(1, pits.level[s] + TOP_UP_RATE * delta)
    if (pits.gold[s] > 0) pits.gold[s] = Math.max(0, pits.gold[s] - delta * 0.6)
  }
  runtime.pitWall = pits.open < LAST_STAGE ? pitRect(pits.open + 1) : null

  // Where your stream lands while you pour: on the water, a few metres out.
  if (pits.pouring >= 0) {
    const s = pits.pouring
    const z = Math.max(pitFarZ(s) + 2, Math.min(pitNearZ(s) - 3, pos.z - 4.8))
    pourPoint.set(Math.max(-COURSE_HALF_WIDTH + 1.5, Math.min(COURSE_HALF_WIDTH - 1.5, pos.x)), waterY(pits.level[s]), z)
    runtime.player.pourAt = pourPoint
  } else {
    runtime.player.pourAt = null
  }
}

