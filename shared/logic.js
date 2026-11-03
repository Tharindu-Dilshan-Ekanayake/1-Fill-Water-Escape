import {
  AD_REWARDS,
  BADGES,
  BUCKETS,
  CO_OP_TIP,
  COIN_SHARE,
  COSMETICS,
  COLLECTION_BONUS,
  DAILY_INTERVAL_MS,
  DAILY_REWARDS,
  EGGS,
  FREE_REWARD,
  GEM_PRODUCTS,
  GOLDEN_BOOST,
  GOLDEN_FUSE,
  ITEMS,
  LAST_STAGE,
  MEGA_CHESTS,
  levelCap,
  POUR_MIN_SECONDS,
  POUR_RATE,
  QUEST_BONUS,
  QUEST_REWARDS,
  QUESTS,
  QUESTS_PER_DAY,
  MAX_EQUIPPED_PETS,
  MAX_PET_INVENTORY,
  maxStars,
  OFFLINE_MAX_MS,
  OFFLINE_MIN_MS,
  OFFLINE_RATE,
  PETS,
  PLAYTIME_REWARDS,
  RARITIES,
  REBIRTH_SKIP_RUNS,
  rebirthGift,
  rebirthMultiplier,
  runSeconds,
  SHOP,
  SKIP_RUNS,
  STAR_POWER,
  starPrice,
  stagesOf,
  STREAMS,
  TRAIN_INTERVAL,
  TRAILS,
  TUTORIAL,
  WATER_PACKS,
  waterForLevel,
  WEEKLY_REWARDS,
  WELLS,
  WORLD_PORTALS,
} from './balance.js'
import { formatNumber } from './format.js'
import { mulberry32 } from './rng.js'

/**
 * Game rules as pure functions over a plain profile object.
 *
 * The server runs these authoritatively; the client runs the very same functions for
 * offline play and for display (costs, multipliers, what a button would do). Mutating
 * functions change the profile in place and return a small result describing what
 * happened, which is what gets sent to the client as an event.
 *
 * `session` is the per-connection state that is never saved: when this session
 * started, which playtime rewards were claimed, the free-reward flag.
 */

export const PROFILE_VERSION = 1

export function createProfile(id, name) {
  return {
    v: PROFILE_VERSION,
    id,
    name,
    /** Water Power: what fills the pits. Kept between runs, reset by a rebirth. */
    water: 0,
    wins: 0,
    rebirths: 0,
    level: 1,
    equippedBucket: 'pail',
    ownedBuckets: ['pail'],
    /** Stars (upgrades, 1-BUCKET_STARS) on each bucket you own, by id. */
    bucketStars: {},
    /**
     * The furthest pit the Skip pads have filled for you (0 = none): until your next
     * rebirth you reach at least this stage, whatever your Water.
     */
    skipTo: 0,
    pets: [],
    equippedPets: [],
    nextPetUid: 1,
    items: {},
    boosts: { water: 0, wins: 0 },
    passes: {},
    daily: { start: 0, claimed: [] },
    freeRewardClaimed: false,
    tutorialStep: 0,
    badges: [],
    stats: {
      /** Wins pads claimed (Auto Win's included). */
      runs: 0,
      trains: 0,
      playtime: 0,
      bestWater: 0,
      totalWins: 0,
      skips: 0,
      /** Furthest ledge ever reached in World 1 (index into STAGES): its `discover` prize is paid once. */
      bestStage: 0,
      /** The same for World 2's stages. */
      bestStage2: 0,
    },
    /** The world you're in (index into WORLDS), and whether World 2's portal is open. */
    world: 0,
    world2Unlocked: false,
    lastWell: -1,
    lastSeen: 0,
    settings: { autoRebirth: false, autoWin: false },
    /** Cosmetics owned (stream and trail ids) and the ones you show. */
    cosmetics: { owned: ['water', 'none'], stream: 'water', trail: 'none' },
    /**
     * Wins earned this week (weekOf) from pads and coins, for the weekly board; `prev`
     * is the week before's, kept for its reward; `rewarded` the last week rewarded.
     */
    weekly: { week: 0, wins: 0, prev: { week: 0, wins: 0 }, rewarded: 0 },
    /** Today's quests (see currentQuests): the day they're for, progress by quest id, and the all-done bonus. */
    quests: { day: 0, progress: {}, bonus: false },
  }
}

