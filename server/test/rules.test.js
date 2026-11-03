import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AD_REWARDS,
  BUCKET_STARS,
  BUCKETS,
  CLICK_RATE,
  CO_OP_MAX,
  CO_OP_TIP,
  COIN_SHARE,
  COLLECTION_BONUS,
  coopSpeed,
  DAILY_INTERVAL_MS,
  GEM_PRODUCTS,
  GOLDEN_BOOST,
  GOLDEN_FUSE,
  LAST_STAGE,
  levelCap,
  isMegaStage,
  MEGA_CAPACITY,
  MEGA_CHESTS,
  MEGA_EVERY,
  MEGA_LENGTH,
  nextRebirthGift,
  PETS,
  pitLength,
  POUR_AT_MIN,
  POUR_MIN_SECONDS,
  QUEST_BONUS,
  QUEST_REWARDS,
  QUESTS,
  QUESTS_PER_DAY,
  REBIRTH_BOOST,
  rebirthGift,
  rebirthMultiplier,
  runSeconds,
  STAGES,
  STAR_POWER,
  starPrice,
  STREAMS,
  TRAILS,
  TUTORIAL,
  waterForLevel,
  WEEKLY_REWARDS,
  WORLD_PORTALS,
  WORLD_STAGES,
  WORLDS,
} from '../../shared/balance.js'
import { formatNumber } from '../../shared/format.js'
import {
  advanceQuest,
  applyAdReward,
  applyClaim,
  applyGemProduct,
  applyRebirth,
  applySkip,
  applyWeeklyReward,
  applyTrain,
  buyBucket,
  buyCosmetic,
  buyWaterPack,
  bestRunStage,
  bucketPower,
  canPour,
  collectionMultiplier,
  createRun,
  createProfile,
  createSession,
  currentQuests,
  petMult,
  petMultiplier,
  pourInto,
  pourSeconds,
  questDay,
  questsFor,
  fillStage,
  fusePets,
  gainMultiplier,
  levelFor,
  nextStarPrice,
  normalizeProfile,
  reachStage,
  runPourSeconds,
  rebirthSkipPrice,
  skipPrice,
  skipRebirth,
  upgradeBucket,
  usePortal,
  waterPacks,
  weekOf,
  winsInWeek,
  world2Open,
} from '../../shared/logic.js'
import { PlayerSession } from '../../shared/session.js'
import {
  coinAt,
  COINS_PER_LEDGE,
  coinsOf,
  COURSE_END_Z,
  courseFloorAt,
  courseLimitZ,
  ledgeRect,
  COURSE_HALF_WIDTH,
  LEDGE_LENGTH,
  PIT_DEPTH,
  pitFarZ,
  pitNearZ,
  PORTALS,
  skipPad,
  SPAWN,
  stageAtZ,
  START_LINE,
  SWIM_DEPTH,
  WELL_X,
  wellCenterZ,
  winsPad,
} from '../../shared/world.js'

const inWell = (i) => ({ x: WELL_X, y: 0.5, z: wellCenterZ(i) })
const onWinsPad = (stage) => ({ ...winsPad(stage) })
const onSkipPad = (stage) => ({ ...skipPad(stage) })
const onStart = () => ({ x: 0, y: 0, z: (START_LINE.minZ + START_LINE.maxZ) / 2 })

/** A session for a fresh profile, recording every event it emits and every teleport. */
function makeSession(pos, profile = createProfile('a', 'A')) {
  const events = []
  const teleports = []
  const session = new PlayerSession(profile, {
    now: 0,
    emit: (type, payload) => events.push({ type, payload }),
    getPosition: () => pos,
    onTeleport: (to) => {
      teleports.push(to)
      Object.assign(pos, to)
    },
  })
  return { session, profile, events, teleports, count: (type) => events.filter((e) => e.type === type).length }
}

/** Scoops in well 0 until max level. */
function maxOut(p) {
  for (let i = 0; i < 1e5 && p.level < levelCap(p.rebirths); i += 1) applyTrain(p, 0, 0)
}

// --- Formatting ------------------------------------------------------------------

test('numbers format like the HUD', () => {
  assert.deepEqual(
    [0, 999, 1000, 1234, 7300, 14000, 2.5e6, 9999].map(formatNumber),
    ['0', '999', '1K', '1.2K', '7.3K', '14K', '2.5M', '9.9K'],
  )
})

// --- Levels and rebirth ----------------------------------------------------------

test('max level is 15 + 8 per rebirth; each rebirth adds x1 to gains', () => {
  assert.deepEqual([0, 1, 2, 3].map(levelCap), [15, 23, 31, 39])
  assert.deepEqual([0, 1, 2, 3].map(rebirthMultiplier), [1, 2, 3, 4])
})

test('each level needs more Water than the last', () => {
  assert.equal(waterForLevel(1), 0)
  for (let level = 2; level <= 60; level += 1) {
    assert.ok(waterForLevel(level) > waterForLevel(level - 1), `level ${level}`)
  }
  assert.equal(levelFor(0, 0), 1)
  assert.equal(levelFor(waterForLevel(15) - 1, 0), 14)
  assert.equal(levelFor(1e12, 0), 15, 'never past the cap')
  assert.equal(levelFor(1e12, 1), 23)
})

test('the first well gives the bucket power per scoop and stops at max level', () => {
  const p = createProfile('a', 'A')
  for (let i = 0; i < 10; i += 1) applyTrain(p, 0, 0)
  assert.equal(p.water, 10)
  maxOut(p)
  assert.equal(p.water, waterForLevel(15))
  assert.equal(p.level, 15)
  assert.equal(applyTrain(p, 0, 0).gain, 0, 'no more natural gains at max level')
  assert.equal(p.water, waterForLevel(15))
})

test('locked wells give nothing', () => {
  const p = createProfile('a', 'A')
  assert.equal(applyTrain(p, 1, 0).ok, false)
  assert.equal(p.water, 0)
})

test('better buckets add power, rebirths multiply it', () => {
  const p = createProfile('a', 'A')
  // Just the one bucket, so the collection bonus stays out of it.
  p.ownedBuckets = ['beach']
  p.equippedBucket = 'beach'
  applyTrain(p, 0, 0)
  assert.equal(p.water, BUCKETS[1].power)
  p.rebirths = 1
  p.water = 0
  p.level = 1
  applyTrain(p, 0, 0)
  assert.equal(p.water, BUCKETS[1].power * 2)
  applyTrain(p, 1, 0)
  assert.equal(p.water, BUCKETS[1].power * 2 + BUCKETS[1].power * 2 * 2, 'the Spring Well is x2 on top')
})

