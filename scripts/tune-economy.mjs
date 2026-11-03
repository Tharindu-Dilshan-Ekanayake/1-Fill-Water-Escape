/**
 * Sets the buckets' Wins prices (and so their stars', which follow them) from how a
 * player actually earns Wins over HOURS hours of play, and writes them into
 * shared/balance.js.
 *
 *   node scripts/tune-economy.mjs          try the curves, print them, write the best
 *   node scripts/tune-economy.mjs --dry    the same, without writing
 *
 * Prices follow a curve: the first few buckets cost a run or two, and from there each
 * costs RATIO times the last, the ratio easing from `early` down to `late`. Late in the
 * game a player reaches about one new stage a rebirth and each pays about x1.45 more, so
 * a price curve much steeper than that makes every bucket a longer wait than the last.
 * Too gentle a curve and everything's bought in an afternoon, leaving nothing to save
 * for. For every curve tried, the sim (sim-core.mjs) plays HOURS hours and the curve is
 * scored on the longest wait for something to buy in each stretch of play (WINDOWS) and
 * on when the last bucket comes (LAST_BUCKET_HOURS).
 *
 * This and tune-progression.mjs move each other: prices change how fast
 * players grow, the boost how many Wins they have. After running one, check
 * scripts/playtime-report.mjs, and settle on a pair rather than alternating for ever.
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { BUCKETS } from '../shared/balance.js'
import { formatNumber } from '../shared/format.js'
import { purchaseGaps, simulate } from './sim-core.mjs'

const HOURS = 14
const DRY = process.argv.includes('--dry')
/** Fixed starting prices: the first bucket after the free Tiny Pail costs one Win. */
const START = [0, 1, 4, 15]
/**
 * What a good economy looks like for this player (sim-core's eager one): the longest
 * wait for something to buy in each stretch of play - short at first, never long later -
 * and the last bucket a goal for a long-time player, not done in an afternoon.
 */
const WINDOWS = [
  [0, 1, 3],
  [1, 2, 8],
  [2, 4, 15],
  [4, 7, 22],
  [7, 10, 25],
  [10, 14, 30],
]
const LAST_BUCKET_HOURS = [6, 10]

const niceRound = (n) => {
  if (n < 100) return Math.max(1, Math.round(n))
  const step = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.round(n / step) * step
}

function prices({ early, late, fade }) {
  const out = [...START]
  let cost = START[START.length - 1]
  for (let k = START.length; k < BUCKETS.length; k += 1) {
    cost *= late + (early - late) * Math.exp(-(k - START.length) / fade)
    out.push(niceRound(cost))
  }
  return out
}

function apply(costs) {
  BUCKETS.forEach((b, i) => {
    b.cost = costs[i]
  })
}

function score(curve) {
  apply(prices(curve))
  const run = simulate({ hours: HOURS })
  const at = (r) => (run.rebirths.find((x) => x.r === r)?.t ?? Infinity) / 60
  const last = run.purchases.find((x) => x.kind === 'bucket' && x.id === BUCKETS[BUCKETS.length - 1].id)
  const lastHours = last ? last.t / 3600 : Infinity
  let penalty = 0
  const waits = []
  for (const [from, to, limit] of WINDOWS) {
    const times = run.purchases.map((x) => x.t).filter((x) => x >= from * 3600 && x < to * 3600)
    // A stretch with nothing bought at all is the worst wait there is.
    const edges = [from * 3600, ...times, to * 3600]
    let longest = 0
    for (let i = 1; i < edges.length; i += 1) longest = Math.max(longest, (edges[i] - edges[i - 1]) / 60)
    waits.push(longest)
    penalty += Math.max(0, longest - limit) * 2 + longest / limit
  }
  if (lastHours < LAST_BUCKET_HOURS[0]) penalty += (LAST_BUCKET_HOURS[0] - lastHours) * 10
  if (lastHours > LAST_BUCKET_HOURS[1] && last) penalty += (lastHours - LAST_BUCKET_HOURS[1]) * 5
  if (!last) penalty += 15
  return { curve, score: penalty, waits, lastHours, r10: at(10), r20: at(20), buys: run.purchases.length }
}

const results = []
for (const early of [3.2, 3.5, 3.8]) {
  for (const late of [2.35, 2.45, 2.55]) {
    for (const fade of [7, 9, 11]) {
      const r = score({ early, late, fade })
      results.push(r)
      console.log(
        `early x${early} late x${late} fade ${fade}: longest waits ${r.waits.map((w) => w.toFixed(0)).join('/')} min, ` +
          `last bucket ${Number.isFinite(r.lastHours) ? r.lastHours.toFixed(1) + ' h' : 'not in 10 h'}, R10 ${r.r10.toFixed(0)} R20 ${r.r20.toFixed(0)} min, ${r.buys} buys -> ${r.score.toFixed(1)}`,
      )
    }
  }
}
results.sort((a, b) => a.score - b.score)
const best = results[0]
const costs = prices(best.curve)
console.log(`\nBest: early x${best.curve.early}, late x${best.curve.late}, fade ${best.curve.fade}`)
console.log(BUCKETS.map((b, i) => `${b.name} ${formatNumber(costs[i])}`).join(', '))

if (!DRY) {
  const file = new URL('../shared/balance.js', import.meta.url)
  let text = readFileSync(file, 'utf8')
  BUCKETS.forEach((b, i) => {
    const re = new RegExp(`(\\{ id: '${b.id}', name: '[^']*', power: [^,]+, cost: )[^,]+(,)`)
    if (!re.test(text)) throw new Error(`bucket ${b.id} not found in balance.js`)
    const value = costs[i] >= 1e6 ? costs[i].toExponential().replace('+', '').replace(/\.?0+e/, 'e') : String(costs[i])
    text = text.replace(re, `$1${value}$2`)
  })
  writeFileSync(file, text)
  console.log('wrote shared/balance.js')
}