/** Fills in anything missing from an older or partial save. Never throws. */
export function normalizeProfile(raw, id, name) {
  const base = createProfile(id, name)
  if (!raw || typeof raw !== 'object') return base
  const p = { ...base, ...raw, id, name: name || raw.name || base.name }
  p.boosts = { ...base.boosts, ...(raw.boosts || {}) }
  p.stats = { ...base.stats, ...(raw.stats || {}) }
  p.settings = { ...base.settings, ...(raw.settings || {}) }
  p.daily = { ...base.daily, ...(raw.daily || {}) }
  const weekly = raw.weekly && typeof raw.weekly === 'object' ? raw.weekly : {}
  const count = (n) => (Number.isFinite(n) ? Math.max(0, n) : 0)
  p.weekly = {
    week: count(weekly.week),
    wins: count(weekly.wins),
    prev: { week: count(weekly.prev?.week), wins: count(weekly.prev?.wins) },
    rewarded: count(weekly.rewarded),
  }
  const looks = raw.cosmetics && typeof raw.cosmetics === 'object' ? raw.cosmetics : {}
  const known = (id) => STREAMS[id] || TRAILS[id]
  const ownedLooks = [...new Set([...base.cosmetics.owned, ...(Array.isArray(looks.owned) ? looks.owned.filter(known) : [])])]
  p.cosmetics = {
    owned: ownedLooks,
    stream: STREAMS[looks.stream] && ownedLooks.includes(looks.stream) ? looks.stream : 'water',
    trail: TRAILS[looks.trail] && ownedLooks.includes(looks.trail) ? looks.trail : 'none',
  }
  const quests = raw.quests && typeof raw.quests === 'object' ? raw.quests : {}
  p.quests = {
    day: Number.isInteger(quests.day) ? quests.day : 0,
    progress: Object.fromEntries(
      Object.entries(quests.progress || {})
        .filter(([questId, n]) => QUESTS.some((q) => q.id === questId) && Number.isFinite(n))
        .map(([questId, n]) => [questId, Math.max(0, n)]),
    ),
    bonus: quests.bonus === true,
  }
  p.items = Object.fromEntries(Object.entries(raw.items || {}).filter(([itemId]) => ITEMS[itemId]))
  p.passes = Object.fromEntries(Object.entries(raw.passes || {}).filter(([productId]) => SHOP[productId]))
  p.water = Number.isFinite(raw.water) ? Math.max(0, raw.water) : 0
  p.wins = Number.isFinite(raw.wins) ? Math.max(0, raw.wins) : 0
  p.pets = Array.isArray(raw.pets) ? raw.pets.filter((pet) => PETS[pet?.id]) : []
  p.equippedPets = Array.isArray(raw.equippedPets)
    ? raw.equippedPets.filter((uid) => p.pets.some((pet) => pet.uid === uid)).slice(0, MAX_EQUIPPED_PETS)
    : []
  const owned = Array.isArray(raw.ownedBuckets) ? raw.ownedBuckets.filter((bucketId) => bucketIndex(bucketId) >= 0) : []
  p.ownedBuckets = owned.length ? owned : ['pail']
  if (!p.ownedBuckets.includes(p.equippedBucket)) p.equippedBucket = p.ownedBuckets[0]
  p.bucketStars = Object.fromEntries(
    Object.entries(raw.bucketStars || {})
      .filter(([bucketId]) => p.ownedBuckets.includes(bucketId))
      .map(([bucketId, stars]) => [bucketId, Math.min(maxStars(bucketIndex(bucketId)), Math.max(0, Math.floor(stars) || 0))]),
  )
  const stage = (n) => Math.min(LAST_STAGE, Math.max(0, Math.floor(n) || 0))
  p.stats.bestStage = stage(p.stats.bestStage)
  p.stats.bestStage2 = stage(p.stats.bestStage2)
  p.skipTo = stage(raw.skipTo)
  p.world2Unlocked = raw.world2Unlocked === true
  p.world = p.world2Unlocked && raw.world === 1 ? 1 : 0
  // Levels follow from Water; recompute rather than trust a stored one.
  p.level = levelFor(p.water, p.rebirths)
  // The tutorial is for brand-new players only: anyone who has rebirthed is past it.
  if (p.rebirths > 0) p.tutorialStep = TUTORIAL.length
  p.tutorialStep = Math.min(TUTORIAL.length, Math.max(0, Math.floor(p.tutorialStep) || 0))
  p.v = PROFILE_VERSION
  return p
}

export function createSession(now) {
  return { start: now, playtimeClaimed: [], freeRewardTaken: false, adAt: {} }
}

// --- Lookups ------------------------------------------------------------------------

export const bucketIndex = (id) => BUCKETS.findIndex((b) => b.id === id)
export const bucketById = (id) => BUCKETS.find((b) => b.id === id) || BUCKETS[0]

/** Stars on bucket `id` (0 if none, or not owned). */
export const bucketStars = (profile, id) => profile.bucketStars?.[id] || 0

/** What one scoop of bucket `id` is worth before multipliers: its power, times its stars. */
export const bucketPower = (profile, id) => bucketById(id).power * STAR_POWER ** bucketStars(profile, id)

export function isWellUnlocked(profile, index) {
  const well = WELLS[index]
  if (!well) return false
  if (well.product) return Boolean(profile.passes[well.product])
  return profile.rebirths >= well.rebirths
}

/**
 * Water values are kept to a tenth below a million and whole above, so repeated
 * small gains don't pile up float dust.
 */
export const tidy = (value) => (value < 1e6 ? Math.round(value * 10) / 10 : Math.round(value))

/** "Nice" price or amount: two significant figures (692 -> 690, 1934 -> 1900). */
export function niceRound(n) {
  if (n < 100) return Math.max(1, Math.round(n))
  const step = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.round(n / step) * step
}

// --- Levels -------------------------------------------------------------------------

/** The level `water` reaches, never above the cap for `rebirths`. */
export function levelFor(water, rebirths) {
  const cap = levelCap(rebirths)
  let level = 1
  while (level < cap && water >= waterForLevel(level + 1)) level += 1
  return level
}

export const isMaxLevel = (profile) => profile.level >= levelCap(profile.rebirths)

/** 0..1 through the current level: what the level bar fills to. */
export function levelProgress(profile) {
  if (isMaxLevel(profile)) return 1
  const from = waterForLevel(profile.level)
  const to = waterForLevel(profile.level + 1)
  return Math.max(0, Math.min(1, (profile.water - from) / Math.max(1e-9, to - from)))
}

/** 0..1 progress towards being able to rebirth, by levels. */
export function rebirthProgress(profile) {
  const cap = levelCap(profile.rebirths)
  if (profile.level >= cap) return 1
  return Math.max(0, Math.min(1, (profile.level - 1 + levelProgress(profile)) / Math.max(1, cap - 1)))
}

// --- Multipliers --------------------------------------------------------------------

/** Equipped pets stack additively: x3 and x2 together make x4, not x6. */
/** What one pet multiplies your Water by: its kind's, with GOLDEN_BOOST times the bonus if it's golden. */
export function petMult(pet) {
  const info = PETS[pet.id]
  if (!info) return 1
  return pet.golden ? 1 + (info.mult - 1) * GOLDEN_BOOST : info.mult
}