test('every bucket in your collection adds COLLECTION_BONUS to all your Water', () => {
  const p = createProfile('a', 'A')
  assert.equal(collectionMultiplier(p), 1, 'the free Tiny Pail alone')
  p.ownedBuckets = BUCKETS.slice(0, 5).map((b) => b.id)
  assert.ok(Math.abs(collectionMultiplier(p) - (1 + 4 * COLLECTION_BONUS)) < 1e-12)
  const one = createProfile('b', 'B')
  assert.ok(Math.abs(gainMultiplier(p, 0) / gainMultiplier(one, 0) - collectionMultiplier(p)) < 1e-12)
  p.ownedBuckets = BUCKETS.map((b) => b.id)
  assert.ok(Math.abs(collectionMultiplier(p) - 1.46) < 1e-9, 'all 24: +46%')
})

test('cosmetics: pour colours and trails, bought once with Wins, shown at will, kept in saves', () => {
  const p = createProfile('a', 'A')
  assert.equal(p.cosmetics.stream, 'water')
  assert.equal(p.cosmetics.trail, 'none')
  assert.equal(buyCosmetic(p, 'stream', 'mint').ok, false, 'not enough Wins')
  p.wins = STREAMS.mint.price + TRAILS.bubbles.price
  assert.deepEqual(buyCosmetic(p, 'stream', 'mint'), { ok: true, kind: 'stream', id: 'mint', bought: true })
  assert.deepEqual(buyCosmetic(p, 'trail', 'bubbles'), { ok: true, kind: 'trail', id: 'bubbles', bought: true })
  assert.equal(p.wins, 0)
  assert.equal(buyCosmetic(p, 'stream', 'water').bought, false, 'back to the free one, no charge')
  assert.equal(buyCosmetic(p, 'stream', 'mint').bought, false)
  assert.equal(buyCosmetic(p, 'trail', 'mint').ok, false, 'a colour is not a trail')
  assert.equal(buyCosmetic(p, 'hat', 'mint').ok, false)
  const saved = normalizeProfile({ ...JSON.parse(JSON.stringify(p)), cosmetics: { owned: ['mint', 'bubbles', 'bogus'], stream: 'mint', trail: 'fire' } }, 'a', 'A')
  assert.deepEqual(saved.cosmetics, { owned: ['water', 'none', 'mint', 'bubbles'], stream: 'mint', trail: 'none' })
  // Dearer the further down each list, for a late game's Wins.
  for (const list of [STREAMS, TRAILS]) {
    const prices = Object.values(list).map((c) => c.price)
    assert.equal(prices[0], 0)
    for (let i = 1; i < prices.length; i += 1) assert.ok(prices[i] > prices[i - 1] * 100)
  }
})

test('three of a pet fuse into a Golden one, with twice the bonus', () => {
  const p = createProfile('a', 'A')
  for (let i = 0; i < 4; i += 1) p.pets.push({ uid: p.nextPetUid++, id: 'fox' })
  p.equippedPets = [p.pets[0].uid]
  assert.equal(fusePets(p, 'cat').ok, false, 'none of those')
  const result = fusePets(p, 'fox')
  assert.equal(result.ok, true)
  assert.equal(result.pet.golden, true)
  assert.equal(p.pets.length, 2, 'three in, one out')
  assert.ok(p.pets.some((pet) => pet.uid === p.equippedPets[0]), 'the equipped one was kept: the spares went first')
  assert.ok(p.equippedPets.includes(result.pet.uid), 'into a free slot')
  assert.equal(petMult(result.pet), 1 + (PETS.fox.mult - 1) * GOLDEN_BOOST)
  assert.ok(Math.abs(petMultiplier(p) - (1 + (PETS.fox.mult - 1) * (1 + GOLDEN_BOOST))) < 1e-9)
  assert.equal(fusePets(p, 'fox').ok, false, 'golden ones do not fuse again')
  assert.equal(normalizeProfile(JSON.parse(JSON.stringify(p)), 'a', 'A').pets.find((pet) => pet.golden).id, 'fox')
  assert.equal(GOLDEN_FUSE, 3)
})

test("the weekly board counts Wins earned since Monday; last week's top 10 get eggs, once", () => {
  const monday = (weekOf(Date.UTC(2026, 10, 2)) + 4 / 7) * 7 * DAILY_INTERVAL_MS
  assert.equal(new Date(monday).getUTCDay(), 1, 'weeks start on Monday')
  assert.equal(weekOf(monday + 6.99 * DAILY_INTERVAL_MS), weekOf(monday))
  assert.equal(weekOf(monday + 7 * DAILY_INTERVAL_MS), weekOf(monday) + 1)
  const p = createProfile('a', 'A')
  p.water = STAGES[3].need
  applyClaim(p, 3, monday + 1000)
  const first = p.weekly.wins
  assert.ok(first > 0 && first === p.stats.totalWins)
  const week = weekOf(monday)
  // Next week: a fresh count, last week's kept for its reward.
  const next = monday + 7 * DAILY_INTERVAL_MS
  applyClaim(p, 3, next + 1000)
  assert.equal(p.weekly.week, week + 1)
  assert.deepEqual(p.weekly.prev, { week, wins: first })
  assert.equal(winsInWeek(p, week), first)
  assert.equal(applyWeeklyReward(p, week, 11), null, 'outside the top 10')
  assert.deepEqual(applyWeeklyReward(p, week, 2), WEEKLY_REWARDS[1])
  assert.equal(p.items[WEEKLY_REWARDS[1].item], WEEKLY_REWARDS[1].amount)
  assert.equal(applyWeeklyReward(p, week, 1), null, 'once a week')
  assert.equal(applyWeeklyReward(createProfile('b', 'B'), week, 1), null, 'not without playing that week')
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p)), 'a', 'A').weekly, p.weekly)
})

test('rebirth needs max level, resets Water and skips, keeps Wins and buckets', () => {
  const p = createProfile('a', 'A')
  assert.equal(applyRebirth(p).ok, false)
  maxOut(p)
  p.wins = 50
  p.skipTo = 12
  p.ownedBuckets.push('beach')
  assert.equal(applyRebirth(p).ok, true)
  assert.equal(p.rebirths, 1)
  assert.equal(p.water, 0)
  assert.equal(p.level, 1)
  assert.equal(p.skipTo, 0)
  assert.equal(p.wins, 50)
  assert.deepEqual(p.ownedBuckets, ['pail', 'beach'])
})

