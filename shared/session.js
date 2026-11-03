import { BUCKETS, CLICK_RATE, coopSpeed, COSMETICS, EGGS, ITEMS, LAST_STAGE, MULTI_HATCH, PETS, POUR_TAP, runSeconds, SHOP, STAGES, TRAIN_INTERVAL, WELLS } from './balance.js'
import { formatMultiplier } from './format.js'
import {
  advanceQuest,
  advanceTutorial,
  applyAdReward,
  applyClaim,
  applyCoin,
  applyCoopTip,
  applyClick,
  applyGemProduct,
  applyRebirth,
  applySkip,
  applyTrain,
  awardBadge,
  bestRunStage,
  buyBucket,
  buyCosmetic,
  buyShopItem,
  buyWaterPack,
  claimDaily,
  claimFreeReward,
  claimPlaytime,
  createRun,
  createSession,
  deletePet,
  equipBestPets,
  equipBucket,
  fusePets,
  equipPet,
  hatchEgg,
  isMaxLevel,
  isWellUnlocked,
  pourInto,
  runPourSeconds,
  skipRebirth,
  unequipPet,
  upgradeBucket,
  usePortal,
  usePotion,
  petMult,
} from './logic.js'
import {
  atPitRim,
  BUCKET_STANDS,
  coinAt,
  COINS_PER_LEDGE,
  eggStandNear,
  FREE_REWARD,
  inRect,
  inWell,
  onCourse,
  onStartLine,
  portalAt,
  skipPadAt,
  SPAWN,
  stageAtZ,
  standRect,
  winsPadAt,
} from './world.js'

const BUCKET_INDEX = Object.fromEntries(BUCKETS.map((b, i) => [b.id, i]))
/** Reaching Outer Space earns its badge; the last stage has its own. */
const SPACE_STAGE = STAGES.findIndex((s) => s.id === 'space')

/** How far out of a well still counts as "in" it (network jitter). */
const WELL_SLACK = 0.8
/** Same for the pads on the course and the start line. */
const PAD_SLACK = 1.5
/** Buckets are bought by standing at their stand; allow for a little lag. */
const STAND_SLACK = 2

/**
 * One player's authoritative session: validates intents, runs the training tick and
 * reports what happened through `emit`.
 *
 * Transport-agnostic on purpose. The Colyseus room wraps one of these per client; the
 * offline mode wraps one for the local player. Either way the rules that run are
 * byte-for-byte the same.
 *
 * Events emitted (type, payload):
 * - 'profile'  { profile, session }  full state, after anything structural
 * - 'train'    { source, well, gain, water, level, leveledUp, levels, maxed }  each
 *                Water gain; `source` is 'well' (well is its index) or 'click' (a tap
 *                of the screen outside a well, well -1)
 * - 'claim'    { stage, wins, prize, discovered, multiplier, best, auto }  a Wins pad
 *                paid out; unless `auto` (Auto Win at the start line) the run is over
 *                and the player is on their way back to the lobby
 * - 'skip'     { stage, price }  the Skip pad filled pit `stage` (and every one before it)
 * - 'pit'      { stage }  pit `stage` is full: swim on. The session pours into the pit at
 *                whose rim you stand (logic.pourInto) and says when each one fills; until
 *                then the client only shows the water rising
 * - 'pack'     { amount }  a Water pack landed
 * - 'hatch'    { eggId, pets: [{ uid, id }] }  pets to reveal
 * - 'badge'    { id, name }
 * - 'reward'   { label, wins? }  an ad reward or Gems purchase landed
 * - 'world'    { world, first }  stepped through the portal into `world`
 * - 'coin'     { stage, index, wins, total }  picked up one of a ledge's coins
 * - 'quests'   { quests }  today's quests moved on (profile.quests)
 *
 * `onTeleport({ x, z })` asks the host to move the player (back to the lobby after a
 * claim or a rebirth on the course): the room accepts the jump and tells the client.
 */
/** An item reward as words: "x2 Water Potion", "2 Volcano Eggs". */
const itemLabel = ({ item, amount }) => (amount > 1 ? `${amount} ${ITEMS[item].name}s` : ITEMS[item].name)

