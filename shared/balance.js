/**
 * Every tunable number in the game. Rules live in logic.js; this file is only data,
 * so balancing never means touching code. `scripts/balance-sim.mjs` plays the game
 * with these numbers and prints the pacing (time to each rebirth, bucket and stage).
 *
 * Shared by client (display) and server (authority): both always agree on costs and
 * multipliers because they read the same table.
 *
 * The loop: scoop Water at a well -> run the escape course, pouring your Water into
 * each pit until one is too deep to fill -> claim the Wins pad on the furthest ledge
 * you reached -> better buckets, eggs and wells -> rebirth at max level for a bigger
 * Water multiplier and a higher cap -> fill deeper pits still.
 */

// --- Water and levels ---------------------------------------------------------------

/** Seconds between the scoops a well gives by itself, while you stand in it. */
export const TRAIN_INTERVAL = 0.6
/**
 * Tapping the screen is how you train - walking around earns nothing: each tap is one
 * scoop of your bucket - its power, multiplied, and times the well you're standing in
 * (x1 anywhere else). At most CLICK_RATE taps a second count, so an auto-clicker gains
 * nothing a quick finger doesn't. Standing in a well scoops by itself too, once every
 * TRAIN_INTERVAL: slower, but it keeps going while you rest.
 */
export const CLICK_RATE = 8

/**
 * Your level comes from your Water Power: reaching level L takes waterForLevel(L).
 * Each level needs LEVEL_GROWTH_EARLY times the last at first, easing towards
 * LEVEL_GROWTH_LATE: early rebirths multiply your gains many times over (a new well,
 * x2 from the rebirth itself, the next bucket), later ones much less, and the levels
 * keep step so every rebirth takes a little longer than the one before.
 */
export const LEVEL_BASE = 70
export const LEVEL_GROWTH_EARLY = 1.3
export const LEVEL_GROWTH_LATE = 1.097
export const LEVEL_GROWTH_FADE = 100
/** Levels past this are not reachable: the table stops here. */
export const MAX_LEVEL = 1200

const LEVEL_TABLE = (() => {
  const table = new Float64Array(MAX_LEVEL + 1)
  let need = LEVEL_BASE
  for (let level = 2; level <= MAX_LEVEL; level += 1) {
    table[level] = table[level - 1] + need
    const growth = LEVEL_GROWTH_LATE + (LEVEL_GROWTH_EARLY - LEVEL_GROWTH_LATE) * Math.exp(-level / LEVEL_GROWTH_FADE)
    need *= growth
  }
  return table
})()

/** Two significant figures: level thresholds read cleanly (2,300, not 2,317). */
const round2 = (n) => {
  if (n < 100) return Math.round(n)
  const step = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.round(n / step) * step
}

export const waterForLevel = (level) => (level <= 1 ? 0 : round2(LEVEL_TABLE[Math.min(MAX_LEVEL, level)]))

// --- Rebirth ----------------------------------------------------------------------

/** Max level by rebirth count: R0 = 15, R1 = 23, then +8 per rebirth. */
export const levelCap = (rebirths) => Math.min(MAX_LEVEL, 15 + 8 * Math.max(0, rebirths))

/**
 * Water multiplier from rebirths: R0 = x1, R1 = x2, R2 = x3 ... and from Rebirth
 * REBIRTH_BOOST.from on, every rebirth multiplies it by REBIRTH_BOOST.mult as well. Each
 * rebirth's 8 more levels need about twice the Water of the last's; early on new
 * buckets, wells and pets keep pace with that, but late in the game they run out, and
 * without the boost every rebirth would take twice as long as the one before.
 * scripts/tune-progression.mjs sets the two from the balance sim.
 */
export const REBIRTH_BOOST = { mult: 1.6, from: 18 }
export const rebirthMultiplier = (rebirths) => {
  const r = Math.max(0, rebirths)
  return (1 + r) * REBIRTH_BOOST.mult ** Math.max(0, r - REBIRTH_BOOST.from)
}

/**
 * From Rebirth 15, every 5th rebirth (15, 20, 25...) comes with a gift of eggs: late in
 * the game, when each rebirth takes longest, there's always one coming up. One more egg
 * every 10 rebirths, up to 6.
 */
export const REBIRTH_GIFT_FROM = 15
export const REBIRTH_GIFT_EVERY = 5
export function rebirthGift(rebirths) {
  if (rebirths < REBIRTH_GIFT_FROM || (rebirths - REBIRTH_GIFT_FROM) % REBIRTH_GIFT_EVERY !== 0) return null
  const amount = Math.min(6, 3 + Math.floor((rebirths - REBIRTH_GIFT_FROM) / 10))
  return { rebirths, item: 'eggVolcano', amount, label: `${amount} Volcano Eggs` }
}
/** The next rebirth after `rebirths` that brings a gift, and the gift. */
export function nextRebirthGift(rebirths) {
  const from = Math.max(REBIRTH_GIFT_FROM, rebirths + 1)
  const at = from + ((REBIRTH_GIFT_EVERY - ((from - REBIRTH_GIFT_FROM) % REBIRTH_GIFT_EVERY)) % REBIRTH_GIFT_EVERY)
  return rebirthGift(at)
}

/** Skipping straight to a rebirth costs this many max-level runs' worth of Wins. */
export const REBIRTH_SKIP_RUNS = 10

// --- Training wells ---------------------------------------------------------------

/**
 * Training wells, south to north in world.js order: round pools under a little roof.
 * Standing in one scoops Water every TRAIN_INTERVAL. `rebirths` = rebirths needed;
 * `product` = the SHOP pass that unlocks it instead.
 */