test('skipping to a rebirth costs Wins', () => {
  const p = createProfile('a', 'A')
  const price = rebirthSkipPrice(p)
  p.wins = price - 1
  assert.equal(skipRebirth(p).ok, false)
  assert.equal(p.rebirths, 0)
  p.wins = price + 5
  assert.equal(skipRebirth(p).ok, true)
  assert.equal(p.rebirths, 1)
  assert.equal(p.wins, 5)
  assert.equal(p.water, 0)
})

// --- The course ------------------------------------------------------------------

test('each pit needs more Water and each ledge pays more Wins than the last', () => {
  assert.equal(STAGES.length, 60)
  assert.equal(STAGES[0].need, 0)
  for (let i = 2; i <= LAST_STAGE; i += 1) {
    assert.ok(STAGES[i].need > STAGES[i - 1].need, `need ${i}`)
    assert.ok(STAGES[i].wins > STAGES[i - 1].wins, `wins ${i}`)
  }
})

test('Water Power decides which pits you can fill, and how fast', () => {
  assert.equal(fillStage(0), 0)
  assert.equal(fillStage(STAGES[1].need - 1), 0)
  assert.equal(fillStage(STAGES[1].need), 1)
  assert.equal(fillStage(STAGES[5].need), 5)
  assert.equal(fillStage(1e30), LAST_STAGE)
  const p = createProfile('a', 'A')
  p.water = STAGES[3].need
  assert.equal(reachStage(p), 3)
  assert.equal(canPour(p, 3), true)
  assert.equal(canPour(p, 4), false, 'too weak')
  assert.equal(pourSeconds(p, 4), Infinity)
  // At exactly a pit's minimum it takes POUR_AT_MIN seconds; twice as strong, half that.
  assert.ok(Math.abs(pourSeconds(p, 3) - POUR_AT_MIN(3)) < 1e-9)
  p.water = STAGES[3].need * 2
  assert.ok(Math.abs(pourSeconds(p, 3) - POUR_AT_MIN(3) / 2) < 1e-9)
  // Never quicker than a moment, however strong.
  p.water = 1e30
  assert.equal(pourSeconds(p, 1), POUR_MIN_SECONDS)
  // Further pits hold far more, and take longer at their own minimum.
  // (A Mega Pit is bigger still, so the pit after it is compared with the one before it.)
  for (let s = 2; s <= LAST_STAGE; s += 1) {
    const before = isMegaStage(s - 1) ? s - 2 : s - 1
    assert.ok(STAGES[s].capacity > STAGES[before].capacity * 1.5, `capacity ${s}`)
    assert.ok(POUR_AT_MIN(s) >= POUR_AT_MIN(s - 1))
  }
})

test('every tenth pit is a Mega Pit: longer, fuller, and its ledge opens a treasure chest', () => {
  for (const world of [0, 1]) {
    const stages = WORLD_STAGES[world]
    for (let s = MEGA_EVERY; s <= LAST_STAGE; s += MEGA_EVERY) {
      assert.ok(isMegaStage(s))
      assert.ok(!isMegaStage(s + 1))
      assert.ok(pitLength(s) >= pitLength(s - 1) + MEGA_LENGTH)
      assert.ok(Math.abs(stages[s].capacity / (stages[s].need * POUR_AT_MIN(s)) - MEGA_CAPACITY) < 1e-9)
      assert.ok(MEGA_CHESTS[world][s], `world ${world + 1} stage ${s} has a chest`)
    }
  }
  // Reaching ledge 10 for the first time opens its chest - once.
  const p = createProfile('a', 'A')
  p.water = STAGES[MEGA_EVERY].need
  const first = applyClaim(p, MEGA_EVERY, 0)
  const chest = MEGA_CHESTS[0][MEGA_EVERY]
  assert.deepEqual(first.chests, [{ stage: MEGA_EVERY, ...chest }])
  assert.equal(p.items[chest.item], chest.amount)
  assert.ok(first.prize >= STAGES[MEGA_EVERY].discover)
  assert.equal(STAGES[MEGA_EVERY].discover > STAGES[MEGA_EVERY + 1].discover, true, 'a Mega prize')
  const again = applyClaim(p, MEGA_EVERY, 0)
  assert.deepEqual(again.chests, [])
  assert.equal(p.items[chest.item], chest.amount)
})

test('a run fills one pit at a time, as long as you stand at its rim', () => {
  const p = createProfile('a', 'A')
  p.water = STAGES[2].need
  const run = createRun()
  const first = pourSeconds(p, 1)
  assert.equal(pourInto(run, p, first / 2), 0)
  assert.ok(Math.abs(run.pour - 0.5) < 1e-9)
  assert.equal(pourInto(run, p, first / 2 + 1e-6), 1)
  assert.deepEqual(run, { open: 1, pour: 0 })
  assert.equal(pourInto(run, p, 1000), 2)
  assert.equal(pourInto(run, p, 1000), 0, 'pit 3 is too much for them')
  assert.equal(run.open, 2)
})

test('the course is a wide, level corridor, its pits longer the further it goes', () => {
  assert.ok(COURSE_HALF_WIDTH >= 14)
  for (let s = 1; s < LAST_STAGE; s += 1) {
    assert.equal(pitNearZ(s) - pitFarZ(s), pitLength(s))
    if (!isMegaStage(s)) assert.ok(pitLength(s + 1) >= pitLength(s))
    assert.equal(ledgeRect(s).maxZ, pitFarZ(s))
    assert.equal(ledgeRect(s).maxZ - ledgeRect(s).minZ, LEDGE_LENGTH)
    assert.equal(ledgeRect(s).minZ, pitNearZ(s + 1), 'the next pit starts where the ledge ends')
    assert.equal(stageAtZ(pitNearZ(s) - 0.1), s)
    assert.equal(stageAtZ(ledgeRect(s).minZ + 0.1), s)
    assert.equal(courseFloorAt((ledgeRect(s).minZ + ledgeRect(s).maxZ) / 2, 0).height, 0, 'every ledge at ground level')
  }
  assert.ok(pitLength(LAST_STAGE) > pitLength(1) * 2)
  assert.ok(COURSE_END_Z < pitFarZ(LAST_STAGE))
  // Water in a filled pit is level with the floor; you swim with your feet below it.
  const mid = (pitNearZ(4) + pitFarZ(4)) / 2
  assert.deepEqual(courseFloorAt(mid, 4), { height: -SWIM_DEPTH, swim: true })
  assert.deepEqual(courseFloorAt(mid, 3), { height: -PIT_DEPTH, swim: false })
  // Nobody may pass the near rim of a pit they haven't filled.
  assert.equal(courseLimitZ(3), pitNearZ(4))
  assert.equal(courseLimitZ(LAST_STAGE), COURSE_END_Z)
})