export function petMultiplier(profile) {
  let total = 1
  for (const uid of profile.equippedPets) {
    const pet = profile.pets.find((p) => p.uid === uid)
    if (pet) total += petMult(pet) - 1
  }
  return total
}

export const isBoostActive = (profile, kind, now) => (profile.boosts[kind] || 0) > now

/** The x2 Water pass and potion; they stack. */
export function waterBoostMultiplier(profile, now) {
  return (profile.passes.waterX2 ? 2 : 1) * (isBoostActive(profile, 'water', now) ? 2 : 1)
}

/** The x2 Wins pass and potion; they stack. */
export function winsMultiplier(profile, now) {
  return (profile.passes.winsX2 ? 2 : 1) * (isBoostActive(profile, 'wins', now) ? 2 : 1)
}

/** Everything that multiplies a Water gain except the bucket and where you scoop it. */
/** Your bucket collection's bonus: COLLECTION_BONUS for every bucket past the first. */
export const collectionMultiplier = (profile) => 1 + COLLECTION_BONUS * Math.max(0, profile.ownedBuckets.length - 1)

export function gainMultiplier(profile, now) {
  return rebirthMultiplier(profile.rebirths) * petMultiplier(profile) * collectionMultiplier(profile) * waterBoostMultiplier(profile, now)
}

/** Water from one gain anywhere but a well: your bucket's power, multiplied. */
export const baseGain = (profile, now) => tidy(bucketPower(profile, profile.equippedBucket) * gainMultiplier(profile, now))

/** Water from one scoop in well `index`. */
export function wellGain(profile, index, now) {
  const well = WELLS[index]
  if (!well) return 0
  return tidy(bucketPower(profile, profile.equippedBucket) * well.mult * gainMultiplier(profile, now))
}

// --- Training, levels, rebirth ------------------------------------------------------

/**
 * Banks a natural gain (a well's scoop or a tap) and the levels it reaches. Once you're at
 * max level natural gains stop: rebirth to keep going. Returns what was really added.
 */
function addWater(profile, gain) {
  const cap = levelCap(profile.rebirths)
  if (profile.level >= cap) return { gain: 0, leveledUp: false, maxed: true }
  // Stops exactly on max level rather than overshooting it.
  const room = Math.max(0, waterForLevel(cap) - profile.water)
  const added = tidy(Math.min(gain, room))
  profile.water = tidy(profile.water + added)
  profile.stats.trains += 1
  profile.stats.bestWater = Math.max(profile.stats.bestWater, profile.water)
  const before = profile.level
  profile.level = levelFor(profile.water, profile.rebirths)
  return { gain: added, leveledUp: profile.level > before, levels: profile.level - before, maxed: profile.level >= cap }
}

export function applyTrain(profile, index, now) {
  if (!isWellUnlocked(profile, index)) return { ok: false, error: 'Well locked' }
  profile.lastWell = index
  return { ok: true, ...addWater(profile, wellGain(profile, index, now)) }
}

/**
 * One tap of the screen: a scoop of your bucket, times well `index` if you're standing
 * in one you've unlocked (-1: none, x1). The session limits how often.
 */
export function applyClick(profile, index, now) {
  const gain = index >= 0 && isWellUnlocked(profile, index) ? wellGain(profile, index, now) : baseGain(profile, now)
  return { ok: true, ...addWater(profile, gain) }
}

/**
 * Rebirth: +1 rebirth; Water, levels and the pits you skipped reset (Wins, buckets and
 * pets stay).
 */
export function applyRebirth(profile) {
  if (!isMaxLevel(profile)) return { ok: false, error: `Reach level ${levelCap(profile.rebirths)} first!` }
  profile.rebirths += 1
  profile.tutorialStep = TUTORIAL.length
  profile.water = 0
  profile.level = 1
  profile.skipTo = 0
  const gift = rebirthGift(profile.rebirths)
  if (gift) addItem(profile, gift.item, gift.amount)
  return { ok: true, rebirths: profile.rebirths, gift }
}

// --- The escape course --------------------------------------------------------------

/**
 * The furthest stage of `world` whose pit (and every one before it) `water` is strong
 * enough to fill.
 */
export function fillStage(water, world = 0) {
  const stages = stagesOf(world)
  let stage = 0
  while (stage < LAST_STAGE && water >= stages[stage + 1].need) stage += 1
  return stage
}

/** The furthest ledge you can get to now: your Water Power's, or further if you skipped. */
export const reachStage = (profile) => Math.max(fillStage(profile.water, profile.world), profile.skipTo || 0)

/** Whether you can fill pit `stage` at all: strong enough for it, or skipped. */
export const canPour = (profile, stage) => stage <= reachStage(profile)

/** Water a second you pour into a pit. */
export const pourRate = (profile) => profile.water * POUR_RATE

/**
 * Seconds pit `stage` takes you to fill, from empty: its capacity over your pour rate
 * (never under POUR_MIN_SECONDS), none if you skipped it, Infinity if you're too weak.
 */
export function pourSeconds(profile, stage) {
  if (stage <= (profile.skipTo || 0)) return 0
  if (!canPour(profile, stage)) return Infinity
  return Math.max(POUR_MIN_SECONDS, stagesOf(profile.world)[stage].capacity / Math.max(1e-9, pourRate(profile)))
}

/** Seconds of pouring a run out to ledge `stage` takes you: every pit on the way. */
export function runPourSeconds(profile, stage) {
  let total = 0
  for (let i = 1; i <= stage; i += 1) total += pourSeconds(profile, i)
  return total
}

/**
 * The ledge a run pays best for, Wins a second, for someone as strong as you: how far
 * Auto Win goes, and a good aim for your own runs. (The furthest isn't always it: a pit
 * that takes you a minute to fill may not be worth its Wins yet.)
 */