export const WELLS = [
  { id: 'pebble', name: 'Pebble Well', mult: 1, rebirths: 0 },
  { id: 'spring', name: 'Spring Well', mult: 2, rebirths: 1 },
  { id: 'fountain', name: 'Fountain Well', mult: 4, rebirths: 2 },
  { id: 'geyser', name: 'Geyser Well', mult: 10, rebirths: 4 },
  { id: 'waterfall', name: 'Waterfall Well', mult: 20, rebirths: 6 },
  { id: 'crystal', name: 'Crystal Well', mult: 40, product: 'wellVeryOp', tag: 'VERY OP!' },
  { id: 'galaxy', name: 'Galaxy Well', mult: 100, product: 'wellBest', tag: 'BEST OVERALL!' },
]

// --- Buckets ----------------------------------------------------------------------

/**
 * The buckets you carry. `power` is the Water every single scoop is worth before
 * multipliers (the "+1" of the Tiny Pail); `cost` is in Wins; `rarity` (RARITIES) is
 * shown on its stand. Any of them can be bought at the bucket shop, in any order: you
 * carry the best you own. Each is made of something different - plastic, wood, tin,
 * copper, candy, ice, lava, gold, gems, diamond, rainbow, galaxy... - and the further up
 * the list, the crazier and shinier it gets. About x2.6 power for about x3 the Wins
 * each. Prices are set by scripts/tune-economy.mjs from the Wins a player earns.
 */
export const BUCKETS = [
  { id: 'pail', name: 'Tiny Pail', power: 1, cost: 0, rarity: 'common' },
  // Cheap enough to buy with the Wins from your very first run.
  { id: 'beach', name: 'Beach Bucket', power: 3, cost: 1, rarity: 'common' },
  { id: 'wood', name: 'Wooden Bucket', power: 5, cost: 4, rarity: 'common' },
  { id: 'tin', name: 'Tin Bucket', power: 12, cost: 15, rarity: 'uncommon' },
  { id: 'copper', name: 'Copper Pail', power: 30, cost: 53, rarity: 'uncommon' },
  { id: 'bubblegum', name: 'Bubblegum Bucket', power: 75, cost: 180, rarity: 'rare' },
  { id: 'candy', name: 'Candy Cane Bucket', power: 200, cost: 600, rarity: 'rare' },
  { id: 'melon', name: 'Melon Bucket', power: 500, cost: 1900, rarity: 'rare' },
  { id: 'coral', name: 'Coral Bucket', power: 1250, cost: 6100, rarity: 'epic' },
  { id: 'ice', name: 'Ice Bucket', power: 3500, cost: 19000, rarity: 'epic' },
  { id: 'silver', name: 'Silver Bucket', power: 9000, cost: 59000, rarity: 'epic' },
  { id: 'slime', name: 'Slime Bucket', power: 23000, cost: 180000, rarity: 'epic' },
  { id: 'gold', name: 'Golden Bucket', power: 60000, cost: 520000, rarity: 'legendary' },
  { id: 'lava', name: 'Lava Bucket', power: 155000, cost: 1.5e6, rarity: 'legendary' },
  { id: 'emerald', name: 'Emerald Bucket', power: 400000, cost: 4.4e6, rarity: 'legendary' },
  { id: 'ruby', name: 'Ruby Bucket', power: 1.05e6, cost: 1.2e7, rarity: 'legendary' },
  { id: 'sapphire', name: 'Sapphire Bucket', power: 2.7e6, cost: 3.5e7, rarity: 'mythic' },
  { id: 'diamond', name: 'Diamond Bucket', power: 7e6, cost: 9.6e7, rarity: 'mythic' },
  { id: 'rainbow', name: 'Rainbow Bucket', power: 1.8e7, cost: 2.6e8, rarity: 'mythic' },
  { id: 'unicorn', name: 'Unicorn Bucket', power: 4.8e7, cost: 7.2e8, rarity: 'mythic' },
  { id: 'galaxy', name: 'Galaxy Bucket', power: 1.25e8, cost: 1.9e9, rarity: 'secret' },
  { id: 'dragon', name: 'Dragon Bucket', power: 3.3e8, cost: 5.2e9, rarity: 'secret' },
  { id: 'cosmic', name: 'Cosmic Bucket', power: 8.6e8, cost: 1.4e10, rarity: 'secret' },
  { id: 'infinity', name: 'Infinity Bucket', power: 2.2e9, cost: 3.6e10, rarity: 'secret' },
]

/**
 * Upgrading a bucket: up to BUCKET_STARS stars, each multiplying its power by STAR_POWER.
 * Star `s` costs STAR_SHARES[s - 1] of the next bucket's price, a little more each - so
 * while you save up for the next bucket there's always an upgrade a few minutes away,
 * and a new bucket is still the bigger step (x2.6 against x1.77 for all eight stars).
 * The last bucket, Infinity, has no limit: its stars go on for ever, priced off three
 * times its cost and each STAR_ENDLESS_GROWTH times the last past the eighth.
 */
export const BUCKET_STARS = 8
export const STAR_POWER = 1.074
export const STAR_SHARES = [0.08, 0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15]
export const STAR_ENDLESS_GROWTH = 1.12

/**
 * The bucket collection: every bucket you own past the free Tiny Pail adds
 * COLLECTION_BONUS to all your Water gains (+46% for all 24), so even the cheap old ones
 * are worth having.
 */
export const COLLECTION_BONUS = 0.02

/** How many stars bucket `index` (into BUCKETS) can take: the last, endless. */
export const maxStars = (index) => (index === BUCKETS.length - 1 ? Infinity : BUCKET_STARS)

/** Wins for star `star` (1, 2, ...) of bucket `index` (into BUCKETS). */
export function starPrice(index, star) {
  const next = index + 1 < BUCKETS.length ? BUCKETS[index + 1].cost : BUCKETS[index].cost * 3
  const past = Math.max(0, star - BUCKET_STARS)
  const raw = next * STAR_SHARES[Math.max(0, Math.min(BUCKET_STARS, star) - 1)] * STAR_ENDLESS_GROWTH ** past
  if (raw < 100) return Math.max(1, Math.round(raw))
  const step = 10 ** (Math.floor(Math.log10(raw)) - 1)
  return Math.round(raw / step) * step
}

// --- The escape course --------------------------------------------------------------