test('a Wins pad pays only once its pit is filled; a first-visit prize only once', () => {
  const p = createProfile('a', 'A')
  p.water = STAGES[2].need
  assert.equal(applyClaim(p, 2, 0, 1).ok, false, 'pit 2 not filled this run')
  assert.equal(applyClaim(p, 3, 0).ok, false, 'too weak for pit 3')
  const first = applyClaim(p, 2, 0, 2)
  assert.equal(first.ok, true)
  assert.equal(first.wins, STAGES[2].wins)
  assert.deepEqual(first.discovered, [1, 2])
  assert.equal(first.prize, STAGES[1].discover + STAGES[2].discover)
  assert.equal(first.best, true)
  assert.equal(p.water, STAGES[2].need, 'Water is kept')
  const second = applyClaim(p, 2, 0, 2)
  assert.equal(second.prize, 0)
  assert.equal(second.best, false)
  assert.equal(p.wins, first.wins + first.prize + second.wins)
  assert.equal(p.stats.runs, 2)
  p.passes.winsX2 = true
  assert.equal(applyClaim(p, 1, 0, 2).wins, STAGES[1].wins * 2)
})

test('the first run pays for the second bucket, as the guide asks', () => {
  const p = createProfile('a', 'A')
  p.water = TUTORIAL[0].water
  const r = applyClaim(p, reachStage(p), 0)
  assert.ok(r.ok && r.wins >= BUCKETS[1].cost)
})

test('the Skip pad fills a pit (and those before it) every run until rebirth', () => {
  const p = createProfile('a', 'A')
  p.water = STAGES[4].need
  const price = skipPrice(p, 5)
  assert.ok(price >= STAGES[5].wins * 2, 'never a way to make Wins')
  p.wins = price - 1
  assert.equal(applySkip(p, 5).ok, false, 'not enough Wins')
  p.wins = price * 10
  assert.deepEqual(applySkip(p, 5), { ok: true, stage: 5, price })
  assert.equal(p.wins, price * 9)
  assert.equal(applySkip(p, 5).ok, false, 'already skipped')
  assert.equal(reachStage(p), 5)
  assert.equal(pourSeconds(p, 5), 0, 'fills at once')
  assert.equal(pourSeconds(p, 3), 0, 'and so do the ones before it')
  p.water = STAGES[8].need
  assert.equal(reachStage(p), 8, 'more Water reaches past the skips')
  maxOut(p)
  applyRebirth(p)
  assert.equal(p.skipTo, 0, 'until you rebirth')
})

test('Water packs grow with you, but only up to your max level', () => {
  const p = createProfile('a', 'A')
  const early = waterPacks(p)
  p.water = waterForLevel(10)
  p.level = levelFor(p.water, 0)
  const later = waterPacks(p)
  assert.ok(later[0].amount > early[0].amount)
  assert.ok(later[2].amount > later[0].amount)
  p.wins = later[0].price - 1
  assert.equal(buyWaterPack(p, 0).ok, false)
  p.wins = later[0].price
  const before = p.water
  assert.equal(buyWaterPack(p, 0).ok, true)
  assert.equal(p.water, Math.min(waterForLevel(15), before + later[0].amount))
  assert.equal(p.wins, 0)
  p.wins = 1e9
  buyWaterPack(p, 2)
  assert.equal(p.water, waterForLevel(15), 'no further than max level')
  assert.equal(p.level, 15)
  assert.equal(buyWaterPack(p, 0).ok, false, 'at max level: rebirth')
})

// --- Buying ----------------------------------------------------------------------

test('any bucket can be bought, in any order; you carry the best you own', () => {
  const p = createProfile('a', 'A')
  p.wins = BUCKETS[3].cost + BUCKETS[1].cost
  assert.equal(buyBucket(p, BUCKETS[3].id).ok, true, 'skipping ahead is fine')
  assert.equal(p.equippedBucket, BUCKETS[3].id)
  assert.equal(buyBucket(p, BUCKETS[1].id).ok, true, 'and going back')
  assert.equal(p.equippedBucket, BUCKETS[3].id, 'a weaker bucket is not put on')
  assert.equal(p.wins, 0)
  assert.equal(buyBucket(p, 'nope').ok, false)
  assert.equal(buyBucket(p, BUCKETS[5].id).ok, false, 'not enough Wins')
  assert.equal(buyBucket(p, BUCKETS[1].id).ok, true, 'one you own is just equipped')
  assert.equal(p.equippedBucket, BUCKETS[1].id)
})

test('stars upgrade a bucket you own, each a part of the next bucket\'s price', () => {
  const p = createProfile('a', 'A')
  const id = BUCKETS[10].id
  p.ownedBuckets = [id]
  p.equippedBucket = id
  assert.equal(upgradeBucket(p, BUCKETS[11].id).ok, false, 'not owned')
  let spent = 0
  for (let star = 1; star <= BUCKET_STARS; star += 1) {
    const price = nextStarPrice(p, id)
    assert.equal(price, starPrice(10, star))
    p.wins = price
    assert.deepEqual(upgradeBucket(p, id), { ok: true, bucketId: id, stars: star, price })
    spent += price
  }
  assert.equal(nextStarPrice(p, id), null)
  p.wins = 1e30
  assert.equal(upgradeBucket(p, id).ok, false, 'fully upgraded')
  assert.ok(Math.abs(bucketPower(p, id) - BUCKETS[10].power * STAR_POWER ** BUCKET_STARS) < 1e-6)
  // All eight stars: less than the next bucket costs, and less of a step than it.
  assert.ok(spent < BUCKETS[11].cost)
  assert.ok(bucketPower(p, id) < BUCKETS[11].power)
  // Stars count in every scoop (with room below the max level for it).
  p.rebirths = 9
  p.water = 0
  p.level = 1
  applyTrain(p, 0, 0)
  const scoop = BUCKETS[10].power * STAR_POWER ** BUCKET_STARS * 10
  assert.ok(Math.abs(p.water - scoop) <= scoop * 1e-6 + 0.1, `${p.water} vs ${scoop}`)
  // And they're kept in saves, only for buckets you own.
  const saved = normalizeProfile({ ...JSON.parse(JSON.stringify(p)), bucketStars: { [id]: 8, galaxy: 3, beach: 9 } }, 'a', 'A')
  assert.deepEqual(saved.bucketStars, { [id]: 8 })
})