export class PlayerSession {
  /**
   * @param {object} profile normalized profile (see logic.normalizeProfile)
   * @param {{ now: number, emit: (type: string, payload?: object) => void,
   *           getPosition: () => {x: number, y: number, z: number},
   *           onPurchase?: (productId: string) => boolean,
   *           onTeleport?: (to: {x: number, z: number}) => void }} options
   *   `onPurchase` lets the host veto or count a shop sale (stock limits).
   */
  constructor(profile, { now, emit, getPosition, onPurchase, onTeleport, onPitFilled }) {
    this.profile = profile
    this.onPitFilled = onPitFilled
    this.session = createSession(now)
    this.emit = emit
    this.getPosition = getPosition
    this.onPurchase = onPurchase
    this.onTeleport = onTeleport

    /** Well the client says it's in; verified against position every tick. */
    this.well = -1
    this.trainTimer = 0
    /** Seconds stood on the start line towards the next Auto Win claim. */
    this.autoTimer = 0
    /** This run's pits: the furthest filled since you left the lobby, and the next one's fill. */
    this.run = createRun()
    /** Taps that would still count right now (refilling at CLICK_RATE a second), and when last topped up. */
    this.clickTokens = CLICK_RATE
    this.clickAt = now
    /** This run's coins picked up so far: stage * COINS_PER_LEDGE + index. */
    this.coinsTaken = new Set()
    /** Others pouring into the pit you're at with you (the room counts them each tick). */
    this.helpers = 0
    /** The time of the latest message or tick, for the rules that need it (quests' day). */
    this.clock = now
    this.dirty = false
  }

  // --- Plumbing --------------------------------------------------------------------

  sendProfile() {
    this.dirty = false
    this.emit('profile', { profile: this.profile, session: this.session })
  }

  badge(id) {
    const badge = awardBadge(this.profile, id)
    if (badge) {
      this.dirty = true
      this.emit('badge', badge)
    }
  }

  tutorial(event) {
    if (advanceTutorial(this.profile, event)) this.dirty = true
  }

  /** Counts `amount` towards today's quest of `kind`; pays out, and says so, when one's done. */
  quest(kind, amount = 1) {
    const result = advanceQuest(this.profile, kind, amount, this.clock)
    if (!result.changed) return
    this.emit('quests', { quests: this.profile.quests })
    if (result.done) {
      this.dirty = true
      this.emit('reward', { label: `QUEST DONE: ${result.done.text}! ${itemLabel(result.done.reward)} in Items` })
    }
    if (result.bonus) this.emit('reward', { label: `ALL QUESTS DONE! ${itemLabel(result.bonus)} in Items` })
  }

  /** For helping `name` fill pit `stage`: a share of its Wins. */
  coopTip(stage, name) {
    const result = applyCoopTip(this.profile, stage, this.clock)
    if (!result.ok) return
    this.dirty = true
    this.emit('reward', { label: `You helped ${name} fill pit ${stage}`, wins: result.wins })
  }

  /** Pit `stage` is full this run: swim on. */
  pitFilled(stage) {
    this.emit('pit', { stage })
    this.quest('pits')
  }

  /** Back to the lobby: the run is over (or a rebirth emptied your Water mid-run). */
  sendHome() {
    this.run = createRun()
    this.coinsTaken.clear()
    const spot = { x: SPAWN.x + (Math.random() - 0.5) * 6, z: SPAWN.z + (Math.random() - 0.5) * 4 }
    this.onTeleport?.(spot)
  }

  // --- Intents ---------------------------------------------------------------------

  /** Dispatches one client message. Unknown types are ignored. */
  handle(type, payload = {}, now) {
    const handler = this.handlers[type]
    if (!handler) return
    if (Number.isFinite(now)) this.clock = now
    handler.call(this, payload || {}, now)
    if (this.dirty) this.sendProfile()
  }