/**
 * The course's sixty stages, north out of the lobby: stage 0 is the start, and every
 * stage after it is a pit to fill and the ledge beyond it. `level` is the level whose
 * Water Power fills its pit to the brim - its `need`, waterForLevel(level) - so each
 * gate says which level it takes (less fills it partway, too low to swim across); each
 * needs about twice the Water of the last. `wins` is what the ledge's Wins pad pays
 * (claiming it ends your run and takes you back to the lobby): 3, 5, 10 and growing
 * from there. `discover` is a one-off prize the first time you ever reach the ledge.
 * Generated by scripts/gen-stages.py.
 */
const STAGE_TABLE = [
  { id: 'grassy', name: 'Grassy Meadow', level: 0, wins: 0, discover: 0 },
  { id: 'autumn', name: 'Autumn Forest', level: 2, wins: 3, discover: 1 },
  { id: 'desert', name: 'Desert Canyon', level: 3, wins: 5, discover: 1 },
  { id: 'beach', name: 'Sunny Beach', level: 4, wins: 9, discover: 1 },
  { id: 'jungle', name: 'Jungle Ruins', level: 5, wins: 17, discover: 3 },
  { id: 'frozen', name: 'Frozen Peaks', level: 6, wins: 30, discover: 4 },
  { id: 'cherry', name: 'Cherry Blossom', level: 8, wins: 54, discover: 8 },
  { id: 'candy', name: 'Candy Land', level: 10, wins: 81, discover: 12 },
  { id: 'mushroom', name: 'Mushroom Valley', level: 12, wins: 110, discover: 16 },
  { id: 'volcano', name: 'Lava Volcano', level: 15, wins: 160, discover: 24 },
  { id: 'swamp', name: 'Lily Swamp', level: 18, wins: 220, discover: 33 },
  { id: 'crystal', name: 'Crystal Caves', level: 21, wins: 300, discover: 45 },
  { id: 'ocean', name: 'Coral Reef', level: 24, wins: 420, discover: 63 },
  { id: 'neon', name: 'Neon City', level: 27, wins: 590, discover: 88 },
  { id: 'sky', name: 'Cloud Kingdom', level: 30, wins: 830, discover: 120 },
  { id: 'rainbow', name: 'Rainbow Road', level: 33, wins: 1200, discover: 180 },
  { id: 'moon', name: 'Moon Base', level: 36, wins: 1600, discover: 240 },
  { id: 'aurora', name: 'Aurora Tundra', level: 39, wins: 2300, discover: 340 },
  { id: 'space', name: 'Outer Space', level: 43, wins: 3300, discover: 500 },
  { id: 'cosmic', name: 'Cosmic Core', level: 46, wins: 4700, discover: 700 },
  { id: 'hills', name: 'Green Hills', level: 50, wins: 6600, discover: 990 },
  { id: 'maple', name: 'Maple Woods', level: 53, wins: 9400, discover: 1400 },
  { id: 'dunes', name: 'Dune Sea', level: 57, wins: 13000, discover: 2000 },
  { id: 'island', name: 'Palm Island', level: 61, wins: 19000, discover: 2800 },
  { id: 'temple', name: 'Lost Temple', level: 65, wins: 28000, discover: 4200 },
  { id: 'glacier', name: 'Glacier Pass', level: 69, wins: 40000, discover: 6000 },
  { id: 'sakura', name: 'Sakura Garden', level: 73, wins: 57000, discover: 8600 },
  { id: 'sweets', name: 'Sweet Valley', level: 77, wins: 82000, discover: 12000 },
  { id: 'fungi', name: 'Fungi Forest', level: 81, wins: 120000, discover: 18000 },
  { id: 'magma', name: 'Magma Core', level: 86, wins: 170000, discover: 26000 },
  { id: 'marsh', name: 'Green Marsh', level: 90, wins: 250000, discover: 38000 },
  { id: 'gems', name: 'Gem Mines', level: 95, wins: 360000, discover: 54000 },
  { id: 'deep', name: 'Deep Ocean', level: 100, wins: 530000, discover: 80000 },
  { id: 'cyber', name: 'Cyber City', level: 105, wins: 770000, discover: 120000 },
  { id: 'castle', name: 'Sky Castle', level: 110, wins: 1.1e6, discover: 160000 },
  { id: 'prism', name: 'Prism Path', level: 115, wins: 1.6e6, discover: 240000 },
  { id: 'lunar', name: 'Lunar Craters', level: 120, wins: 2.4e6, discover: 360000 },
  { id: 'lights', name: 'Northern Lights', level: 126, wins: 3.6e6, discover: 540000 },
  { id: 'galaxy', name: 'Galaxy Rift', level: 131, wins: 5.2e6, discover: 780000 },
  { id: 'infinity', name: 'Infinity', level: 137, wins: 7.7e6, discover: 1.2e6 },
  { id: 'sunflower', name: 'Sunflower Fields', level: 143, wins: 1.1e7, discover: 1.6e6 },
  { id: 'harvest', name: 'Harvest Valley', level: 149, wins: 1.7e7, discover: 2.6e6 },
  { id: 'oasis', name: 'Golden Oasis', level: 155, wins: 2.5e7, discover: 3.8e6 },
  { id: 'lagoon', name: 'Blue Lagoon', level: 161, wins: 3.7e7, discover: 5.6e6 },
  { id: 'canopy', name: 'Treetop Canopy', level: 167, wins: 5.6e7, discover: 8.4e6 },
  { id: 'yeti', name: 'Yeti Mountain', level: 174, wins: 8.3e7, discover: 1.2e7 },
  { id: 'lantern', name: 'Lantern Garden', level: 180, wins: 1.2e8, discover: 1.8e7 },
  { id: 'cupcake', name: 'Cupcake Kingdom', level: 187, wins: 1.9e8, discover: 2.8e7 },
  { id: 'glowcap', name: 'Glowcap Grotto', level: 194, wins: 2.8e8, discover: 4.2e7 },
  { id: 'inferno', name: 'Inferno Peak', level: 201, wins: 4.2e8, discover: 6.3e7 },
  { id: 'bayou', name: 'Firefly Bayou', level: 208, wins: 6.4e8, discover: 9.6e7 },
  { id: 'geode', name: 'Geode Valley', level: 216, wins: 9.6e8, discover: 1.4e8 },
  { id: 'atlantis', name: 'Atlantis', level: 223, wins: 1.5e9, discover: 2.2e8 },
  { id: 'arcade', name: 'Arcade Avenue', level: 231, wins: 2.2e9, discover: 3.3e8 },
  { id: 'islands', name: 'Sky Islands', level: 239, wins: 3.3e9, discover: 5e8 },
  { id: 'unicorn', name: 'Unicorn Trail', level: 247, wins: 5.1e9, discover: 7.6e8 },
  { id: 'mars', name: 'Red Planet', level: 255, wins: 7.7e9, discover: 1.2e9 },
  { id: 'comet', name: 'Comet Ice', level: 263, wins: 1.2e10, discover: 1.8e9 },
  { id: 'nebula', name: 'Nebula', level: 271, wins: 1.8e10, discover: 2.7e9 },
  { id: 'beyond', name: 'The Beyond', level: 279, wins: 2.8e10, discover: 4.2e9 },
]