test('the last bucket\'s stars never run out, each dearer than the last', () => {
  const p = createProfile('a', 'A')
  const last = BUCKETS[BUCKETS.length - 1].id
  p.ownedBuckets.push(last)
  p.equippedBucket = last
  let previous = 0
  for (let star = 1; star <= BUCKET_STARS + 6; star += 1) {
    const price = nextStarPrice(p, last)
    assert.ok(price > previous, `star ${star}`)
    previous = price
    p.wins = price
    assert.equal(upgradeBucket(p, last).ok, true)
  }
  assert.equal(p.bucketStars[last], BUCKET_STARS + 6)
  assert.equal(normalizeProfile(JSON.parse(JSON.stringify(p)), 'a', 'A').bucketStars[last], BUCKET_STARS + 6)
})

test('every Wins price is a reachable goal: stars between buckets, buckets about x3 apart', () => {
  for (let k = 1; k < BUCKETS.length; k += 1) {
    const ratio = BUCKETS[k].cost / Math.max(1, BUCKETS[k - 1].cost)
    assert.ok(BUCKETS[k].power > BUCKETS[k - 1].power)
    if (k > 3) assert.ok(ratio > 1.8 && ratio < 4.5, `bucket ${k} costs x${ratio.toFixed(2)} the last`)
    for (let star = 1; star <= BUCKET_STARS; star += 1) {
      assert.ok(starPrice(k, star) < BUCKETS[Math.min(BUCKETS.length - 1, k + 1)].cost || k === BUCKETS.length - 1)
      if (star > 1) assert.ok(starPrice(k, star) >= starPrice(k, star - 1))
    }
  }
})

// --- Boxity products -------------------------------------------------------------

test('Gems products grant passes, and an owned pass turns into Wins', () => {
  const p = createProfile('a', 'A')
  const first = applyGemProduct(p, 'water_x2')
  assert.equal(first.ok, true)
  assert.equal(p.passes.waterX2, true)
  assert.equal(p.wins, 0)
  const again = applyGemProduct(p, 'water_x2')
  assert.ok(again.wins >= 10)
  assert.equal(p.wins, again.wins)
  assert.equal(p.stats.totalWins, again.wins)
  applyGemProduct(p, 'auto_win')
  assert.equal(p.settings.autoWin, true)
  applyGemProduct(p, 'potion_bundle')
  assert.deepEqual(p.items, { potionWater: 3, potionWins: 3 })
  assert.equal(applyGemProduct(p, 'nope').ok, false)
  for (const sku of Object.keys(GEM_PRODUCTS)) assert.equal(applyGemProduct(createProfile('b', 'B'), sku).ok, true, sku)
})

test('ad rewards have a cooldown per placement', () => {
  const p = createProfile('a', 'A')
  const s = createSession(0)
  const [placement] = Object.keys(AD_REWARDS)
  const t0 = 1_000_000
  assert.equal(applyAdReward(p, s, placement, t0).ok, true)
  assert.equal(p.items.potionWater, 1)
  assert.equal(applyAdReward(p, s, placement, t0 + 1000).ok, false)
  assert.equal(applyAdReward(p, s, placement, t0 + AD_REWARDS[placement].cooldownMs).ok, true)
  assert.equal(applyAdReward(p, s, 'nope', t0).ok, false)
})

// --- Saves -----------------------------------------------------------------------

test('old or corrupt saves load with defaults filled in', () => {
  const p = normalizeProfile(
    { water: 'x', wins: -5, skipTo: 999, pets: [{ uid: 1, id: 'nope' }], equippedPets: [1], ownedBuckets: ['nope'], equippedBucket: 'nope', stats: { runs: 3 } },
    'x',
    'X',
  )
  assert.equal(p.water, 0)
  assert.equal(p.wins, 0)
  assert.equal(p.skipTo, LAST_STAGE)
  assert.deepEqual(p.pets, [])
  assert.deepEqual(p.equippedPets, [])
  assert.deepEqual(p.ownedBuckets, ['pail'])
  assert.equal(p.equippedBucket, 'pail')
  assert.equal(p.stats.runs, 3)
  assert.equal(p.stats.bestStage, 0)
  assert.deepEqual(p.settings, { autoRebirth: false, autoWin: false })
  assert.deepEqual(normalizeProfile(null, 'y', 'Y'), createProfile('y', 'Y'))
  assert.equal(normalizeProfile({ water: waterForLevel(5) }, 'z', 'Z').level, 5, 'level recomputed from Water')
})

test('only brand-new players get the tutorial', () => {
  assert.equal(normalizeProfile({ rebirths: 0, tutorialStep: 1 }, 'a', 'A').tutorialStep, 1)
  assert.equal(normalizeProfile({ rebirths: 1, tutorialStep: 1 }, 'b', 'B').tutorialStep, TUTORIAL.length)
})

// --- The session -----------------------------------------------------------------

test('training only counts in the well the player really stands in', () => {
  const pos = { x: SPAWN.x, y: 0, z: SPAWN.z }
  const { session, profile } = makeSession(pos)
  session.handle('enterWell', { well: 0 }, 0)
  session.tick(0.1, 0)
  session.tick(2, 0)
  assert.equal(profile.water, 0, 'claimed a well from spawn')
  Object.assign(pos, inWell(0))
  session.tick(0.1, 0)
  session.tick(2, 0)
  assert.ok(profile.water > 0)
  session.handle('enterWell', { well: 1 }, 0)
  assert.equal(session.well, 0, 'a locked well cannot be entered')
})

test('the first guide step completes in the well once Water fills the first pit', () => {
  assert.equal(TUTORIAL[0].event, 'train')
  const goal = TUTORIAL[0].water
  assert.ok(goal >= STAGES[1].need, 'enough for the first pit')
  const { session, profile } = makeSession(inWell(0))
  session.handle('enterWell', { well: 0 }, 0)
  let t = 0
  while (profile.water < goal - 1) session.tick(0.1, (t += 100))
  assert.equal(profile.tutorialStep, 0)
  while (profile.water < goal) session.tick(0.1, (t += 100))
  assert.equal(profile.tutorialStep, 1)
})

test('every stage after the start needs a higher level than the last', () => {
  for (let s = 1; s <= LAST_STAGE; s += 1) {
    assert.ok(STAGES[s].level > STAGES[s - 1].level, `stage ${s}`)
    assert.equal(STAGES[s].need, waterForLevel(STAGES[s].level))
  }
  // Max level before the first rebirth fills a handful of pits, and each rebirth more.
  const reach = (r) => STAGES.filter((st) => st.level <= levelCap(r)).length - 1
  assert.ok(reach(0) >= 5 && reach(0) < 15)
  assert.ok(reach(1) > reach(0))
})