export function bestRunStage(profile) {
  const stages = stagesOf(profile.world)
  let best = 0
  let bestRate = 0
  let pouring = 0
  const reach = reachStage(profile)
  for (let s = 1; s <= reach; s += 1) {
    pouring += pourSeconds(profile, s)
    const rate = stages[s].wins / (runSeconds(s) + pouring)
    if (rate > bestRate) {
      bestRate = rate
      best = s
    }
  }
  return best
}

/**
 * The pit you're filling this run, as the session keeps it: `open` is the furthest pit
 * filled since you set out from the lobby, `pour` how full the next one is (0-1).
 * Pits stay full until you're back in the lobby; then every run starts dry.
 */
export const createRun = () => ({ open: 0, pour: 0 })

/**
 * Pours for `dt` seconds into pit `run.open + 1` (if you can fill it). Returns the
 * stage that's just filled up, or 0.
 */
export function pourInto(run, profile, dt) {
  const stage = run.open + 1
  if (stage > LAST_STAGE || !canPour(profile, stage)) return 0
  const seconds = pourSeconds(profile, stage)
  run.pour = seconds <= 0 ? 1 : run.pour + dt / seconds
  if (run.pour < 1) return 0
  run.open = stage
  run.pour = 0
  return stage
}

/**
 * Claims the Wins pad on ledge `stage`, which ends the run - `open` being the furthest
 * pit filled on it (by default, the furthest you could fill). Pays the stage's Wins
 * (times the x2 Wins pass and potion) and, the first time you reach a ledge in this
 * world, the first-visit prize of every ledge up to it - and opens the chest of any
 * Mega Pit among them.
 */
export function applyClaim(profile, stage, now, open = reachStage(profile)) {
  const index = Math.floor(Number(stage))
  if (!Number.isInteger(index) || index < 1 || index > LAST_STAGE) return { ok: false, error: 'No Wins here' }
  if (index > open) return { ok: false, error: 'Fill the pit first!' }
  const world = profile.world
  const stages = stagesOf(world)
  const multiplier = winsMultiplier(profile, now)
  const wins = Math.max(1, Math.round(stages[index].wins * multiplier))
  const bestKey = world === 1 ? 'bestStage2' : 'bestStage'
  const discovered = []
  const chests = []
  let prize = 0
  for (let i = profile.stats[bestKey] + 1; i <= index; i += 1) {
    discovered.push(i)
    prize += stages[i].discover
    // A Mega Pit's ledge: its treasure chest opens, the first time.
    const chest = MEGA_CHESTS[world]?.[i]
    if (chest) {
      addItem(profile, chest.item, chest.amount)
      chests.push({ stage: i, ...chest })
    }
  }
  const best = index > profile.stats[bestKey]
  earnWins(profile, wins + prize, now)
  profile.stats.runs += 1
  profile.stats[bestKey] = Math.max(profile.stats[bestKey], index)
  return { ok: true, stage: index, wins, prize, discovered, chests, multiplier, best }
}

/** A helper's tip, for helping someone fill pit `stage` (in their shared world). */
export function applyCoopTip(profile, stage, now) {
  if (!Number.isInteger(stage) || stage < 1 || stage > LAST_STAGE) return { ok: false }
  const wins = Math.max(1, Math.round(stagesOf(profile.world)[stage].wins * CO_OP_TIP))
  earnWins(profile, wins, now)
  return { ok: true, wins }
}

/**
 * How far you've got across both worlds, as one number for leaderboards and name tags:
 * World 1's stage (1-59), then 59 + World 2's once you're there (60-118).
 */
export const overallStage = (stats) => ((stats?.bestStage2 || 0) > 0 ? LAST_STAGE + stats.bestStage2 : stats?.bestStage || 0)

/** Wins earned this week (weekOf `now`), for the weekly board: 0 once the week has turned. */
export const weekWins = (profile, now) => (profile.weekly?.week === weekOf(now) ? profile.weekly.wins : 0)

// --- Weekly board -------------------------------------------------------------------

/** The week (Monday 00:00 UTC to the next) at `now`. */
export const weekOf = (now) => Math.floor((now - 4 * DAILY_INTERVAL_MS) / (7 * DAILY_INTERVAL_MS))

/**
 * Banks Wins you've earned playing (a Wins pad, a coin): your Wins, your total and this
 * week's, for the weekly board - starting a new week if it's turned, the last one kept.
 */
export function earnWins(profile, amount, now) {
  profile.wins += amount
  profile.stats.totalWins += amount
  const week = weekOf(now)
  if (profile.weekly.week !== week) {
    if (profile.weekly.wins > 0) profile.weekly.prev = { week: profile.weekly.week, wins: profile.weekly.wins }
    profile.weekly.week = week
    profile.weekly.wins = 0
  }
  profile.weekly.wins += amount
}

/** What you earned in week `week`, as far as your save knows (this week's or the last). */
export function winsInWeek(profile, week) {
  if (profile.weekly.week === week) return profile.weekly.wins
  if (profile.weekly.prev.week === week) return profile.weekly.prev.wins
  return 0
}

/** The reward for finishing week `week` at `rank` (1 = top), once: `{ item, amount }`, or null. */
export function applyWeeklyReward(profile, week, rank) {
  const reward = WEEKLY_REWARDS.find((r) => rank >= 1 && rank <= r.upTo)
  if (!reward || profile.weekly.rewarded >= week || winsInWeek(profile, week) <= 0) return null
  profile.weekly.rewarded = week
  addItem(profile, reward.item, reward.amount)
  return reward
}

/** Wins one of ledge `stage`'s coins pays you (with the x2 Wins pass and potion). */
export const coinWins = (profile, stage, now) => Math.max(1, Math.round(stagesOf(profile.world)[stage].wins * COIN_SHARE * winsMultiplier(profile, now)))