/**
 * Pouring. Standing at a pit's rim you tip your bucket out, pouring POUR_RATE times your
 * Water Power into the pit every second until it's full - so the stronger you are, the
 * quicker it fills. Each pit holds `capacity` Water: what its minimum Water Power
 * (`need`, its level's) pours in POUR_AT_MIN(stage) seconds. Below that minimum you're
 * too weak to fill it at all; at twice it, it takes half as long, and so on - never
 * quicker than POUR_MIN_SECONDS, so even a puddle splashes full. The first pits fill in
 * moments; further on they hold far more and take a while even when you're ready.
 */
export const POUR_RATE = 1
export const POUR_MIN_SECONDS = 0.6
/**
 * Tapping while you pour tips the bucket harder: each tap pours POUR_TAP seconds' worth
 * more at once (taps count at most CLICK_RATE a second, as everywhere) - so a quick
 * finger fills a pit two or three times as fast as standing there.
 */
export const POUR_TAP = 0.25
/**
 * Pouring together: everyone else at the rim of the pit you're filling (in your world)
 * pours alongside you, each adding CO_OP_HELP of your speed, up to CO_OP_MAX of them -
 * and when it's full each of them earns CO_OP_TIP of that pit's Wins pad for helping.
 */
export const CO_OP_HELP = 0.5
export const CO_OP_MAX = 3
export const CO_OP_TIP = 0.1
/** How much faster a pit fills with `helpers` others pouring in too. */
export const coopSpeed = (helpers) => 1 + CO_OP_HELP * Math.min(CO_OP_MAX, Math.max(0, helpers))

/** Each Wins coin over a ledge (world.coinsOf) pays this share of the ledge's Wins pad. */
export const COIN_SHARE = 0.03
export const POUR_AT_MIN = (stage) => Math.min(40, 5 + 2.5 * Math.max(0, stage - 1))

/**
 * Every MEGA_EVERY-th pit, in both worlds, is a Mega Pit: MEGA_LENGTH metres longer,
 * holding MEGA_CAPACITY times the Water, under a grander gate - and the first time you
 * reach the ledge beyond it, its first-visit prize is MEGA_PRIZE times as big and its
 * treasure chest opens (MEGA_CHESTS: eggs, into Items). A big goal every ten stages.
 */
export const MEGA_EVERY = 10
export const MEGA_LENGTH = 5
export const MEGA_CAPACITY = 1.5
export const MEGA_PRIZE = 5
export const isMegaStage = (stage) => stage > 0 && stage % MEGA_EVERY === 0

/** What each world's Mega Pit chests hold, by stage: `{ item, amount }` (ITEMS). */
export const MEGA_CHESTS = [
  {
    10: { item: 'eggMeadow', amount: 1 },
    20: { item: 'eggSunset', amount: 1 },
    30: { item: 'eggUnicorn', amount: 1 },
    40: { item: 'eggVolcano', amount: 1 },
    50: { item: 'eggVolcano', amount: 2 },
  },
  {
    10: { item: 'eggVolcano', amount: 2 },
    20: { item: 'eggVolcano', amount: 3 },
    30: { item: 'eggVolcano', amount: 4 },
    40: { item: 'eggVolcano', amount: 5 },
    50: { item: 'eggVolcano', amount: 6 },
  },
]

/** Pit `stage` is this long: 10 m at first, growing to about 27 m at the last (Mega Pits longer). */
export const pitLength = (stage) => Math.round((10 + 0.3 * Math.max(0, stage - 1)) * 2) / 2 + (isMegaStage(stage) ? MEGA_LENGTH : 0)

/** A stage's Water: its `need` (to fill it at all) and `capacity` (to the brim), and a Mega Pit's bigger prize. */
const withWater = (stage, i) => {
  const need = stage.level ? waterForLevel(stage.level) : 0
  const mega = isMegaStage(i)
  return {
    ...stage,
    need,
    capacity: need * POUR_AT_MIN(i) * (mega ? MEGA_CAPACITY : 1),
    discover: stage.discover * (mega ? MEGA_PRIZE : 1),
  }
}

export const STAGES = STAGE_TABLE.map(withWater)

/** Stage 0 is the start: the first pit is STAGES[1]'s. */
export const LAST_STAGE = STAGES.length - 1

/**
 * The Skip pad on each ledge fills the next pit for you - and every pit before it -
 * on every run until your next rebirth, for this many of that stage's Wins pads: a few
 * runs' worth, so it's a head start on the next stage, never a way to make Wins.
 */
export const SKIP_RUNS = 3

/**
 * About how long a run out to ledge `stage` takes on foot, not counting the pouring:
 * across the start, then every pit swum (SWIM_PACE metres a second) and every ledge
 * walked (WALK_PACE), and a moment to step onto the pad. What Auto Win waits (with the
 * pouring) between claims, and what the balance sim charges.
 */