test('a tap scoops times the well you stand in', () => {
  const { session, profile } = makeSession(inWell(1))
  profile.rebirths = 1
  session.handle('enterWell', { well: 1 }, 0)
  session.handle('click', {}, 1000)
  assert.equal(profile.water, 2 * 2, 'x2 rebirth, x2 Spring Well')
  const away = makeSession({ x: SPAWN.x, y: 0, z: SPAWN.z })
  away.profile.rebirths = 1
  away.session.handle('click', {}, 1000)
  assert.equal(away.profile.water, 2, 'x1 away from a well')
})

test('taps give a bucketful of Water each, at most CLICK_RATE a second', () => {
  const { session, profile, count } = makeSession({ x: SPAWN.x, y: 0, z: SPAWN.z })
  profile.ownedBuckets = ['beach']
  profile.equippedBucket = 'beach'
  for (let i = 0; i < 50; i += 1) session.handle('click', {}, 1000)
  assert.equal(count('train'), CLICK_RATE, 'a burst of taps: a second’s worth')
  assert.equal(profile.water, CLICK_RATE * BUCKETS[1].power)
  // A steady 20 taps a second for 3 seconds: only CLICK_RATE a second count.
  for (let t = 1000; t < 4000; t += 50) session.handle('click', {}, t + 50)
  assert.ok(count('train') <= CLICK_RATE * 4 + 1, `${count('train')} gains`)
  assert.ok(count('train') >= CLICK_RATE * 4 - 1)
})

test('a Wins pad pays only to someone standing on it, then sends them home', () => {
  const pos = { x: SPAWN.x, y: 0, z: SPAWN.z }
  const { session, profile, events, teleports, count } = makeSession(pos)
  profile.water = STAGES[3].need
  session.run.open = 3
  session.handle('claim', { stage: 3 }, 0)
  assert.equal(count('claim'), 0, 'not from the lobby')
  Object.assign(pos, onWinsPad(3))
  session.handle('claim', { stage: 2 }, 0)
  assert.equal(count('claim'), 0, 'not some other ledge')
  session.handle('claim', { stage: 3 }, 0)
  assert.equal(count('claim'), 1)
  assert.equal(events.find((e) => e.type === 'claim').payload.auto, false)
  assert.equal(teleports.length, 1, 'back to the lobby')
  assert.ok(Math.hypot(pos.x - SPAWN.x, pos.z - SPAWN.z) < 6)
  assert.equal(session.run.open, 0, 'the run is over')
  Object.assign(pos, onWinsPad(3))
  session.handle('claim', { stage: 3 }, 0)
  assert.equal(count('claim'), 1, 'its pit has to be filled again first')
  assert.equal(profile.tutorialStep, 0, 'the guide waits for Water in the well first')
})

test('standing at a pit\'s rim pours into it, as fast as your Water Power allows', () => {
  const pos = { x: 0, y: 0, z: pitNearZ(1) + 1 }
  const { session, profile, events, count } = makeSession(pos)
  profile.water = STAGES[2].need
  const seconds = pourSeconds(profile, 1)
  let t = 0
  for (; t < seconds - 0.2; t += 0.1) session.tick(0.1, t * 1000)
  assert.equal(count('pit'), 0, 'still filling')
  for (; t < seconds + 0.2; t += 0.1) session.tick(0.1, t * 1000)
  assert.deepEqual(events.find((e) => e.type === 'pit').payload, { stage: 1 })
  assert.equal(session.run.open, 1)
  // Walking off pauses it; the next pit only fills from its own rim.
  Object.assign(pos, { z: (ledgeRect(1).minZ + ledgeRect(1).maxZ) / 2 })
  for (let i = 0; i < 100; i += 1) session.tick(0.1, (t += 0.1) * 1000)
  assert.equal(session.run.open, 1)
  Object.assign(pos, { z: pitNearZ(2) + 1 })
  for (let i = 0; i < pourSeconds(profile, 2) * 10 + 3; i += 1) session.tick(0.1, (t += 0.1) * 1000)
  assert.equal(session.run.open, 2)
  // Too weak for pit 3: nothing pours.
  Object.assign(pos, { z: pitNearZ(3) + 1 })
  for (let i = 0; i < 1000; i += 1) session.tick(0.1, (t += 0.1) * 1000)
  assert.equal(session.run.open, 2)
  // Back in the lobby, the pits are empty again.
  Object.assign(pos, { x: SPAWN.x, z: SPAWN.z })
  session.tick(0.1, (t += 0.1) * 1000)
  assert.equal(session.run.open, 0)
})

test('tapping at the rim pours faster: a quarter second of pouring a tap, at most CLICK_RATE a second', () => {
  const pos = { x: 0, y: 0, z: pitNearZ(1) + 1 }
  const { session, profile, count } = makeSession(pos)
  profile.water = STAGES[1].need
  const seconds = pourSeconds(profile, 1)
  assert.ok(seconds > 2)
  // Eight taps a second, each a quarter second's pouring: three times as fast.
  let t = 0
  for (; count('pit') === 0 && t < seconds; t += 0.125) {
    session.handle('click', {}, t * 1000)
    session.tick(0.125, t * 1000)
  }
  assert.equal(session.run.open, 1)
  assert.ok(t < seconds / 2.5, `filled in ${t.toFixed(2)}s, not ${seconds.toFixed(2)}s`)
  // Taps away from a rim pour nothing.
  Object.assign(pos, { z: (ledgeRect(1).minZ + ledgeRect(1).maxZ) / 2 })
  const before = session.run.pour
  for (let i = 0; i < 8; i += 1) session.handle('click', {}, (t += 0.125) * 1000)
  assert.equal(session.run.pour, before)
})

test("a ledge's coins pay a share of its Wins pad, once a run, only once you've crossed its pit", () => {
  const [coin] = coinsOf(2)
  const pos = { x: coin.x, y: 0, z: coin.z }
  const { session, profile, events, count } = makeSession(pos)
  session.run.open = 1
  session.tick(0.05, 0)
  assert.equal(count('coin'), 0, "pit 2 isn't filled this run")
  session.run.open = 2
  session.tick(0.05, 50)
  const paid = events.find((e) => e.type === 'coin').payload
  assert.equal(paid.stage, 2)
  assert.equal(paid.wins, Math.max(1, Math.round(STAGES[2].wins * COIN_SHARE)))
  assert.equal(profile.wins, paid.wins)
  assert.equal(paid.total, profile.wins)
  session.tick(0.05, 100)
  assert.equal(count('coin'), 1, 'once a run')
  assert.equal(coinAt(2, coin.x + 5, coin.z), -1)
  // Home and back: the coins are there again.
  Object.assign(pos, { x: SPAWN.x, z: SPAWN.z })
  session.tick(0.05, 150)
  Object.assign(pos, { x: coin.x, z: coin.z })
  session.run.open = 2
  session.tick(0.05, 200)
  assert.equal(count('coin'), 2)
  assert.equal(coinsOf(2).length, COINS_PER_LEDGE)
})

