/**
 * Sets the late-game rebirth boost (REBIRTH_BOOST in shared/balance.js) from the
 * balance sim, so no rebirth ever takes much longer than the ones before it - no wall
 * late in the game - and the two worlds take about as long as we want them to.
 *
 *   node scripts/tune-progression.mjs          try them, print them, write the best
 *   node scripts/tune-progression.mjs --dry    the same, without writing
 *
 * For each boost tried, sim-core's keen player plays HOURS hours; the boost is scored
 * on its longest rebirth (after the first hour), its longest stretch without a new
 * stage, and when it escapes each world (TARGETS, in hours).
 *
 * This and tune-economy.mjs move each other: prices change how fast
 * players grow, the boost how many Wins they have. After running one, check
 * scripts/playtime-report.mjs, and settle on a pair rather than alternating for ever.
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { LAST_STAGE, REBIRTH_BOOST } from '../shared/balance.js'
import { clock, simulate } from './sim-core.mjs'

const HOURS = 30
const DRY = process.argv.includes('--dry')
/** Escape World 1 and World 2 within these many hours of play (the keen sim player). */
const TARGETS = { world1: [4.5, 6], world2: [12, 16] }
/** No rebirth, and no stretch without a new stage, longer than this many minutes. */
const MAX_REBIRTH_MIN = 25
const MAX_NO_STAGE_MIN = 40

function longestGap(times, from, to) {
  const edges = [from, ...times.filter((t) => t > from && t < to), to]
  let longest = 0
  for (let i = 1; i < edges.length; i += 1) longest = Math.max(longest, edges[i] - edges[i - 1])
  return longest / 60
}

function score(boost, from) {
  REBIRTH_BOOST.mult = boost
  REBIRTH_BOOST.from = from
  const run = simulate({ hours: HOURS })
  const escape = (world) => run.stages.find((s) => s.world === world && s.stage === LAST_STAGE)?.t ?? Infinity
  const w1 = escape(0) / 3600
  const w2 = escape(1) / 3600
  const end = Math.min(HOURS * 3600, escape(1))
  const rebirths = run.rebirths.filter((r) => r.t <= end)
  let longestRebirth = 0
  rebirths.forEach((r, i) => {
    if (r.t > 3600) longestRebirth = Math.max(longestRebirth, (r.t - (i ? rebirths[i - 1].t : 0)) / 60)
  })
  const noStage = longestGap(
    run.stages.map((s) => s.t),
    0,
    end,
  )
  let penalty = 0
  const off = (value, [lo, hi]) => (value < lo ? lo - value : value > hi ? value - hi : 0)
  penalty += off(w1, TARGETS.world1) * 3 + off(Math.min(w2, HOURS + 10), TARGETS.world2) * 2
  penalty += Math.max(0, longestRebirth - MAX_REBIRTH_MIN) / 5 + Math.max(0, noStage - MAX_NO_STAGE_MIN) / 5
  return { boost, from, w1, w2, longestRebirth, noStage, rebirths: rebirths.length, score: penalty }
}

const results = []
for (const boost of [1.4, 1.45, 1.5, 1.55, 1.6, 1.65]) {
  for (const from of [15, 18, 21, 24]) {
    const r = score(boost, from)
    results.push(r)
    console.log(
      `boost x${boost} from R${from}: World 1 escaped ${Number.isFinite(r.w1) ? clock(r.w1 * 3600) : 'never'}, World 2 ${Number.isFinite(r.w2) ? clock(r.w2 * 3600) : 'never'}, ` +
        `longest rebirth ${r.longestRebirth.toFixed(0)} min, longest without a new stage ${r.noStage.toFixed(0)} min, ${r.rebirths} rebirths -> ${r.score.toFixed(2)}`,
    )
  }
}
results.sort((a, b) => a.score - b.score)
const best = results[0]
console.log(`\nBest: x${best.boost} from R${best.from}`)

if (!DRY) {
  const file = new URL('../shared/balance.js', import.meta.url)
  let text = readFileSync(file, 'utf8')
  const re = /export const REBIRTH_BOOST = \{ mult: [\d.]+, from: \d+ \}/
  if (!re.test(text)) throw new Error('REBIRTH_BOOST not found in balance.js')
  text = text.replace(re, `export const REBIRTH_BOOST = { mult: ${best.boost}, from: ${best.from} }`)
  writeFileSync(file, text)
  console.log('wrote shared/balance.js')
}