export const RUN_BASE = 6
const WALK_PACE = 10
const SWIM_PACE = 7.5
const RUN_TABLE = (() => {
  const t = new Float64Array(STAGES.length)
  t[0] = RUN_BASE
  for (let i = 1; i < STAGES.length; i += 1) t[i] = t[i - 1] + pitLength(i) / SWIM_PACE + 12 / WALK_PACE
  return t
})()
export const runSeconds = (stage) => RUN_TABLE[Math.max(0, Math.min(STAGES.length - 1, stage))]

// --- Pets & eggs ------------------------------------------------------------------

export const RARITIES = {
  common: { name: 'Common', color: '#b9c3cf', order: 0 },
  uncommon: { name: 'Uncommon', color: '#4ade80', order: 1 },
  rare: { name: 'Rare', color: '#38bdf8', order: 2 },
  epic: { name: 'Epic', color: '#b15cff', order: 3 },
  legendary: { name: 'Legendary', color: '#ffc41f', order: 4 },
  mythic: { name: 'Mythic', color: '#ff3b6b', order: 5 },
  secret: { name: 'Secret', color: '#ff5bd8', order: 6 },
}

/** `mult` multiplies Water gains. Equipped pets stack additively (see logic.js). */
export const PETS = {
  cat: { name: 'Cat', rarity: 'common', mult: 1.1 },
  dog: { name: 'Dog', rarity: 'common', mult: 1.15 },
  bunny: { name: 'Bunny', rarity: 'uncommon', mult: 1.25 },
  bear: { name: 'Bear', rarity: 'rare', mult: 1.5 },
  cow: { name: 'Cow', rarity: 'uncommon', mult: 1.4 },
  parrot: { name: 'Parrot', rarity: 'rare', mult: 1.7 },
  fox: { name: 'Fox', rarity: 'epic', mult: 2.2 },
  tiger: { name: 'Tiger', rarity: 'legendary', mult: 3 },
  flamingo: { name: 'Flamingo', rarity: 'uncommon', mult: 2.5 },
  turtle: { name: 'Turtle', rarity: 'rare', mult: 3.2 },
  owl: { name: 'Owl', rarity: 'epic', mult: 4.5 },
  phoenix: { name: 'Phoenix', rarity: 'legendary', mult: 7 },
  pony: { name: 'Pony', rarity: 'rare', mult: 5 },
  unicorn: { name: 'Unicorn', rarity: 'epic', mult: 8 },
  pegasus: { name: 'Pegasus', rarity: 'legendary', mult: 13 },
  salamander: { name: 'Salamander', rarity: 'rare', mult: 10 },
  firebird: { name: 'Fire Bird', rarity: 'epic', mult: 16 },
  golem: { name: 'Magma Golem', rarity: 'legendary', mult: 26 },
  inferno: { name: 'Inferno Wolf', rarity: 'mythic', mult: 45 },
  dragon: { name: 'Dragon', rarity: 'epic', mult: 2.5 },
  crab: { name: 'Lucky Crab', rarity: 'uncommon', mult: 1.2 },
  sphinx: { name: 'Sphinx', rarity: 'secret', mult: 80 },
}

/**
 * Eggs, bought with Wins. `pets` are [petId, weight] - weights are percentages and
 * sum to 100. Each egg is priced at about the Wins of a few runs at the stage of the
 * game whose pets it beats.
 */
export const EGGS = {
  basic: { name: 'Basic', cost: { wins: 3 }, pets: [['cat', 45], ['dog', 30], ['bunny', 20], ['bear', 5]] },
  meadow: { name: 'Grass', cost: { wins: 24 }, pets: [['cow', 45], ['parrot', 30], ['fox', 20], ['tiger', 5]] },
  sunset: { name: 'Sunset', cost: { wins: 150 }, pets: [['flamingo', 45], ['turtle', 30], ['owl', 20], ['phoenix', 5]] },
  unicorn: { name: 'Unicorn', cost: { wins: 1200 }, pets: [['pony', 50], ['unicorn', 35], ['pegasus', 15]] },
  volcano: { name: 'Volcano', cost: { wins: 7000 }, pets: [['salamander', 50], ['firebird', 30], ['golem', 15], ['inferno', 5]] },
}

export const MAX_EQUIPPED_PETS = 3
/**
 * Pet fusion: GOLDEN_FUSE of the same pet (not golden ones) make one Golden pet, whose
 * bonus is GOLDEN_BOOST times the pet's - a use for every spare hatch.
 */
export const GOLDEN_FUSE = 3
export const GOLDEN_BOOST = 2
export const MAX_PET_INVENTORY = 60
/** Multi-hatch opens this many at once, for that many times the cost. */
export const MULTI_HATCH = 3

// --- Items, boosts, rewards -------------------------------------------------------

export const POTION_DURATION_MS = 5 * 60 * 1000

export const ITEMS = {
  potionWater: { name: 'x2 Water Potion', kind: 'potion', boost: 'water', durationMs: POTION_DURATION_MS },
  potionWins: { name: 'x2 Wins Potion', kind: 'potion', boost: 'wins', durationMs: POTION_DURATION_MS },
  eggMeadow: { name: 'Grass Egg', kind: 'egg', egg: 'meadow' },
  eggSunset: { name: 'Sunset Egg', kind: 'egg', egg: 'sunset' },
  eggUnicorn: { name: 'Unicorn Egg', kind: 'egg', egg: 'unicorn' },
  eggVolcano: { name: 'Volcano Egg', kind: 'egg', egg: 'volcano' },
}