test('daily quests: three a day, the same for everyone, each paying out once done, a bonus for all three', () => {
  const day = 20000 * DAILY_INTERVAL_MS
  const quests = questsFor(questDay(day))
  assert.equal(quests.length, QUESTS_PER_DAY)
  assert.equal(new Set(quests.map((q) => q.id)).size, QUESTS_PER_DAY)
  assert.deepEqual(questsFor(questDay(day + 1000)), quests, 'the same all day')
  assert.ok([1, 2, 3, 4, 5].some((d) => questsFor(questDay(day) + d)[0].id !== quests[0].id), 'they change')
  const p = createProfile('a', 'A')
  for (const [i, quest] of quests.entries()) {
    assert.deepEqual(advanceQuest(p, quest.id, quest.target - 1, day), { changed: true })
    const done = advanceQuest(p, quest.id, 5, day)
    assert.equal(done.done.id, quest.id)
    assert.equal(p.items[QUEST_REWARDS[i].item] >= QUEST_REWARDS[i].amount, true)
    if (i < quests.length - 1) assert.equal(done.bonus, null)
    else assert.deepEqual(done.bonus, QUEST_BONUS)
    assert.deepEqual(advanceQuest(p, quest.id, 1, day), { changed: false }, 'done is done')
  }
  assert.ok(currentQuests(p, day).every((q) => q.done))
  const notToday = QUESTS.find((q) => !quests.some((t) => t.id === q.id))
  assert.deepEqual(advanceQuest(p, notToday.id, 1, day), { changed: false })
  // A new day: new quests, from nothing.
  const tomorrow = day + DAILY_INTERVAL_MS
  assert.ok(currentQuests(p, tomorrow).every((q) => q.progress === 0))
  advanceQuest(p, questsFor(questDay(tomorrow))[0].id, 1, tomorrow)
  assert.equal(p.quests.day, questDay(tomorrow))
  assert.equal(p.quests.bonus, false)
  // Saved and loaded.
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(p)), 'a', 'A').quests, p.quests)
})

test('the session counts quests as you play: taps, here', () => {
  const day = 20000 * DAILY_INTERVAL_MS
  const { session, profile, count } = makeSession({ x: SPAWN.x, y: 0, z: SPAWN.z })
  session.clock = day
  const taps = questsFor(questDay(day)).some((q) => q.id === 'taps')
  session.handle('click', {}, day)
  assert.equal(count('quests'), taps ? 1 : 0)
  if (taps) assert.equal(profile.quests.progress.taps, 1)
})

test('pouring together: helpers at the same rim fill it faster, and each gets a tip', () => {
  const pos = { x: 0, y: 0, z: pitNearZ(1) + 1 }
  const filledWith = []
  const profile = createProfile('a', 'A')
  const session = new PlayerSession(profile, { now: 0, emit: () => {}, getPosition: () => pos, onPitFilled: (stage) => filledWith.push(stage) })
  profile.water = STAGES[1].need
  const alone = pourSeconds(profile, 1)
  session.helpers = 2
  let t = 0
  while (session.run.open < 1 && t < alone) {
    session.tick(0.05, t * 1000)
    t += 0.05
  }
  assert.ok(Math.abs(t - alone / coopSpeed(2)) < 0.11, `${t.toFixed(2)}s with two helping, ${alone.toFixed(2)}s alone`)
  assert.deepEqual(filledWith, [1])
  assert.equal(coopSpeed(10), coopSpeed(CO_OP_MAX), 'at most CO_OP_MAX count')
  // A helper's tip.
  const events = []
  const helper = new PlayerSession(createProfile('b', 'B'), { now: 0, emit: (type, payload) => events.push({ type, payload }), getPosition: () => pos })
  helper.coopTip(1, 'A')
  const tip = Math.max(1, Math.round(STAGES[1].wins * CO_OP_TIP))
  assert.equal(helper.profile.wins, tip)
  assert.equal(events.find((e) => e.type === 'reward').payload.wins, tip)
})

test('the Skip pad works from the ledge before the pit it fills', () => {
  const pos = onSkipPad(3)
  const { session, profile, count } = makeSession(pos)
  profile.water = STAGES[3].need
  profile.wins = 1e9
  session.run.open = 3
  session.handle('skipStage', { stage: 5 }, 0)
  assert.equal(count('skip'), 0, 'only the next pit')
  session.handle('skipStage', { stage: 4 }, 0)
  assert.equal(count('skip'), 1)
  assert.equal(profile.skipTo, 4)
  assert.equal(session.run.open, 4, 'filled there and then')
  assert.equal(count('pit'), 1)
  assert.ok(profile.badges.includes('firstSkip'))
})

test('Auto Win claims at the start line, a run (walking and pouring) at a time, with the pass on', () => {
  const pos = onStart()
  const { session, profile, count, teleports } = makeSession(pos)
  profile.water = STAGES[6].need
  for (let t = 0; t < 600; t += 1) session.tick(0.1, t * 100)
  assert.equal(count('claim'), 0, 'needs the pass')
  profile.passes.autoWin = true
  profile.settings.autoWin = true
  const stage = bestRunStage(profile)
  assert.ok(stage >= 1 && stage <= 6)
  const seconds = runSeconds(stage) + runPourSeconds(profile, stage)
  for (let t = 0; t < seconds * 10 * 2 + 5; t += 1) session.tick(0.1, t * 100)
  assert.equal(count('claim'), 2)
  assert.equal(teleports.length, 0, 'you stay at the start line')
  assert.equal(profile.wins, STAGES[stage].wins * 2 + STAGES.slice(1, stage + 1).reduce((sum, s) => sum + s.discover, 0))
})

test('a rebirth out on the course sends you back to the lobby', () => {
  const pos = onWinsPad(2)
  const { session, profile, teleports } = makeSession(pos)
  maxOut(profile)
  session.handle('rebirth', {}, 0)
  assert.equal(profile.rebirths, 1)
  assert.equal(teleports.length, 1)
})

test('ads and Gems are granted by the host only, never by a client message', () => {
  const { session, profile, count } = makeSession({ x: SPAWN.x, y: 0, z: SPAWN.z })
  session.handle('grantAdReward', { placement: 'water-potion' }, 0)
  session.handle('grantGemProduct', { sku: 'wins_big' }, 0)
  session.handle('adReward', { placement: 'water-potion' }, 0)
  assert.equal(profile.wins, 0)
  assert.deepEqual(profile.items, {})
  assert.equal(session.grantAdReward('water-potion', 1e6).ok, true)
  assert.equal(profile.items.potionWater, 1)
  assert.equal(session.grantGemProduct('wins_big').ok, true)
  assert.ok(profile.wins > 0)
  assert.equal(count('reward'), 2)
})