/** Picks up one of ledge `stage`'s coins (the session checks you're touching it). */
export function applyCoin(profile, stage, now) {
  if (!Number.isInteger(stage) || stage < 1 || stage > LAST_STAGE) return { ok: false }
  const wins = coinWins(profile, stage, now)
  earnWins(profile, wins, now)
  return { ok: true, wins }
}

/** Wins to have the Skip pad fill pit `stage` for you (in the world you're in). */
export const skipPrice = (profile, stage) => niceRound(SKIP_RUNS * stagesOf(profile.world)[Math.min(LAST_STAGE, Math.max(1, stage))].wins)

/**
 * The Skip pad on the ledge before pit `stage`: fills it for you - and every pit before
 * it - at once, on every run, until you rebirth or change worlds. Whether you're too
 * weak for it or would just rather not wait.
 */
export function applySkip(profile, stage) {
  const index = Math.floor(Number(stage))
  if (!Number.isInteger(index) || index < 1 || index > LAST_STAGE) return { ok: false, error: 'Nothing to skip' }
  if (index <= (profile.skipTo || 0)) return { ok: false, error: 'Already skipped!' }
  const price = skipPrice(profile, index)
  if (profile.wins < price) return { ok: false, error: 'Not enough Wins!' }
  profile.wins -= price
  profile.skipTo = index
  profile.stats.skips += 1
  return { ok: true, stage: index, price }
}

/** Wins (before multipliers) of a run as far as `water` fills, in `world`. */
export const runWinsAt = (water, world = 0) => stagesOf(world)[fillStage(water, world)].wins

/** Wins (before multipliers) of a run at your max level: what packs and skips cost in. */
export const maxRunWins = (profile) => Math.max(1, runWinsAt(waterForLevel(levelCap(profile.rebirths)), profile.world))

/**
 * The Water packs as they stand for you now: `[{ amount, price }]`. Both follow the
 * Water your next level needs, and the Wins a run with that much Water pays.
 */
export function waterPacks(profile) {
  const next = waterForLevel(profile.level + 1)
  const wins = Math.max(1, runWinsAt(next, profile.world))
  return WATER_PACKS.map((pack) => ({
    amount: niceRound(Math.max(10, next * pack.share)),
    price: niceRound(Math.max(3, wins * pack.runs)),
  }))
}

/** Buys Water pack `index` with Wins, up to your max level. */
export function buyWaterPack(profile, index) {
  const pack = waterPacks(profile)[index]
  if (!pack) return { ok: false, error: 'Unknown pack' }
  if (isMaxLevel(profile)) return { ok: false, error: 'Max level - rebirth!' }
  if (profile.wins < pack.price) return { ok: false, error: 'Not enough Wins!' }
  profile.wins -= pack.price
  // Packs fill you up to your max level, never past it: that's rebirth's job.
  const added = Math.min(pack.amount, Math.max(0, waterForLevel(levelCap(profile.rebirths)) - profile.water))
  profile.water = tidy(profile.water + added)
  profile.stats.bestWater = Math.max(profile.stats.bestWater, profile.water)
  profile.level = levelFor(profile.water, profile.rebirths)
  return { ok: true, amount: added }
}

/** Wins to rebirth now without reaching max level first. */
export const rebirthSkipPrice = (profile) => niceRound(Math.max(20, maxRunWins(profile) * REBIRTH_SKIP_RUNS))

export function skipRebirth(profile) {
  if (isMaxLevel(profile)) return applyRebirth(profile)
  const price = rebirthSkipPrice(profile)
  if (profile.wins < price) return { ok: false, error: 'Not enough Wins!' }
  profile.wins -= price
  profile.level = levelCap(profile.rebirths)
  return applyRebirth(profile)
}

// --- Worlds -------------------------------------------------------------------------

/** Whether World 2's portal lets you through: you've escaped World 1 (or been before). */
export const world2Open = (profile) => profile.world2Unlocked || profile.stats.bestStage >= WORLD_PORTALS.world2.stage

/**
 * Steps through the world portal: from World 1 into World 2 (opening it for good the
 * first time, once you've escaped World 1), or from World 2 back home. Skipped pits
 * stay behind in the world they were bought in.
 */
export function usePortal(profile) {
  if (profile.world === 1) {
    profile.world = 0
    profile.skipTo = 0
    return { ok: true, world: 0 }
  }
  const need = WORLD_PORTALS.world2.stage
  if (!world2Open(profile)) return { ok: false, error: `Escape World 1 first (stage ${need})`, need }
  const first = !profile.world2Unlocked
  profile.world2Unlocked = true
  profile.world = 1
  profile.skipTo = 0
  return { ok: true, world: 1, first }
}

// --- Cosmetics ----------------------------------------------------------------------

/**
 * Buys cosmetic `id` of `kind` ('stream' or 'trail') with Wins and shows it - or, if you
 * own it already, just shows it.
 */
export function buyCosmetic(profile, kind, id) {
  const list = COSMETICS[kind]
  const look = list?.[id]
  if (!look) return { ok: false, error: 'Unknown' }
  const owned = profile.cosmetics.owned.includes(id)
  if (!owned) {
    if (profile.wins < look.price) return { ok: false, error: 'Not enough Wins!' }
    profile.wins -= look.price
    profile.cosmetics.owned.push(id)
  }
  profile.cosmetics[kind] = id
  return { ok: true, kind, id, bought: !owned }
}

// --- Daily quests ------------------------------------------------------------------

/** The quest day (UTC) at `now`. */
export const questDay = (now) => Math.floor(now / DAILY_INTERVAL_MS)

/** Day `day`'s quests: QUESTS_PER_DAY of QUESTS, picked by the day itself (the same for everyone). */
export function questsFor(day) {
  const rand = mulberry32(day * 2654435761)
  const pool = [...QUESTS]
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, QUESTS_PER_DAY)
}