/** 7-day cycle; day N unlocks N x 24h after the cycle started. */
export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000
export const DAILY_REWARDS = [
  { label: 'x2 Wins', icon: 'potionWins', sub: '5m', grant: { item: 'potionWins' } },
  { label: 'Dragon', icon: 'pet:dragon', sub: 'x1', grant: { pet: 'dragon' } },
  { label: 'x2 Water', icon: 'potionWater', sub: '5m', grant: { item: 'potionWater' } },
  { label: 'Unicorn Egg', icon: 'egg:unicorn', sub: 'x1', grant: { item: 'eggUnicorn' } },
  { label: 'x2 Water', icon: 'potionWater', sub: '5m', grant: { item: 'potionWater' } },
  { label: 'x2 Wins', icon: 'potionWins', sub: '5m', grant: { item: 'potionWins' } },
  { label: 'Volcano Egg', icon: 'egg:volcano', sub: 'x1', grant: { item: 'eggVolcano' } },
]

/**
 * Claimable once each per session, after this many minutes played: something to look
 * forward to every few minutes for the first hour.
 */
export const PLAYTIME_REWARDS = [
  { minutes: 3, label: '+5 Wins', icon: 'trophy', grant: { wins: 5 } },
  { minutes: 8, label: 'x2 Water', icon: 'potionWater', grant: { item: 'potionWater' } },
  { minutes: 15, label: 'Grass Egg', icon: 'egg:meadow', grant: { item: 'eggMeadow' } },
  { minutes: 25, label: 'x2 Wins', icon: 'potionWins', grant: { item: 'potionWins' } },
  { minutes: 35, label: '+50 Wins', icon: 'trophy', grant: { wins: 50 } },
  { minutes: 45, label: 'Sunset Egg', icon: 'egg:sunset', grant: { item: 'eggSunset' } },
  { minutes: 60, label: 'x2 Water', icon: 'potionWater', grant: { item: 'potionWater' } },
  { minutes: 90, label: 'Unicorn Egg', icon: 'egg:unicorn', grant: { item: 'eggUnicorn' } },
]

/**
 * Daily quests: every day (UTC) QUESTS_PER_DAY of these, the same for everyone, each
 * with its reward (QUEST_REWARDS, in order) the moment it's done - and QUEST_BONUS for
 * finishing all of them. `text` reads with the target in place of {n}.
 */
export const QUESTS = [
  { id: 'taps', text: 'Tap {n} times', target: 400 },
  { id: 'pits', text: 'Fill {n} pits', target: 25 },
  { id: 'claims', text: 'Claim {n} Wins pads', target: 6 },
  { id: 'coins', text: 'Pick up {n} coins', target: 30 },
  { id: 'hatch', text: 'Hatch {n} eggs', target: 3 },
  { id: 'rebirth', text: 'Rebirth {n} times', target: 2 },
  { id: 'stars', text: 'Upgrade a bucket {n} times', target: 3 },
]
export const QUESTS_PER_DAY = 3
export const QUEST_REWARDS = [
  { item: 'potionWater', amount: 1 },
  { item: 'potionWins', amount: 1 },
  { item: 'eggUnicorn', amount: 1 },
]
export const QUEST_BONUS = { item: 'eggVolcano', amount: 2 }

/**
 * The weekly board: Wins earned from Wins pads and coins since Monday 00:00 UTC. When
 * the week turns, its top 10 get these (the first time each is back): the best rank
 * whose `upTo` covers yours.
 */
export const WEEKLY_REWARDS = [
  { upTo: 1, item: 'eggVolcano', amount: 10 },
  { upTo: 3, item: 'eggVolcano', amount: 6 },
  { upTo: 10, item: 'eggVolcano', amount: 3 },
]

/** The stand by spawn: a pet the first time, a potion on later sessions. */
export const FREE_REWARD = { firstTime: { pet: 'crab' }, repeat: { item: 'potionWater' } }

/** Offline training: a quarter of your well's rate, for up to 8 hours away. */
export const OFFLINE_RATE = 0.25
export const OFFLINE_MAX_MS = 8 * 60 * 60 * 1000
export const OFFLINE_MIN_MS = 60 * 1000

/**
 * The world portal (placed by PORTALS in world.js): its name, and the World 1 stage you
 * must have reached to step through - its last: escape World 1 and World 2 opens.
 * Stepping through earns the badge of the same id.
 */
export const WORLD_PORTALS = {
  world2: { name: 'World 2', stage: LAST_STAGE },
}

// --- Worlds -----------------------------------------------------------------------

/**
 * World 2, through the portal once you've escaped World 1: the game's second half. The
 * same course, under its own names, but its pits carry on from World 1's (see
 * gen-stages.py): its first ones are as deep as World 1's last few - you fill them on
 * your first run there - and from there on they're deeper than anything in World 1.
 * Every Wins pad and first-visit prize on it pays `wins` times its pit's Wins, so it
 * always pays better than World 1. Coming back (the same portal) costs nothing.
 */
export const WORLDS = [
  { id: 'world1', name: 'World 1', wins: 1 },
  { id: 'world2', name: 'World 2', wins: 2 },
]

/**
 * World 2's pits, stage by stage: [level, wins, discover] before the world's `wins`.
 * Generated by scripts/gen-stages.py.
 */
