/**
 * Prints the game's pacing as a sensible, greedy player plays it (sim-core.mjs): when
 * each purchase, rebirth and stage arrives, and how long the waits between purchases
 * are. Run it after any change to shared/balance.js:
 *
 *   node scripts/balance-sim.mjs [hours=6]
 *
 * Environment: TAPS (taps a second while training, default 4; 0 = an idle player),
 * TRAIN (seconds of training between runs, default 45), NO_WORLD2=1 (stay in World 1).
 */
import { BUCKETS, levelCap, STAGES, waterForLevel } from '../shared/balance.js'
import { formatNumber } from '../shared/format.js'
import { bucketById, reachStage, runPourSeconds } from '../shared/logic.js'
import { runSeconds } from '../shared/balance.js'
import { clock, purchaseGaps, simulate } from './sim-core.mjs'

const HOURS = Number(process.argv[2]) || 6
const result = simulate({
  hours: HOURS,
  taps: Number(process.env.TAPS ?? 4),
  train: Number(process.env.TRAIN) || 45,
  world2: process.env.NO_WORLD2 !== '1',
})
const { profile: p, log, purchases } = result

for (const { t: at, what } of log) console.log(`${clock(at)}  ${what}`)
console.log()
const best = Math.max(p.stats.bestStage, p.stats.bestStage2)
console.log(
  `After ${HOURS} h: R${p.rebirths}, level ${p.level}/${levelCap(p.rebirths)}, bucket ${bucketById(p.equippedBucket).name}, ` +
    `best stage ${best} (${STAGES[best].name}), ${formatNumber(p.stats.totalWins)} Wins earned, ${p.stats.runs} runs`,
)
const reach = reachStage(p)
console.log(`Cap Water R${p.rebirths}: ${formatNumber(waterForLevel(levelCap(p.rebirths)))}; run to stage ${reach}: ${Math.round(runSeconds(reach))} s walking + ${Math.round(runPourSeconds(p, reach))} s pouring`)
console.log(`Buckets owned ${p.ownedBuckets.length}/${BUCKETS.length}, ${purchases.length} purchases`)
for (const [from, to, label] of [
  [0, 3600, 'hour 1'],
  [3600, 7200, 'hour 2'],
  [7200, 4 * 3600, 'hours 3-4'],
  [4 * 3600, HOURS * 3600, `hours 5-${HOURS}`],
]) {
  const gaps = purchaseGaps(purchases, from, to)
  if (!gaps.length) continue
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
  console.log(`Waits between purchases, ${label}: ${gaps.length + 1} buys, average ${avg.toFixed(1)} min, longest ${Math.max(...gaps).toFixed(1)} min`)
}