/** Starts a new day's quests if the day has turned since. */
function rollQuests(profile, now) {
  const day = questDay(now)
  if (profile.quests.day !== day) profile.quests = { day, progress: {}, bonus: false }
}

/** Today's quests as they stand for you: `[{ id, text, target, progress, done, reward }]`. */
export function currentQuests(profile, now) {
  const day = profile.quests?.day === questDay(now) ? profile.quests : { progress: {} }
  return questsFor(questDay(now)).map((quest, i) => {
    const progress = Math.min(quest.target, day.progress[quest.id] || 0)
    return { ...quest, text: quest.text.replace('{n}', formatNumber(quest.target)), progress, done: progress >= quest.target, reward: QUEST_REWARDS[i] }
  })
}

/**
 * Counts `amount` towards today's quest of kind `kind`, if there is one: its reward the
 * moment it's done, and the bonus for the last of them. Returns `{ changed, done, bonus }`
 * - `done` the quest just finished (with its reward), if any.
 */
export function advanceQuest(profile, kind, amount, now) {
  rollQuests(profile, now)
  const quests = currentQuests(profile, now)
  const quest = quests.find((q) => q.id === kind)
  if (!quest || quest.done || amount <= 0) return { changed: false }
  const progress = Math.min(quest.target, quest.progress + amount)
  profile.quests.progress[kind] = progress
  if (progress < quest.target) return { changed: true }
  addItem(profile, quest.reward.item, quest.reward.amount)
  let bonus = null
  if (!profile.quests.bonus && quests.every((q) => q.done || q.id === kind)) {
    profile.quests.bonus = true
    addItem(profile, QUEST_BONUS.item, QUEST_BONUS.amount)
    bonus = QUEST_BONUS
  }
  return { changed: true, done: { ...quest, progress }, bonus }
}

// --- Buckets ------------------------------------------------------------------------

/**
 * Buys bucket `bucketId` - any of them, in any order - and carries it if it's better
 * than the one you have (a bucket you already own is just equipped).
 */
export function buyBucket(profile, bucketId) {
  const bucket = BUCKETS.find((b) => b.id === bucketId)
  if (!bucket) return { ok: false, error: 'Unknown bucket' }
  if (profile.ownedBuckets.includes(bucketId)) return equipBucket(profile, bucketId)
  if (profile.wins < bucket.cost) return { ok: false, error: 'Not enough Wins!' }
  profile.wins -= bucket.cost
  profile.ownedBuckets.push(bucketId)
  const better = bucketPower(profile, bucketId) > bucketPower(profile, profile.equippedBucket)
  if (better) profile.equippedBucket = bucketId
  return { ok: true, bought: true, bucketId, equipped: better }
}

/** Wins for the next star on bucket `bucketId`, or null when it has them all. */
export function nextStarPrice(profile, bucketId) {
  const stars = bucketStars(profile, bucketId)
  const index = bucketIndex(bucketId)
  return stars >= maxStars(index) ? null : starPrice(index, stars + 1)
}

/** Upgrades bucket `bucketId` (one you own) by a star: x STAR_POWER on its power. */
export function upgradeBucket(profile, bucketId) {
  if (!profile.ownedBuckets.includes(bucketId)) return { ok: false, error: 'Buy it first!' }
  const price = nextStarPrice(profile, bucketId)
  if (price === null) return { ok: false, error: 'Fully upgraded!' }
  if (profile.wins < price) return { ok: false, error: 'Not enough Wins!' }
  profile.wins -= price
  profile.bucketStars = { ...profile.bucketStars, [bucketId]: bucketStars(profile, bucketId) + 1 }
  return { ok: true, bucketId, stars: profile.bucketStars[bucketId], price }
}

export function equipBucket(profile, bucketId) {
  if (!profile.ownedBuckets.includes(bucketId)) return { ok: false, error: 'You don’t own that bucket' }
  profile.equippedBucket = bucketId
  return { ok: true, equipped: true, bucketId }
}

/** The cheapest bucket in the shop you don't have yet, or null. */
export function nextBucket(profile) {
  return BUCKETS.find((b) => !profile.ownedBuckets.includes(b.id)) || null
}

/** The best bucket you own (with its stars). */
export function bestOwnedBucket(profile) {
  let best = profile.ownedBuckets[0]
  for (const id of profile.ownedBuckets) if (bucketPower(profile, id) > bucketPower(profile, best)) best = id
  return best
}

// --- Pets --------------------------------------------------------------------------

function rollPet(eggId, rand) {
  const egg = EGGS[eggId]
  const total = egg.pets.reduce((sum, [, w]) => sum + w, 0)
  let r = rand() * total
  for (const [petId, weight] of egg.pets) {
    r -= weight
    if (r < 0) return petId
  }
  return egg.pets[egg.pets.length - 1][0]
}

export function addPet(profile, petId) {
  const pet = { uid: profile.nextPetUid++, id: petId }
  profile.pets.push(pet)
  // Auto-equip into a free slot, so a first pet does something straight away.
  if (profile.equippedPets.length < MAX_EQUIPPED_PETS) profile.equippedPets.push(pet.uid)
  return pet
}

/**
 * Hatches `count` eggs. `paid` says how: 'wins' charges the egg's Wins price, 'item'
 * consumes an egg item, 'free' is for reward grants already paid for.
 */