const WORLD2_TABLE = [
  [0, 0, 0],
  [149, 1.7e7, 2.6e6],
  [155, 2.5e7, 3.8e6],
  [161, 3.7e7, 5.6e6],
  [167, 5.6e7, 8.4e6],
  [174, 8.3e7, 1.2e7],
  [180, 1.2e8, 1.8e7],
  [187, 1.9e8, 2.8e7],
  [194, 2.8e8, 4.2e7],
  [201, 4.2e8, 6.3e7],
  [208, 6.4e8, 9.6e7],
  [216, 9.6e8, 1.4e8],
  [223, 1.5e9, 2.2e8],
  [231, 2.2e9, 3.3e8],
  [239, 3.3e9, 5e8],
  [247, 5.1e9, 7.6e8],
  [255, 7.7e9, 1.2e9],
  [263, 1.2e10, 1.8e9],
  [271, 1.8e10, 2.7e9],
  [279, 2.8e10, 4.2e9],
  [288, 4.2e10, 6.3e9],
  [297, 6.5e10, 9.8e9],
  [305, 1e11, 1.5e10],
  [314, 1.5e11, 2.2e10],
  [323, 2.4e11, 3.6e10],
  [332, 3.6e11, 5.4e10],
  [341, 5.6e11, 8.4e10],
  [350, 8.6e11, 1.3e11],
  [359, 1.3e12, 2e11],
  [368, 2e12, 3e11],
  [377, 3.1e12, 4.6e11],
  [387, 4.8e12, 7.2e11],
  [396, 7.4e12, 1.1e12],
  [405, 1.1e13, 1.6e12],
  [415, 1.8e13, 2.7e12],
  [424, 2.7e13, 4e12],
  [433, 4.1e13, 6.2e12],
  [443, 6.4e13, 9.6e12],
  [452, 9.8e13, 1.5e13],
  [462, 1.5e14, 2.2e13],
  [471, 2.3e14, 3.4e13],
  [481, 3.6e14, 5.4e13],
  [490, 5.5e14, 8.2e13],
  [500, 8.4e14, 1.3e14],
  [509, 1.3e15, 2e14],
  [519, 2e15, 3e14],
  [528, 3.1e15, 4.6e14],
  [538, 4.7e15, 7e14],
  [548, 7.2e15, 1.1e15],
  [557, 1.1e16, 1.6e15],
  [567, 1.7e16, 2.6e15],
  [576, 2.6e16, 3.9e15],
  [586, 4e16, 6e15],
  [596, 6.2e16, 9.3e15],
  [605, 9.5e16, 1.4e16],
  [615, 1.5e17, 2.2e16],
  [624, 2.3e17, 3.4e16],
  [634, 3.5e17, 5.2e16],
  [644, 5.3e17, 8e16],
  [653, 8.2e17, 1.2e17],
]

/** World 2's stages: [id, name], one for each of World 1's. */
const WORLD2_STAGES = [
  ['w2-lollipop', 'Lollipop Lane'],
  ['w2-rainbow-bridge', 'Rainbow Bridge'],
  ['w2-balloon', 'Balloon Skies'],
  ['w2-gem-garden', 'Gem Garden'],
  ['w2-pixel', 'Pixel Park'],
  ['w2-blossom', 'Blossom Bay'],
  ['w2-toadstool', 'Toadstool Town'],
  ['w2-bubble', 'Bubble Lagoon'],
  ['w2-polar', 'Polar Lights'],
  ['w2-moonbounce', 'Moonbounce'],
  ['w2-dragon-den', "Dragon's Den"],
  ['w2-monkey', 'Monkey Jungle'],
  ['w2-froggy', 'Froggy Pond'],
  ['w2-penguin', 'Penguin Slopes'],
  ['w2-pirate', 'Pirate Cove'],
  ['w2-pharaoh', 'Pharaoh Dunes'],
  ['w2-acorn', 'Acorn Woods'],
  ['w2-bunny', 'Bunny Hills'],
  ['w2-rocket', 'Rocket Run'],
  ['w2-star-factory', 'Star Factory'],
  ['w2-gumdrop', 'Gumdrop Hills'],
  ['w2-unicorn-meadow', 'Unicorn Meadow'],
  ['w2-floating', 'Floating Isles'],
  ['w2-amethyst', 'Amethyst Hollow'],
  ['w2-robot', 'Robot City'],
  ['w2-tea', 'Tea Garden'],
  ['w2-fairy', 'Fairy Ring'],
  ['w2-shark', 'Shark Reef'],
  ['w2-snow-owl', 'Snow Owl Peak'],
  ['w2-crater', 'Crater Camp'],
  ['w2-fire-falls', 'Fire Falls'],
  ['w2-tiger', 'Tiger Temple'],
  ['w2-gator', 'Gator Bayou'],
  ['w2-yeti', 'Yeti Cave'],
  ['w2-treasure', 'Treasure Island'],
  ['w2-cactus', 'Cactus Canyon'],
  ['w2-maple', 'Maple Mill'],
  ['w2-windmill', 'Windmill Farm'],
  ['w2-asteroid', 'Asteroid Belt'],
  ['w2-supernova', 'Supernova'],
  ['w2-chocolate', 'Chocolate River'],
  ['w2-prism', 'Prism Palace'],
  ['w2-thunder', 'Thunder Clouds'],
  ['w2-diamond-depths', 'Diamond Depths'],
  ['w2-hologram', 'Hologram Highway'],
  ['w2-dragon-garden', 'Dragon Garden'],
  ['w2-glow-forest', 'Glow Forest'],
  ['w2-kraken', 'Kraken Deep'],
  ['w2-frost-crown', 'Frost Crown'],
  ['w2-saturn', 'Saturn Rings'],
  ['w2-magma-throne', 'Magma Throne'],
  ['w2-dino', 'Dino Valley'],
  ['w2-lotus', 'Lotus Marsh'],
  ['w2-ice-palace', 'Ice Palace'],
  ['w2-mermaid', 'Mermaid Shores'],
  ['w2-sphinx-sands', 'Sphinx Sands'],
  ['w2-golden-grove', 'Golden Grove'],
  ['w2-clover', 'Clover Kingdom'],
  ['w2-black-hole', 'Black Hole'],
  ['w2-multiverse', 'The Multiverse'],
]
const WORLD2 = WORLD2_TABLE.map(([level, wins, discover], i) => {
  const [id, name] = WORLD2_STAGES[i]
  const mult = WORLDS[1].wins
  return withWater({ id, name, level, wins: wins * mult, discover: discover * mult }, i)
})

/** Each world's stages, as STAGES: `WORLD_STAGES[profile.world]`. */
export const WORLD_STAGES = [STAGES, WORLD2]
export const stagesOf = (world) => WORLD_STAGES[world] ?? STAGES

// --- Shop -------------------------------------------------------------------------

/**
 * The shop. Wins are the game's only currency: everything here, like buckets and eggs,
 * is bought with them. `pass` = permanent unlock; `consumable` = grants every time.
 */
