import { isWellUnlocked } from '@shared/logic'
import {
  COURSE_START_Z,
  eggStandNear,
  FREE_REWARD,
  onCourse,
  onStartLine,
  portalAt,
  skipPadAt,
  SPHINX_STAND,
  stageAtZ,
  standAt,
  WELL_COUNT,
  wellAt,
  wellRect,
  winsPadAt,
} from '@shared/world'

import { sfx } from '../audio/sfx'
import { actions } from '../net/actions'
import { getGame, useGame } from '../store/game'
import { wellLabelSpec } from './labels/lobbyLabels'
import { updateWorldLabel } from './labels/registry'
import { runtime } from './runtime'

const TICK_MS = 100

function sameZone(a, b) {
  return (
    a.well === b.well &&
    a.wellNear === b.wellNear &&
    a.sphinx === b.sphinx &&
    a.stand === b.stand &&
    a.egg === b.egg &&
    a.portal === b.portal &&
    a.freeReward === b.freeReward &&
    a.stage === b.stage &&
    a.winsPad === b.winsPad &&
    a.skipPad === b.skipPad &&
    a.startLine === b.startLine
  )
}

/** Locked wells become solid walls for the controller; their signs say what's open. */
function syncWells(profile) {
  const walls = []
  for (let i = 0; i < WELL_COUNT; i += 1) {
    const unlocked = isWellUnlocked(profile, i)
    if (!unlocked) walls.push(wellRect(i))
    updateWorldLabel(`well-${i}`, wellLabelSpec(i, unlocked))
  }
  runtime.dynamicColliders = walls
}

/** What syncWells depends on, so it only runs when that changes. */
const wellKey = (profile) => `${profile.rebirths}:${profile.passes.wellVeryOp ? 1 : 0}${profile.passes.wellBest ? 1 : 0}`

/**
 * The 10 Hz bridge between the frame-rate world and the UI: works out where the player
 * stands - a well, a shop stand, the course and its pads - tells the authority about
 * well changes and Wins pads stepped on, and keeps locked-well walls in step with the
 * profile. This - not the render loop - is what writes zone state into the store, and
 * only when something actually changed.
 *
 * @returns {() => void} stop
 */
export function startGameTicker() {
  let lastWell = -1
  let lastWinsPad = -1
  let lastKey = wellKey(getGame().profile)

  syncWells(getGame().profile)
  const unsubscribe = useGame.subscribe((state, prev) => {
    if (state.profile === prev.profile) return
    const key = wellKey(state.profile)
    if (key === lastKey) return
    lastKey = key
    syncWells(state.profile)
  })

  const tick = () => {
    const game = getGame()
    const p = runtime.player.position
    const egg = eggStandNear(p.x, p.z)
    const course = onCourse(p.x, p.z)
    const zone = {
      well: wellAt(p.x, p.z, -0.2),
      // Standing at a well's edge (a locked one's wall stops you there).
      wellNear: wellAt(p.x, p.z, 1.8),
      sphinx: Math.hypot(p.x - SPHINX_STAND.x, p.z - SPHINX_STAND.z) < 5.5,
      stand: standAt(p.x, p.z),
      egg: egg ? egg.eggId : null,
      portal: portalAt(p.x, p.z)?.id ?? null,
      freeReward: Math.hypot(p.x - FREE_REWARD.x, p.z - FREE_REWARD.z) < FREE_REWARD.radius,
      stage: course && p.z < COURSE_START_Z ? stageAtZ(p.z) : -1,
      winsPad: course ? winsPadAt(p.x, p.z) : -1,
      skipPad: course ? skipPadAt(p.x, p.z) : -1,
      startLine: course && onStartLine(p.x, p.z),
    }
    if (!sameZone(zone, game.zone)) {
      if (zone.portal && zone.portal !== game.zone.portal) actions.portal()
      game.setZone(zone)
    }
    if (zone.well !== lastWell) {
      if (zone.well >= 0 && isWellUnlocked(game.profile, zone.well)) {
        actions.enterWell(zone.well)
        sfx.wellEnter()
      } else if (lastWell >= 0) actions.leaveWell()
      lastWell = zone.well
    }
    // Stepping onto a Wins pad claims it (and the server sends you home).
    if (zone.winsPad !== lastWinsPad) {
      if (zone.winsPad >= 1) actions.claim(zone.winsPad)
      lastWinsPad = zone.winsPad
    }
  }

  const id = setInterval(tick, TICK_MS)
  return () => {
    clearInterval(id)
    unsubscribe()
  }
}