export function hatchEgg(profile, eggId, count = 1, { paid = 'wins', rand = Math.random } = {}) {
  const egg = EGGS[eggId]
  if (!egg) return { ok: false, error: 'Unknown egg' }
  if (profile.pets.length + count > MAX_PET_INVENTORY) return { ok: false, error: 'Pet inventory full!' }
  if (paid === 'wins') {
    if (!egg.cost.wins) return { ok: false, error: 'This egg is premium only' }
    const price = egg.cost.wins * count
    if (profile.wins < price) return { ok: false, error: 'Not enough Wins!' }
    profile.wins -= price
  } else if (paid === 'item') {
    const itemId = Object.keys(ITEMS).find((k) => ITEMS[k].kind === 'egg' && ITEMS[k].egg === eggId)
    if (!itemId || (profile.items[itemId] || 0) < count) return { ok: false, error: 'No eggs left' }
    profile.items[itemId] -= count
  }
  const pets = []
  for (let i = 0; i < count; i += 1) pets.push(addPet(profile, rollPet(eggId, rand)))
  return { ok: true, eggId, pets }
}

export function equipPet(profile, uid) {
  if (!profile.pets.some((p) => p.uid === uid)) return { ok: false, error: 'Unknown pet' }
  if (profile.equippedPets.includes(uid)) return { ok: true }
  if (profile.equippedPets.length >= MAX_EQUIPPED_PETS) return { ok: false, error: `Max ${MAX_EQUIPPED_PETS} pets equipped` }
  profile.equippedPets.push(uid)
  return { ok: true }
}

export function unequipPet(profile, uid) {
  profile.equippedPets = profile.equippedPets.filter((u) => u !== uid)
  return { ok: true }
}

const petScore = (pet) => petMult(pet)

export function equipBestPets(profile) {
  const best = [...profile.pets].sort((a, b) => petScore(b) - petScore(a)).slice(0, MAX_EQUIPPED_PETS)
  profile.equippedPets = best.map((p) => p.uid)
  return { ok: true }
}

/**
 * Fuses GOLDEN_FUSE of your `petId` pets (not golden ones; the ones you aren't using
 * first) into one Golden pet, which takes a free slot if there is one.
 */
export function fusePets(profile, petId) {
  const plain = profile.pets.filter((p) => p.id === petId && !p.golden)
  if (!PETS[petId] || plain.length < GOLDEN_FUSE) return { ok: false, error: `Need ${GOLDEN_FUSE} of them` }
  const inUse = (p) => (profile.equippedPets.includes(p.uid) ? 1 : 0)
  for (const p of [...plain].sort((a, b) => inUse(a) - inUse(b)).slice(0, GOLDEN_FUSE)) deletePet(profile, p.uid)
  const pet = { uid: profile.nextPetUid++, id: petId, golden: true }
  profile.pets.push(pet)
  if (profile.equippedPets.length < MAX_EQUIPPED_PETS) profile.equippedPets.push(pet.uid)
  return { ok: true, pet }
}

export function deletePet(profile, uid) {
  const before = profile.pets.length
  profile.pets = profile.pets.filter((p) => p.uid !== uid)
  profile.equippedPets = profile.equippedPets.filter((u) => u !== uid)
  return { ok: profile.pets.length < before }
}

/** Sort key for inventory display: equipped first, then rarity, then multiplier. */
export function petSortKey(profile, pet) {
  const info = PETS[pet.id]
  const equipped = profile.equippedPets.includes(pet.uid) ? 1 : 0
  return equipped * 1e6 + (RARITIES[info.rarity]?.order ?? 0) * 1e4 + petMult(pet)
}

// --- Items & boosts ---------------------------------------------------------------

export function addItem(profile, itemId, amount = 1) {
  profile.items[itemId] = (profile.items[itemId] || 0) + amount
}

export function usePotion(profile, itemId, now) {
  const item = ITEMS[itemId]
  if (!item || item.kind !== 'potion') return { ok: false, error: 'Not a potion' }
  if ((profile.items[itemId] || 0) <= 0) return { ok: false, error: 'None left' }
  profile.items[itemId] -= 1
  // Stacks: a second potion extends the timer instead of wasting it.
  profile.boosts[item.boost] = Math.max(profile.boosts[item.boost] || 0, now) + item.durationMs
  return { ok: true, boost: item.boost, endsAt: profile.boosts[item.boost] }
}

/** Applies a reward grant: { wins } | { item } | { pet } | { water } | { hatch }. */
export function applyGrant(profile, grant, { rand = Math.random } = {}) {
  const result = { ok: true }
  if (grant.wins) {
    profile.wins += grant.wins
    profile.stats.totalWins += grant.wins
  }
  if (grant.water) {
    profile.water = tidy(profile.water + grant.water)
    profile.stats.bestWater = Math.max(profile.stats.bestWater, profile.water)
    profile.level = levelFor(profile.water, profile.rebirths)
  }
  if (grant.item) addItem(profile, grant.item, grant.amount || 1)
  if (grant.pet) result.pets = [addPet(profile, grant.pet)]
  if (grant.hatch) {
    const hatched = hatchEgg(profile, grant.hatch, 1, { paid: 'free', rand })
    if (!hatched.ok) return hatched
    result.pets = hatched.pets
    result.eggId = grant.hatch
  }
  return result
}

// --- Daily & playtime rewards -------------------------------------------------------

/**
 * State of each daily reward: 'claimed' | 'ready' | 'next' (with `unlocksIn` ms) |
 * 'locked'. A new 7-day cycle starts on first claim after the last one finishes.
 */
export function dailyStatus(profile, now) {
  const { start, claimed } = profile.daily
  const fresh = !start || claimed.length >= DAILY_REWARDS.length
  const cycleStart = fresh ? now : start
  let nextShown = false
  return DAILY_REWARDS.map((reward, day) => {
    if (!fresh && claimed.includes(day)) return { day, state: 'claimed' }
    const unlockAt = cycleStart + day * DAILY_INTERVAL_MS
    if (now >= unlockAt) return { day, state: 'ready' }
    if (!nextShown) {
      nextShown = true
      return { day, state: 'next', unlocksIn: unlockAt - now }
    }
    return { day, state: 'locked' }
  })
}

