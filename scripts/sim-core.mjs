/**
 * Plays the game with the real rules (shared/logic.js) as a sensible, greedy player, and
 * reports what happened when: every purchase, rebirth and new stage. Used by
 * balance-sim.mjs (which prints it) and tune-economy.mjs (which sets the Wins prices
 * from it).
 *
 * The player: stands in the best well it has, tapping `taps` times a second (a steady,
 * human pace with breaks), for `train` seconds (or until it hits max level), then runs
 * the course - to a ledge it has never reached if it can fill the pit (chasing NEW
 * BEST), otherwise to the ledge that pays best for the time (logic.bestRunStage) - and
 * claims its Wins pad (picking up every coin on the way), then spends: the best bucket it can afford (any order), stars
 * on the bucket it carries, then passes and eggs. At max level it makes one run - out
 * to the furthest ledge it can, for its Wins - and rebirths, as an eager player does. Walking out and swimming (balance.runSeconds), and pouring every
 * pit on the way (logic.runPourSeconds), all cost time. No potions, no daily rewards,
 * no packs, no skips: a free player's floor.
 */
import { BUCKETS, EGGS, PETS, POUR_TAP, runSeconds, SHOP, TRAIN_INTERVAL, WELLS, WORLD_STAGES } from '../shared/balance.js'
import { formatNumber } from '../shared/format.js'
import {
  applyClaim,
  applyCoin,
  applyClick,
  applyRebirth,
  applyTrain,
  bestRunStage,
  bucketById,
  bucketPower,
  buyBucket,
  buyShopItem,
  createProfile,
  deletePet,
  equipBestPets,
  fusePets,
  fillStage,
  hatchEgg,
  isMaxLevel,
  isWellUnlocked,
  nextStarPrice,
  petMult,
  petMultiplier,
  reachStage,
  runPourSeconds,
  upgradeBucket,
  usePortal,
} from '../shared/logic.js'
import { mulberry32 } from '../shared/rng.js'
import { COINS_PER_LEDGE } from '../shared/world.js'

/** From the course's start back to the wells, and from the wells out to the start. */
const WALK_TO_WELL = 6

/**
 * @param {{ hours?: number, taps?: number, train?: number, world2?: boolean }} options
 * @returns {{ profile: object, log: {t: number, what: string}[],
 *   purchases: {t: number, kind: string, id: string, price: number}[],
 *   rebirths: {t: number, r: number}[], stages: {t: number, stage: number, world: number}[] }}
 */