export const SHOP = {
  waterX2: { name: 'x2 Water', price: 80, kind: 'pass' },
  winsX2: { name: 'x2 Wins', price: 500, kind: 'pass' },
  autoWin: { name: 'Auto Win', price: 30, kind: 'pass' },
  wellVeryOp: { name: 'VERY OP! Well', price: 30000, kind: 'pass' },
  wellBest: { name: 'BEST OVERALL! Well', price: 500000, kind: 'pass' },
  sphinx: { name: 'Sphinx', price: 500000, kind: 'consumable', grant: { pet: 'sphinx' }, stock: 1000 },
}

/**
 * Cosmetics, bought with Wins in the Store: looks only, no power - something to spend a
 * late game's Wins on and show off. The colour of the Water you pour (`color`, or
 * 'rainbow'), and a trail of sparkles behind you as you move (`palette`: the particle
 * colours, Particles.jsx; trails need a graphics level with particles). The first of
 * each is everyone's from the start.
 */
export const STREAMS = {
  water: { name: 'Clear Water', color: '#33bfff', price: 0 },
  mint: { name: 'Mint Splash', color: '#5dffb0', price: 5000 },
  pink: { name: 'Bubblegum Pour', color: '#ff7ad6', price: 2e6 },
  gold: { name: 'Liquid Gold', color: '#ffc824', price: 1e9 },
  lava: { name: 'Lava Flow', color: '#ff6a1e', price: 1e12 },
  galaxy: { name: 'Galaxy Pour', color: '#a56bff', price: 1e15 },
  rainbow: { name: 'Rainbow Pour', color: 'rainbow', price: 1e18 },
}
export const TRAILS = {
  none: { name: 'No Trail', palette: null, price: 0 },
  bubbles: { name: 'Bubbles', palette: 'water', price: 20000 },
  sparkle: { name: 'Gold Sparkle', palette: 'gold', price: 5e7 },
  confetti: { name: 'Party Confetti', palette: 'confetti', price: 5e10 },
  stardust: { name: 'Stardust', palette: 'galaxy', price: 5e13 },
  fire: { name: 'Fire Trail', palette: 'lava', price: 5e16 },
}
export const COSMETICS = { stream: STREAMS, trail: TRAILS }

/**
 * Boxity Gems products, by sku. Prices live in Boxity's catalog, never here: the game
 * only names the sku and, once Boxity confirms the sale, grants what it says. Wins
 * packs grow with you: `winsRuns` max-level runs' worth of Wins.
 */
export const GEM_PRODUCTS = {
  wins_small: { name: 'Pile of Wins', blurb: '10 max-level runs of Wins', icon: 'trophy', grant: { winsRuns: 10 } },
  wins_big: { name: 'Mountain of Wins', blurb: '60 max-level runs of Wins', icon: 'trophy', grant: { winsRuns: 60 } },
  potion_bundle: { name: 'Potion Bundle', blurb: '3 x2 Water + 3 x2 Wins potions', icon: 'potionWater', grant: { items: { potionWater: 3, potionWins: 3 } } },
  volcano_eggs: { name: '3 Volcano Eggs', blurb: 'The best pets in the game', icon: 'egg:volcano', grant: { items: { eggVolcano: 3 } } },
  auto_win: { name: 'Auto Win', blurb: 'Claims your best ledge’s Wins at the start line', icon: 'bucket', grant: { pass: 'autoWin' } },
  water_x2: { name: 'x2 Water', blurb: 'Double every Water gain, forever', icon: 'drop', grant: { pass: 'waterX2' } },
  wins_x2: { name: 'x2 Wins', blurb: 'Double every Wins pad, forever', icon: 'trophy', grant: { pass: 'winsX2' } },
  well_best: { name: 'Galaxy Well', blurb: 'Unlocks the x100 Galaxy Well', icon: 'portal', grant: { pass: 'wellBest' } },
}

/**
 * Rewarded ads (Boxity): watch one to earn this. Placement names are lowercase, digits
 * and hyphens. `cooldownMs` keeps a player from chaining them.
 */
export const AD_REWARDS = {
  'water-potion': { label: 'x2 Water Potion', icon: 'potionWater', grant: { item: 'potionWater' }, cooldownMs: 3 * 60 * 1000 },
  'wins-potion': { label: 'x2 Wins Potion', icon: 'potionWins', grant: { item: 'potionWins' }, cooldownMs: 3 * 60 * 1000 },
}

/** Sphinx stock shown before the server reports the live count. */
export const SPHINX_STOCK_DEFAULT = 954

/**
 * The three Water packs under the level bar. They grow with you: each gives `share`
 * of the Water your next level needs, for `runs` runs' worth of Wins at that Water.
 * Packs fill you up to your max level, no further: past it, only a rebirth takes you on.
 */
export const WATER_PACKS = [
  { share: 1, runs: 1 },
  { share: 5, runs: 4 },
  { share: 20, runs: 12 },
]

// --- Tutorial & badges ------------------------------------------------------------

/**
 * The guide for new players: get Water (tapping, or at a well), run out and fill a pit or two, claim
 * the Wins pad, spend the Wins on a bucket. Each step completes when its event fires
 * (and, with `water`, once you have that much); after the last the guide is done.
 */
export const TUTORIAL = [
  { text: 'Stand in the well and tap to scoop Water', event: 'train', target: 'well0', water: 140 },
  { text: 'Fill the pits, then grab the Wins pad!', event: 'claim', target: 'course' },
  { text: 'Buy a new bucket with your Wins!', event: 'buyBucket', target: 'buckets' },
]

export const BADGES = {
  firstWin: { name: 'First Escape' },
  firstRebirth: { name: 'First Rebirth' },
  firstPet: { name: 'Pet Owner' },
  firstSkip: { name: 'Shortcut Taker' },
  stage10: { name: 'Pit Filler' },
  space: { name: 'Space Swimmer' },
  cosmic: { name: 'Great Escape' },
  world2: { name: 'World Traveller' },
}