  handlers = {
    enterWell({ well }) {
      const index = Number(well)
      if (!Number.isInteger(index) || !WELLS[index]) return
      if (!isWellUnlocked(this.profile, index)) return
      if (this.well !== index) {
        this.well = index
        // The first scoop lands a beat after getting in, not instantly.
        this.trainTimer = TRAIN_INTERVAL * 0.5
      }
    },

    leaveWell() {
      this.well = -1
    },

    /**
     * A tap of the screen: a scoop of Water, times the well you're really standing in
     * (x1 anywhere else), at most CLICK_RATE a second - and at a pit's rim, a splash
     * more into it (POUR_TAP).
     */
    click(_payload, now) {
      this.clickTokens = Math.min(CLICK_RATE, this.clickTokens + (Math.max(0, now - this.clickAt) / 1000) * CLICK_RATE)
      this.clickAt = now
      if (this.clickTokens < 1) return
      this.clickTokens -= 1
      const well = this.inClaimedWell() ? this.well : -1
      this.gain(well >= 0 ? 'well' : 'click', well, applyClick(this.profile, well, now))
      this.tutorial('train')
      this.quest('taps')
      // At the rim of the pit you're filling, a tap pours faster too.
      const p = this.getPosition()
      if (onCourse(p.x, p.z) && atPitRim(this.run.open + 1, p.x, p.z)) {
        const filled = pourInto(this.run, this.profile, POUR_TAP)
        if (filled) this.pitFilled(filled)
      }
    },

    /** Back to the lobby on request (the platform's respawn button): the server moves you. */
    home() {
      this.sendHome()
    },

    setting({ key, value }) {
      if (key === 'autoRebirth') this.profile.settings.autoRebirth = Boolean(value)
      else if (key === 'autoWin' && this.profile.passes.autoWin) this.profile.settings.autoWin = Boolean(value)
      else return
      this.dirty = true
    },

    rebirth() {
      const result = applyRebirth(this.profile)
      if (result.ok) this.afterRebirth(result)
    },

    skipRebirth() {
      const result = skipRebirth(this.profile)
      if (result.ok) this.afterRebirth(result)
    },

    /** The Wins pad on ledge `stage`: only standing on it, and only once you've filled its pit. */
    claim({ stage }, now) {
      const p = this.getPosition()
      const index = Number(stage)
      if (winsPadAt(p.x, p.z, PAD_SLACK) !== index) return
      const result = applyClaim(this.profile, index, now, this.run.open)
      if (!result.ok) return
      this.afterClaim(result, false)
      this.sendHome()
    },

    /** The Skip pad on ledge `stage - 1`, filling pit `stage`. */
    skipStage({ stage }) {
      const p = this.getPosition()
      const index = Number(stage)
      if (skipPadAt(p.x, p.z, PAD_SLACK) !== index - 1) return
      const result = applySkip(this.profile, index)
      if (!result.ok) return
      this.dirty = true
      this.emit('skip', { stage: result.stage, price: result.price })
      this.badge('firstSkip')
      // You're right by it: it fills at once.
      if (this.run.open < index) {
        this.run.open = index
        this.run.pour = 0
        this.pitFilled(index)
      }
    },

    buyBucket({ id }) {
      if (!this.nearStandFor(id)) return
      const result = buyBucket(this.profile, id)
      if (!result.ok) return
      this.dirty = true
      if (result.bought) this.tutorial('buyBucket')
    },

    equipBucket({ id }) {
      const result = equipBucket(this.profile, id)
      if (result.ok) this.dirty = true
    },

    /** Fuses three of a pet into a Golden one. */
    fusePets({ id }) {
      const result = fusePets(this.profile, id)
      if (!result.ok) return
      this.dirty = true
      this.emit('reward', { label: `GOLDEN ${PETS[id].name.toUpperCase()}! ${formatMultiplier(petMult(result.pet))} Water` })
    },

    /** Buys (or just shows) a cosmetic: a pour colour or a trail. */
    cosmetic({ kind, id }) {
      const result = buyCosmetic(this.profile, kind, id)
      if (!result.ok) return
      this.dirty = true
      if (result.bought) this.emit('reward', { label: `NEW LOOK: ${COSMETICS[kind][id].name}!` })
    },

    /** A star for bucket `id`, at its stand. */
    upgradeBucket({ id }) {
      if (!this.nearStandFor(id)) return
      const result = upgradeBucket(this.profile, id)
      if (!result.ok) return
      this.dirty = true
      this.quest('stars')
    },

    buyPack({ index }) {
      const result = buyWaterPack(this.profile, Number(index))
      if (!result.ok) return
      this.dirty = true
      this.emit('pack', { amount: result.amount })
    },

    hatch({ eggId, count }) {
      const egg = EGGS[eggId]
      if (!egg) return
      const p = this.getPosition()
      if (eggStandNear(p.x, p.z)?.eggId !== eggId) return
      const n = count === MULTI_HATCH ? MULTI_HATCH : 1
      this.reveal(hatchEgg(this.profile, eggId, n))
    },

    openEggItem({ itemId }) {
      const item = ITEMS[itemId]
      if (!item || item.kind !== 'egg') return
      this.reveal(hatchEgg(this.profile, item.egg, 1, { paid: 'item' }))
    },

    equipPet({ uid }) {
      if (equipPet(this.profile, Number(uid)).ok) this.dirty = true
    },

    unequipPet({ uid }) {
      unequipPet(this.profile, Number(uid))
      this.dirty = true
    },

    equipBest() {
      equipBestPets(this.profile)
      this.dirty = true
    },

    deletePet({ uid }) {
      if (deletePet(this.profile, Number(uid)).ok) this.dirty = true
    },

    claimDaily({ day }, now) {
      const result = claimDaily(this.profile, Number(day), now)
      this.afterReward(result)
    },

    claimPlaytime({ index }, now) {
      const result = claimPlaytime(this.profile, this.session, Number(index), now)
      this.afterReward(result)
    },

    claimFreeReward() {
      const p = this.getPosition()
      if (Math.hypot(p.x - FREE_REWARD.x, p.z - FREE_REWARD.z) > FREE_REWARD.radius + 1.5) return
      const result = claimFreeReward(this.profile, this.session)
      this.afterReward(result)
    },

    portal() {
      const p = this.getPosition()
      const portal = portalAt(p.x, p.z, 2)
      if (!portal) return
      const result = usePortal(this.profile)
      if (!result.ok) return
      this.dirty = true
      if (result.world === 1) this.badge(portal.id)
      this.emit('world', { world: result.world, first: Boolean(result.first) })
    },

    usePotion({ itemId }, now) {
      const result = usePotion(this.profile, itemId, now)
      if (!result.ok) return
      this.dirty = true
    },

    /** Buys a SHOP item with Wins. */
    purchase({ productId }) {
      const item = SHOP[productId]
      if (!item) return
      // Checked before the host takes stock, so a short wallet never uses up a Sphinx.
      if (this.profile.wins < item.price) return
      if (item.kind === 'pass' && this.profile.passes[productId]) return
      if (this.onPurchase && !this.onPurchase(productId)) return
      const result = buyShopItem(this.profile, productId)
      if (!result.ok) return
      this.dirty = true
      this.reveal(result)
    },
  }

