/**
 * How long the game lasts, for three kinds of player (sim-core.mjs plays each): when
 * they reach each stage milestone and escape, how far apart their rebirths and new
 * stages get, and their longest waits - the stretches where a player might give up.
 *
 *   node scripts/playtime-report.mjs [hours=20]
 */
import { LAST_STAGE } from '../shared/balance.js'
import { clock, simulate } from './sim-core.mjs'

const HOURS = Number(process.argv[2]) || 20
const PLAYERS = [
  { name: 'Keen (taps 4/s, trains 45 s a run)', taps: 4, train: 45 },
  { name: 'Casual (taps 2/s, trains 90 s a run)', taps: 2, train: 90 },
  { name: 'Idle (never taps, well only)', taps: 0, train: 120 },
]
const MILESTONES = [5, 9, 10, 15, 20, 30, 40, 50, LAST_STAGE]

/** The longest stretch with nothing new between `from` and `to` seconds, in minutes. */
function longestGap(times, from, to) {
  const edges = [from, ...times.filter((t) => t > from && t < to), to]
  let longest = 0
  for (let i = 1; i < edges.length; i += 1) longest = Math.max(longest, edges[i] - edges[i - 1])
  return longest / 60
}

for (const player of PLAYERS) {
  const run = simulate({ hours: HOURS, taps: player.taps, train: player.train })
  console.log(`\n== ${player.name}`)
  for (const world of [0, 1]) {
    const reached = run.stages.filter((s) => s.world === world)
    if (!reached.length) continue
    const at = (stage) => reached.find((s) => s.stage >= stage)?.t
    const line = MILESTONES.map((m) => `${m}: ${at(m) === undefined ? '-' : clock(at(m))}`).join('  ')
    console.log(`World ${world + 1} stages  ${line}`)
  }
  const r = run.rebirths
  const gaps = r.map((x, i) => x.t - (i ? r[i - 1].t : 0))
  const avgGap = (from, to) => {
    const g = gaps.filter((_, i) => r[i].t >= from * 3600 && r[i].t < to * 3600)
    return g.length ? `${(g.reduce((a, b) => a + b, 0) / g.length / 60).toFixed(1)} min (${g.length})` : '-'
  }
  console.log(`Rebirths: first at ${r[0] ? clock(r[0].t) : '-'}, ${r.length} in ${HOURS} h; apart: hour 1 ${avgGap(0, 1)}, hours 1-3 ${avgGap(1, 3)}, 3-6 ${avgGap(3, 6)}, 6-${HOURS} ${avgGap(6, HOURS)}`)
  const stageTimes = run.stages.map((s) => s.t)
  const buyTimes = run.purchases.map((p) => p.t)
  const windows = [
    [0, 1],
    [1, 3],
    [3, 6],
    [6, 10],
    [10, HOURS],
  ]
  console.log(`Longest with no new stage:  ${windows.map(([a, b]) => `${a}-${b} h ${longestGap(stageTimes, a * 3600, b * 3600).toFixed(0)} min`).join(', ')}`)
  console.log(`Longest with nothing to buy: ${windows.map(([a, b]) => `${a}-${b} h ${longestGap(buyTimes, a * 3600, b * 3600).toFixed(0)} min`).join(', ')}`)
  const last = run.purchases.find((p) => p.kind === 'bucket' && p.id === 'infinity')
  console.log(`Last bucket: ${last ? clock(last.t) : 'not yet'}; R${run.profile.rebirths}, level ${run.profile.level}`)
}