export function claimDaily(profile, day, now, opts) {
  const status = dailyStatus(profile, now)[day]
  if (!status || status.state !== 'ready') return { ok: false, error: 'Not ready yet' }
  if (!profile.daily.start || profile.daily.claimed.length >= DAILY_REWARDS.length) {
    profile.daily = { start: now, claimed: [] }
  }
  profile.daily.claimed.push(day)
  const result = applyGrant(profile, DAILY_REWARDS[day].grant, opts)
  return { ...result, day, label: DAILY_REWARDS[day].label }
}

export function playtimeStatus(session, now) {
  const minutes = (now - session.start) / 60000
  return PLAYTIME_REWARDS.map((reward, index) => {
    if (session.playtimeClaimed.includes(index)) return { index, state: 'claimed' }
    if (minutes >= reward.minutes) return { index, state: 'ready' }
    return { index, state: 'locked', unlocksIn: (reward.minutes - minutes) * 60000 }
  })
}

export function claimPlaytime(profile, session, index, now, opts) {
  const status = playtimeStatus(session, now)[index]
  if (!status || status.state !== 'ready') return { ok: false, error: 'Not ready yet' }
  session.playtimeClaimed.push(index)
  const result = applyGrant(profile, PLAYTIME_REWARDS[index].grant, opts)
  return { ...result, index, label: PLAYTIME_REWARDS[index].label }
}

export function claimFreeReward(profile, session, opts) {
  if (session.freeRewardTaken) return { ok: false, error: 'Already claimed this session' }
  session.freeRewardTaken = true
  const grant = profile.freeRewardClaimed ? FREE_REWARD.repeat : FREE_REWARD.firstTime
  profile.freeRewardClaimed = true
  return { ...applyGrant(profile, grant, opts), grant }
}

// --- Shop ---------------------------------------------------------------------------

/** Buys a SHOP item with Wins. */
export function buyShopItem(profile, productId, opts = {}) {
  const item = SHOP[productId]
  if (!item) return { ok: false, error: 'Unknown item' }
  if (item.kind === 'pass' && profile.passes[productId]) return { ok: false, error: 'Already owned' }
  if (profile.wins < item.price) return { ok: false, error: 'Not enough Wins!' }
  if (item.kind === 'pass') {
    profile.wins -= item.price
    profile.passes[productId] = true
    // Auto Win switches itself on once bought.
    if (productId === 'autoWin') profile.settings.autoWin = true
    return { ok: true, productId, pass: true }
  }
  const result = applyGrant(profile, item.grant || {}, opts)
  if (result.ok) profile.wins -= item.price
  return { ...result, productId }
}

// --- Boxity Gems and rewarded ads ------------------------------------------------

/**
 * Grants Gems product `sku`, already paid for in Boxity. Passes you own already turn
 * into a Wins pack of the same worth, so nothing bought is ever wasted.
 */
export function applyGemProduct(profile, sku) {
  const product = GEM_PRODUCTS[sku]
  if (!product) return { ok: false, error: 'Unknown product' }
  const { grant } = product
  const result = { ok: true, sku, name: product.name }
  if (grant.pass) {
    if (profile.passes[grant.pass]) {
      result.wins = Math.max(10, Math.round(maxRunWins(profile) * 20))
    } else {
      profile.passes[grant.pass] = true
      if (grant.pass === 'autoWin') profile.settings.autoWin = true
      result.pass = grant.pass
    }
  }
  if (grant.winsRuns) result.wins = (result.wins || 0) + Math.max(25, Math.round(maxRunWins(profile) * grant.winsRuns))
  if (result.wins) {
    profile.wins += result.wins
    profile.stats.totalWins += result.wins
  }
  for (const [itemId, amount] of Object.entries(grant.items || {})) addItem(profile, itemId, amount)
  return result
}

/** A rewarded ad's prize for `placement`, if it's off cooldown (`session.adAt`). */
export function applyAdReward(profile, session, placement, now) {
  const reward = AD_REWARDS[placement]
  if (!reward) return { ok: false, error: 'Unknown reward' }
  session.adAt = session.adAt || {}
  if (now - (session.adAt[placement] || 0) < reward.cooldownMs) return { ok: false, error: 'Not ready yet' }
  session.adAt[placement] = now
  return { ...applyGrant(profile, reward.grant), placement, label: reward.label }
}

// --- Offline progress -------------------------------------------------------------

/** Water scooped while away, if the player logged off standing in a well. */
export function applyOfflineProgress(profile, now) {
  const away = Math.min(OFFLINE_MAX_MS, now - (profile.lastSeen || now))
  if (profile.lastWell < 0 || away < OFFLINE_MIN_MS) return null
  if (!isWellUnlocked(profile, profile.lastWell) || isMaxLevel(profile)) return null
  const steps = Math.floor(away / 1000 / TRAIN_INTERVAL)
  // Potions don't run while you're away.
  const gain = wellGain(profile, profile.lastWell, 0)
  const result = addWater(profile, Math.floor(steps * gain * OFFLINE_RATE))
  if (result.gain <= 0) return null
  return { water: result.gain, ms: away }
}

// --- Tutorial & badges ------------------------------------------------------------

/** Advances the tutorial if `event` completes the current step. */
export function advanceTutorial(profile, event) {
  const step = TUTORIAL[profile.tutorialStep]
  if (!step || step.event !== event) return false
  if (step.water && profile.water < step.water) return false
  profile.tutorialStep += 1
  return true
}

/** Awards a badge once. Returns the badge if newly awarded. */
export function awardBadge(profile, id) {
  if (!BADGES[id] || profile.badges.includes(id)) return null
  profile.badges.push(id)
  return { id, ...BADGES[id] }
}