  // --- Granted by the host, never by a client message --------------------------------

  /**
   * A rewarded ad the host has verified with Boxity (or, offline, that Boxity reported
   * watched). Not a handler: a client can't ask for it directly.
   */
  grantAdReward(placement, now) {
    const result = applyAdReward(this.profile, this.session, placement, now)
    if (!result.ok) return result
    this.dirty = true
    this.emit('reward', { label: result.label })
    this.sendProfile()
    return result
  }

  /** A Gems purchase Boxity has confirmed (its webhook, recorded by the host). */
  grantGemProduct(sku) {
    const result = applyGemProduct(this.profile, sku)
    if (!result.ok) return result
    this.dirty = true
    this.emit('reward', { label: result.name, wins: result.wins || 0 })
    this.sendProfile()
    return result
  }

  afterReward(result) {
    if (!result?.ok) return
    this.dirty = true
    if (result.pets?.length) this.reveal(result)
  }

  /** Sends newly gained pets to the client's hatch animation. */
  reveal(result) {
    if (!result?.ok || !result.pets?.length) return
    this.dirty = true
    this.emit('hatch', { eggId: result.eggId ?? null, pets: result.pets })
    this.quest('hatch', result.pets.length)
    this.tutorial('hatch')
    this.badge('firstPet')
  }

  afterClaim(result, auto) {
    this.dirty = true
    this.emit('claim', {
      stage: result.stage,
      wins: result.wins,
      prize: result.prize,
      discovered: result.discovered,
      multiplier: result.multiplier,
      best: result.best,
      auto,
    })
    this.tutorial('claim')
    this.badge('firstWin')
    if (!auto) this.quest('claims')
    for (const chest of result.chests || []) {
      this.emit('reward', { label: `MEGA CHEST! ${itemLabel(chest)} in Items` })
    }
    const best = Math.max(this.profile.stats.bestStage, this.profile.stats.bestStage2)
    if (best >= 10) this.badge('stage10')
    // World 1's landmarks: Outer Space, and escaping it - which opens World 2.
    const world1 = this.profile.stats.bestStage
    if (world1 >= SPACE_STAGE) this.badge('space')
    if (world1 >= LAST_STAGE) this.badge('cosmic')
    if (result.best && this.profile.world === 0 && result.stage === LAST_STAGE && !this.profile.world2Unlocked) {
      this.emit('reward', { label: 'YOU ESCAPED WORLD 1! World 2 is open - take the portal' })
    }
  }

  afterRebirth({ gift } = {}) {
    this.dirty = true
    this.quest('rebirth')
    this.tutorial('rebirth')
    if (this.profile.rebirths === 1) this.badge('firstRebirth')
    // Every 5th rebirth from 15: eggs, waiting in Items.
    if (gift) this.emit('reward', { label: `REBIRTH ${gift.rebirths} GIFT: ${gift.label} in Items` })
    // Your Water is gone, and with it every pit you'd filled: home you go.
    const p = this.getPosition()
    if (onCourse(p.x, p.z)) this.sendHome()
  }