// --- Rebirth gifts ---------------------------------------------------------------

/** Straight to max level (training there takes too long this late). */
function toCap(p) {
  p.level = levelCap(p.rebirths)
  p.water = waterForLevel(p.level)
}

test('every 5th rebirth from 15 gives Volcano eggs', () => {
  assert.equal(rebirthGift(14), null)
  assert.equal(rebirthGift(16), null)
  assert.deepEqual([15, 20, 25, 35, 100].map((r) => rebirthGift(r).amount), [3, 3, 4, 5, 6])
  assert.equal(nextRebirthGift(0).rebirths, 15)
  assert.equal(nextRebirthGift(15).rebirths, 20)
  assert.equal(nextRebirthGift(19).rebirths, 20)

  const p = createProfile('a', 'A')
  p.rebirths = 14
  toCap(p)
  const result = applyRebirth(p)
  assert.equal(result.gift.rebirths, 15)
  assert.equal(p.items.eggVolcano, 3)
  toCap(p)
  assert.equal(applyRebirth(p).gift, null, 'nothing at rebirth 16')
  assert.equal(p.items.eggVolcano, 3)
})

test('a rebirth gift is announced to the player', () => {
  const { session, profile, events } = makeSession({ ...SPAWN, y: 0 })
  profile.rebirths = 19
  toCap(profile)
  session.handle('rebirth', {}, 0)
  const reward = events.find((e) => e.type === 'reward')
  assert.match(reward.payload.label, /REBIRTH 20 GIFT: 3 Volcano Eggs/)
})

// --- World 2 ---------------------------------------------------------------------

test("World 2 is the second half: its pits carry on from World 1's, deeper, paying more", () => {
  const [w1, w2] = WORLD_STAGES
  assert.equal(w2.length, w1.length)
  assert.equal(new Set(w2.map((s) => s.id)).size, w2.length, 'unique ids')
  assert.ok(w2.every((s) => !w1.some((o) => o.name === s.name)), 'new names')
  // Its first pits are as deep as World 1's last few: you fill them on your first visit.
  assert.ok(w2[1].level > w1[20].level && w2[1].level <= w1[LAST_STAGE].level)
  // ...and its last are far deeper than anything in World 1.
  assert.ok(w2[LAST_STAGE].level > w1[LAST_STAGE].level * 2)
  for (let i = 1; i < w2.length; i += 1) {
    assert.ok(w2[i].level > w2[i - 1].level, `pit ${i} deeper`)
    assert.ok(w2[i].wins > w2[i - 1].wins, `pit ${i} pays more`)
    assert.ok(w2[i].need > 0 && w2[i].capacity > w2[i].need)
  }
  // A World 2 pit pays more than the World 1 pit just as deep.
  const same = w1.findIndex((s) => s.level === w2[1].level)
  assert.ok(same > 0)
  assert.equal(w2[1].wins, w1[same].wins * WORLDS[1].wins)
  assert.ok(levelCap(80) >= w2[LAST_STAGE].level, 'reachable within the level table')
})

test('the portal opens when you escape World 1, and goes both ways', () => {
  const p = createProfile('a', 'A')
  p.wins = 1e30
  assert.equal(usePortal(p).ok, false, 'Wins alone do not open it')
  assert.equal(p.world, 0)
  p.stats.bestStage = LAST_STAGE - 1
  assert.equal(world2Open(p), false)
  p.stats.bestStage = WORLD_PORTALS.world2.stage
  p.skipTo = 3
  assert.equal(world2Open(p), true)
  assert.deepEqual(usePortal(p), { ok: true, world: 1, first: true })
  assert.equal(p.wins, 1e30, 'Wins kept')
  assert.equal(p.skipTo, 0, 'skips stay in the world they were bought in')
  assert.equal(usePortal(p).world, 0, 'back home')
  assert.equal(usePortal(p).world, 1, 'open for good once unlocked')
  const saved = normalizeProfile(JSON.parse(JSON.stringify(p)), 'a', 'A')
  assert.equal(saved.world, 1)
  assert.equal(saved.world2Unlocked, true)
  assert.equal(normalizeProfile({ ...p, world2Unlocked: false }, 'a', 'A').world, 0, 'no World 2 without the unlock')
})

test("World 2's pits are World 2's: what you can fill and pour, and its own first-visit prizes", () => {
  const one = createProfile('a', 'A')
  const two = createProfile('b', 'B')
  const deep = WORLD_STAGES[1][5].need
  one.water = two.water = deep
  two.world = 1
  two.world2Unlocked = true
  assert.equal(reachStage(two), 5, "World 2's own pits")
  assert.ok(reachStage(one) > 5, 'the same Water goes further in World 1')
  assert.ok(pourSeconds(two, 5) > 0 && pourSeconds(two, 6) === Infinity)
  const b = applyClaim(two, reachStage(two), 0)
  assert.equal(b.wins, WORLD_STAGES[1][5].wins)
  assert.equal(b.prize, WORLD_STAGES[1].slice(1, 6).reduce((sum, s) => sum + s.discover, 0))
  assert.equal(two.stats.bestStage, 0, "World 1's discoveries untouched")
  assert.equal(two.stats.bestStage2, 5)
})

test('late rebirths multiply your Water more, so each takes about as long as the last', () => {
  for (let r = 1; r <= REBIRTH_BOOST.from; r += 1) assert.equal(rebirthMultiplier(r), 1 + r)
  for (let r = REBIRTH_BOOST.from + 1; r < 90; r += 1) {
    const step = rebirthMultiplier(r) / rebirthMultiplier(r - 1)
    assert.ok(step > REBIRTH_BOOST.mult, `R${r} x${step.toFixed(2)}`)
  }
})

test('stepping into the portal switches world and tells the client', () => {
  const portal = PORTALS[0]
  const { session, profile, events } = makeSession({ x: portal.x, y: 0, z: portal.z })
  profile.wins = 1e12
  session.handle('portal', {}, 0)
  assert.equal(profile.world, 0, 'World 1 not escaped yet')
  profile.stats.bestStage = LAST_STAGE
  session.handle('portal', {}, 0)
  assert.equal(profile.world, 1)
  assert.deepEqual(events.find((e) => e.type === 'world').payload, { world: 1, first: true })
  session.handle('portal', {}, 0)
  assert.equal(profile.world, 0)
})