export function simulate({ hours = 6, taps = 4, train = 45, world2 = true } = {}) {
  const rand = mulberry32(42)
  const p = createProfile('sim', 'Sim')
  let t = 0
  const log = []
  const purchases = []
  const rebirths = []
  const stages = []
  const mark = (what) => log.push({ t, what })
  const bought = (kind, id, price, what) => {
    purchases.push({ t, kind, id, price })
    mark(what)
  }

  const bestWell = () => {
    let best = 0
    for (let i = 0; i < WELLS.length; i += 1) if (isWellUnlocked(p, i) && WELLS[i].mult > WELLS[best].mult) best = i
    return best
  }

  function run() {
    const key = p.world === 1 ? 'bestStage2' : 'bestStage'
    const before = p.stats[key]
    const reach = reachStage(p)
    const stage = reach > before ? reach : bestRunStage(p)
    if (stage < 1) return
    // Tapping while it pours, as fast as it taps at the wells.
    t += runSeconds(stage) + runPourSeconds(p, stage) / (1 + taps * POUR_TAP) + WALK_TO_WELL
    // Every coin on the way out (they're on the path).
    for (let s = 1; s <= stage; s += 1) for (let i = 0; i < COINS_PER_LEDGE; i += 1) applyCoin(p, s, t * 1000)
    applyClaim(p, stage, t * 1000)
    const list = WORLD_STAGES[p.world]
    for (let s = before + 1; s <= p.stats[key]; s += 1) {
      stages.push({ t, stage: s, world: p.world })
      mark(`STAGE ${s} ${list[s].name} reached (+${formatNumber(list[s].discover)} Wins prize)`)
    }
    // Through the portal as soon as it opens.
    if (world2 && p.world === 0 && usePortal(p).ok) mark(`WORLD 2 with ${formatNumber(p.wins)} Wins`)
  }

  const eggAverage = (egg) => egg.pets.reduce((sum, [id, w]) => sum + PETS[id].mult * w, 0) / 100
  const weakestEquipped = () => {
    if (p.equippedPets.length < 3) return 0
    return Math.min(...p.equippedPets.map((uid) => petMult(p.pets.find((x) => x.uid === uid))))
  }

  /** Like a real player: fuses threes into golden ones, throws away pets it isn't using once the inventory fills up. */
  function tidyPets() {
    for (const id of new Set(p.pets.map((pet) => pet.id))) while (fusePets(p, id).ok) equipBestPets(p)
    if (p.pets.length < 30) return
    for (const pet of [...p.pets]) if (!p.equippedPets.includes(pet.uid)) deletePet(p, pet.uid)
  }

  /** The strongest bucket we could buy now that beats the one we carry, or null. */
  function bestBuy() {
    const carried = bucketPower(p, p.equippedBucket)
    let best = null
    for (const b of BUCKETS) {
      if (p.ownedBuckets.includes(b.id) || b.cost > p.wins || b.power <= carried) continue
      if (!best || b.power > best.power) best = b
    }
    return best
  }

  function spend() {
    tidyPets()
    for (;;) {
      const bucket = bestBuy()
      if (bucket) {
        buyBucket(p, bucket.id)
        bought('bucket', bucket.id, bucket.cost, `BUCKET ${bucket.name} (+${formatNumber(bucket.power)}) for ${formatNumber(bucket.cost)}`)
        continue
      }
      // Cheap old buckets, for the collection bonus.
      const cheap = BUCKETS.find((b) => !p.ownedBuckets.includes(b.id) && b.cost * 20 <= p.wins)
      if (cheap) {
        buyBucket(p, cheap.id)
        bought('bucket', cheap.id, cheap.cost, `BUCKET ${cheap.name} for the collection, ${formatNumber(cheap.cost)}`)
        continue
      }
      const star = nextStarPrice(p, p.equippedBucket)
      if (star !== null && star <= p.wins) {
        const r = upgradeBucket(p, p.equippedBucket)
        bought('star', p.equippedBucket, star, `STAR  ${bucketById(p.equippedBucket).name} ★${r.stars} for ${formatNumber(star)}`)
        continue
      }
      // Passes, cheapest first, once they're under a third of what we hold.
      const pass = Object.entries(SHOP)
        .filter(([id, item]) => item.kind === 'pass' && !p.passes[id] && item.price * 3 <= p.wins)
        .sort((a, b) => a[1].price - b[1].price)[0]
      if (pass) {
        buyShopItem(p, pass[0])
        bought('pass', pass[0], pass[1].price, `PASS  ${pass[1].name} for ${formatNumber(pass[1].price)}`)
        continue
      }
      // The best egg we can afford three of, whose pets would beat the weakest one we
      // have equipped, while it's under half of what we hold.
      const egg = Object.entries(EGGS)
        .filter(([, e]) => e.cost.wins * 6 <= p.wins && eggAverage(e) > weakestEquipped())
        .sort((a, b) => b[1].cost.wins - a[1].cost.wins)[0]
      if (egg && p.pets.length < 40) {
        const res = hatchEgg(p, egg[0], 3, { rand })
        if (res.ok) {
          equipBestPets(p)
          bought('egg', egg[0], egg[1].cost.wins * 3, `EGG   3x ${egg[1].name}: ${res.pets.map((x) => PETS[x.id].name).join(', ')} -> pets x${petMultiplier(p).toFixed(1)}`)
          continue
        }
      }
      break
    }
  }

  let rebirthAt = 0
  while (t < hours * 3600) {
    if (isMaxLevel(p)) {
      // At the cap: one run for the Wins, then rebirth.
      run()
      spend()
      const reached = reachStage(p)
      applyRebirth(p)
      rebirths.push({ t, r: p.rebirths })
      mark(
        `REBIRTH -> R${p.rebirths}  (${clock(t - rebirthAt)} since last) | bucket ${bucketById(p.equippedBucket).name}, pets x${petMultiplier(p).toFixed(1)}, ` +
          `stage ${reached}, wins ${formatNumber(p.wins)}`,
      )
      rebirthAt = t
      // Rebirth gift eggs: hatch them straight away.
      tidyPets()
      while ((p.items.eggVolcano || 0) > 0 && p.pets.length < 40) {
        const res = hatchEgg(p, 'volcano', 1, { paid: 'item', rand })
        if (!res.ok) break
        equipBestPets(p)
        mark(`GIFT  Volcano Egg: ${PETS[res.pets[0].id].name} -> pets x${petMultiplier(p).toFixed(1)}`)
      }
      continue
    }
    // Train for a while (at least until the first pit can be filled), or until capped.
    t += WALK_TO_WELL
    const well = bestWell()
    const until = t + train
    // One well scoop by itself every TRAIN_INTERVAL, and `taps` taps a second on top.
    const tapsPerScoop = Math.round(taps * TRAIN_INTERVAL * 10) / 10
    let owed = 0
    while (!isMaxLevel(p) && (t < until || fillStage(p.water) < 1)) {
      applyTrain(p, well, t * 1000)
      for (owed += tapsPerScoop; owed >= 1 && !isMaxLevel(p); owed -= 1) applyClick(p, well, t * 1000)
      t += TRAIN_INTERVAL
    }
    run()
    spend()
  }
  return { profile: p, log, purchases, rebirths, stages }
}

export const clock = (s) =>
  `${String(Math.floor(s / 3600)).padStart(1, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Minutes between one purchase and the next, from `from` to `to` seconds of play. */
export function purchaseGaps(purchases, from = 0, to = Infinity) {
  const times = purchases.map((x) => x.t).filter((x) => x >= from && x <= to)
  const gaps = []
  for (let i = 1; i < times.length; i += 1) gaps.push((times[i] - times[i - 1]) / 60)
  return gaps
}