  // --- Simulation ------------------------------------------------------------------

  /** Whether the player stands at (or right by) the stand for bucket `id`. */
  nearStandFor(id) {
    const stand = BUCKET_STANDS[BUCKET_INDEX[id]]
    if (!stand) return false
    const p = this.getPosition()
    return inRect(standRect(stand), p.x, p.z, STAND_SLACK)
  }

  /** Whether the player is really standing in the well they claim. */
  inClaimedWell() {
    if (this.well < 0) return false
    const p = this.getPosition()
    return inWell(this.well, p.x, p.z, WELL_SLACK)
  }

  /**
   * Advances well training, pouring and Auto Win. Call at a steady rate (the room's
   * simulation interval). Walking around earns no Water: only scoops and taps do.
   */
  tick(dt, now) {
    this.clock = now
    if (this.well >= 0 && this.inClaimedWell()) {
      this.trainTimer += dt
      while (this.trainTimer >= TRAIN_INTERVAL) {
        this.trainTimer -= TRAIN_INTERVAL
        this.trainOnce(now)
      }
    } else {
      this.trainTimer = Math.min(this.trainTimer, TRAIN_INTERVAL * 0.5)
    }
    this.pourTick(dt)
    this.coinTick(now)
    this.autoWin(dt, now)
    this.profile.stats.playtime += dt
    if (this.dirty) this.sendProfile()
  }

  /**
   * The coins over the ledges you've reached this run: walk through one and it's yours
   * (once a run - they're all back when you set out again).
   */
  coinTick(now) {
    const p = this.getPosition()
    if (!onCourse(p.x, p.z)) {
      this.coinsTaken.clear()
      return
    }
    const stage = stageAtZ(p.z)
    if (stage < 1 || stage > this.run.open) return
    const index = coinAt(stage, p.x, p.z)
    if (index < 0) return
    const key = stage * COINS_PER_LEDGE + index
    if (this.coinsTaken.has(key)) return
    this.coinsTaken.add(key)
    const result = applyCoin(this.profile, stage, now)
    this.emit('coin', { stage, index, wins: result.wins, total: this.profile.wins })
    this.quest('coins')
  }

  /**
   * Pouring: standing at the rim of the next pit this run, you pour into it (as fast as
   * your Water Power lets you); when it's full, it's open to swim. Back in the lobby,
   * every pit is empty again.
   */
  pourTick(dt) {
    const p = this.getPosition()
    if (!onCourse(p.x, p.z)) {
      if (this.run.open || this.run.pour) this.run = createRun()
      return
    }
    if (!atPitRim(this.run.open + 1, p.x, p.z)) return
    const filled = pourInto(this.run, this.profile, dt * coopSpeed(this.helpers))
    if (filled) {
      this.pitFilled(filled)
      if (this.helpers > 0) this.onPitFilled?.(filled)
    }
  }

  /**
   * Auto Win: standing on the start line with the pass on, the Wins pad of the ledge
   * that pays you best pays out every run's worth of seconds - walking and pouring - as
   * often as running there yourself would.
   */
  autoWin(dt, now) {
    const p = this.getPosition()
    const stage = bestRunStage(this.profile)
    if (!this.profile.passes.autoWin || !this.profile.settings.autoWin || stage < 1 || !onStartLine(p.x, p.z, PAD_SLACK)) {
      this.autoTimer = 0
      return
    }
    this.autoTimer += dt
    if (this.autoTimer < runSeconds(stage) + runPourSeconds(this.profile, stage)) return
    this.autoTimer = 0
    const result = applyClaim(this.profile, stage, now)
    if (result.ok) this.afterClaim(result, true)
  }

  /** Tells the client about a Water gain from `source` ('well' or 'click'). */
  gain(source, well, result) {
    // At max level gains stop; there's nothing to show.
    if (result.gain > 0) {
      this.emit('train', {
        source,
        well,
        gain: result.gain,
        water: this.profile.water,
        level: this.profile.level,
        leveledUp: result.leveledUp,
        levels: result.levels,
        maxed: result.maxed,
      })
    }
    if (this.profile.settings.autoRebirth && isMaxLevel(this.profile)) {
      const rebirth = applyRebirth(this.profile)
      if (rebirth.ok) this.afterRebirth(rebirth)
    }
  }

  trainOnce(now) {
    const result = applyTrain(this.profile, this.well, now)
    if (!result.ok) {
      this.well = -1
      return
    }
    this.gain('well', this.well, result)
    this.tutorial('train')
  }
}
