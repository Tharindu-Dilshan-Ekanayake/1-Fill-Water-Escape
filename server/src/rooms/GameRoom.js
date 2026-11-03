import { Room } from '@colyseus/core'

import { AD_REWARDS, ITEMS, LAST_STAGE } from '../../../shared/balance.js'
import { applyOfflineProgress, applyWeeklyReward, overallStage, weekOf, winsInWeek } from '../../../shared/logic.js'
import { PlayerSession } from '../../../shared/session.js'
import { atPitRim, clampToWalkable, COURSE_START_Z, courseLimitZ, MAX_MOVE_SPEED, PIT_DEPTH, SPAWN } from '../../../shared/world.js'
import { resolveIdentity, verifyAdReward } from '../bloxityApi.js'
import { reportLeaver } from '../bloxityLeaderboards.js'
import { carryOverGuest, getSphinxStock, loadProfile, saveProfile, takeSphinx, weeklyRank } from '../db.js'
import { applyGemsForSession } from '../gems.js'
import { getLeaderboards } from '../leaderboards.js'
import { activePlayers, broadcastAll, liveRooms } from '../registry.js'
import { GameState, PlayerState } from './schema.js'

const MAX_CLIENTS = 8
const RECONNECT_SECONDS = 20
const AUTOSAVE_MS = 30_000
/** State patches to clients, and the training simulation, per second. */
const PATCH_HZ = 15
const SIM_HZ = 10
/** Allowance on top of max speed for a position update to be accepted. */
const MOVE_SLACK = 2.5
/** Close code used when the same player joins somewhere else (4000-4010 are Colyseus's own). */
const DUPLICATE_LOGIN = 4100
/** Names this server process in save ownership; Legion sets POD_NAME per pod. */
const POD = process.env.POD_NAME || `local-${process.pid}`

/** What other players may be told someone is doing. */
const ANIMS = ['idle', 'walk', 'scoop', 'jump', 'swim']
/** How far past a closed pit's rim a position may stray (lag) before it's pulled back. */
const RIM_SLACK = 1.5
/** A Boxity emote, replicated through `anim` as 'emote:<its 24-hex id>'. */
const EMOTE_ANIM = /^emote:[a-f0-9]{24}$/
/** Least time between two 'gemsCheck's from one player (each is a database query). */
const GEMS_CHECK_MS = 2000

/** Unambiguous characters for lobby codes people read out to each other. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeCode = (length = 5) =>
  Array.from({ length }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')

const cleanName = (name) =>
  String(name || 'Player')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 20) || 'Player'

/**
 * One lobby: up to 8 players sharing a world. All game rules run in each player's
 * PlayerSession; the room handles networking, position validation, persistence and
 * the small shared state other players render from.
 */
export class GameRoom extends Room {
  maxClients = MAX_CLIENTS
  autoDispose = true

  /**
   * sessionId -> { session, playerId, verified, owner, lastPos, lastPosAt, kicked?,
   *                reconnection?, adPending?, gemsCheckAt? }
   * `owner` claims the player's save for this session (see db.js); `verified` says
   * Boxity vouched for the id (see bloxityApi.js).
   */
  members = new Map()

  onCreate(options = {}) {
    this.setState(new GameState())
    if (options.private) {
      // A short code friends can type instead of the long generated room id.
      this.roomId = makeCode()
      this.state.code = this.roomId
      this.state.isPrivate = true
      this.setPrivate(true)
    }
    this.setPatchRate(1000 / PATCH_HZ)
    this.setSimulationInterval((dt) => this.tick(dt / 1000), 1000 / SIM_HZ)
    this.updateListing()
    liveRooms.add(this)

    // Everything the client can ask for goes through the player's session.
    this.onMessage('*', (client, type, payload) => {
      if (type === 'pos') return this.handlePosition(client, payload)
      if (type === 'look') return this.handleLook(client, payload)
      // Boxity rewards: checked with Boxity by the server, never granted on the client's word.
      if (type === 'adReward') return this.handleAdReward(client, payload)
      if (type === 'gemsCheck') return this.handleGemsCheck(client)
      const member = this.members.get(client.sessionId)
      if (!member) return
      member.session.handle(String(type), payload || {}, Date.now())
      this.syncPlayer(client.sessionId)
    })

    this.autosave = setInterval(() => this.saveAll(), AUTOSAVE_MS)
  }

  /**
   * Who is joining. Join options are `{ playerId, name, token, gameSlug }`, `token`
   * being the Boxity SDK's game token (null for guests). A token is verified with
   * Boxity and its account id becomes the save key; without one the player is a guest.
   * See resolveIdentity for the details. Throwing refuses the join.
   */
  async onAuth(_client, options) {
    const identity = await resolveIdentity(options)
    return { ...identity, name: cleanName(identity.name || options?.name) }
  }

  async onJoin(client, _options, auth) {
    const { playerId, name, verified = false, carriedFrom = [] } = client.auth || auth

    // Same account joining again (a refresh, a new tab, a reconnect the old session
    // hasn't noticed yet): the newest connection wins. The old one is saved and removed
    // at once, even when it's only a seat held open for a reconnect - otherwise a
    // frozen copy of the player would stand in the lobby until that ran out.
    const existing = activePlayers.get(playerId)
    if (existing) await existing.room.evict(existing.client, 'You joined from another window.')

    const now = Date.now()
    const owner = `${POD}:${client.sessionId}`
    // An account's first visit brings along what it played as a guest (once only).
    if (verified && carriedFrom.length) {
      const from = await carryOverGuest(playerId, carriedFrom, name)
      if (from) console.log(`[room] carried guest ${from} into ${playerId}`)
    }
    const profile = await loadProfile(playerId, name, owner)
    const offline = applyOfflineProgress(profile, now)

    const player = new PlayerState()
    const spawnX = SPAWN.x + (Math.random() - 0.5) * 6
    const spawnZ = SPAWN.z + (Math.random() - 0.5) * 4
    // `uid` lets clients match Boxity chat to players; only a verified id is shown.
    Object.assign(player, { name, uid: verified ? playerId : '', x: spawnX, y: 0, z: spawnZ, rotY: Math.PI, anim: 'idle' })
    this.state.players.set(client.sessionId, player)

    const session = new PlayerSession(profile, {
      now,
      emit: (type, payload) => client.send(type, payload),
      getPosition: () => player,
      // Others helped fill it: a tip for each of them.
      onPitFilled: (stage) => {
        const member = this.members.get(client.sessionId)
        if (!member) return
        for (const helper of this.helpersAt(member, stage)) helper.session.coopTip(stage, name)
      },
      onPurchase: (productId) => {
        if (productId !== 'sphinx') return true
        const ok = takeSphinx()
        if (ok) broadcastAll('stock', { sphinx: getSphinxStock() })
        return ok
      },
      // Back to the lobby after a claim (or a rebirth out on the course): the room takes
      // the jump as the player's new position and moves their client there. Looked up by
      // session id, as after a reconnect the client object from the join is stale.
      onTeleport: (to) => {
        const member = this.members.get(client.sessionId)
        if (member) {
          member.lastPos = { x: to.x, z: to.z }
          member.lastPosAt = Date.now()
        }
        Object.assign(player, { x: to.x, y: 0, z: to.z })
        this.clients.find((c) => c.sessionId === client.sessionId)?.send('teleport', { x: to.x, y: 0, z: to.z })
      },
    })

    this.members.set(client.sessionId, { session, playerId, verified, owner, lastPos: { x: spawnX, z: spawnZ }, lastPosAt: now })
    activePlayers.set(playerId, { room: this, client })
    await this.weeklyReward(session, now)

    session.sendProfile()
    client.send('spawn', { x: spawnX, z: spawnZ })
    client.send('stock', { sphinx: getSphinxStock() })
    client.send('leaderboards', getLeaderboards())
    if (offline) client.send('offline', offline)
    this.syncPlayer(client.sessionId)
    this.updateListing()
    // Gems bought while away (or on another pod) land now.
    applyGemsForSession(this, client.sessionId)
  }

  /**
   * Last week's board: if this player made its top 10, their reward - once, the first
   * time they're back after the week turned.
   */
  async weeklyReward(session, now) {
    const profile = session.profile
    const week = weekOf(now) - 1
    const wins = winsInWeek(profile, week)
    if (wins <= 0 || profile.weekly.rewarded >= week) return
    try {
      const rank = await weeklyRank(week, wins)
      const reward = applyWeeklyReward(profile, week, rank)
      if (!reward) return
      session.dirty = true
      session.emit('reward', { label: `LAST WEEK'S BOARD: #${rank}! ${reward.amount} ${ITEMS[reward.item].name}s in Items` })
    } catch (err) {
      console.error('[room] weekly reward check failed', err)
    }
  }

  /** Dropped without saying goodbye (mobile network blip): hold the seat. */
  async onDrop(client) {
    const member = this.members.get(client.sessionId)
    if (!member || member.kicked) return
    // Stop training while away; the seat stays warm for the reconnect.
    member.session.handle('leaveWell', {}, Date.now())
    member.reconnection = this.allowReconnection(client, RECONNECT_SECONDS)
    try {
      await member.reconnection
    } catch {
      // Window expired, or the player came back as a new session (evict); onLeave
      // cleans up.
    } finally {
      member.reconnection = null
    }
  }

  onReconnect(client) {
    const member = this.members.get(client.sessionId)
    if (!member) return
    activePlayers.set(member.playerId, { room: this, client })
    member.session.emit = (type, payload) => client.send(type, payload)
    member.session.sendProfile()
  }

  async onLeave(client) {
    const member = this.members.get(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (member) {
      if (activePlayers.get(member.playerId)?.client === client) activePlayers.delete(member.playerId)
      this.members.delete(client.sessionId)
      if (!member.kicked) {
        if (member.verified) reportLeaver(member.playerId, member.session.profile)
        await saveProfile(member.session.profile, member.owner)
      }
    }
    this.updateListing()
  }

  /**
   * The pod is going away (a deploy, or scaling in): save everyone, then close with
   * SERVER_SHUTDOWN, which sends each client back through the matchmaker to a pod
   * that's staying.
   */
  async onBeforeShutdown() {
    await this.saveAll()
    super.onBeforeShutdown()
  }

  async onDispose() {
    clearInterval(this.autosave)
    liveRooms.delete(this)
    await this.saveAll()
  }

  // --- Helpers -----------------------------------------------------------------------

  /**
   * Saves and removes a player who has joined again elsewhere: gone from everyone's
   * view at once, and a seat held for their reconnect let go rather than left to run
   * out.
   */
  async evict(client, reason) {
    const member = this.members.get(client.sessionId)
    this.state.players.delete(client.sessionId)
    if (member && !member.kicked) {
      member.kicked = true
      await saveProfile(member.session.profile, member.owner)
      member.reconnection?.reject(new Error('replaced by a new session'))
    }
    try {
      client.send('kicked', { reason })
      client.leave(DUPLICATE_LOGIN)
    } catch {
      // Already disconnected (the held-seat case).
    }
  }

  saveAll() {
    return Promise.all([...this.members.values()].map((m) => (m.kicked ? null : saveProfile(m.session.profile, m.owner))))
  }

  updateListing() {
    this.setMetadata({
      players: this.clients.length,
      isPrivate: Boolean(this.state.isPrivate),
      region: process.env.REGION || 'default',
    })
  }

  /** Copies the public bits of a profile into the synced state (only what changed). */
  syncPlayer(sessionId) {
    const member = this.members.get(sessionId)
    const player = this.state.players.get(sessionId)
    if (!member || !player) return
    const p = member.session.profile
    if (player.water !== p.water) player.water = p.water
    if (player.wins !== p.wins) player.wins = p.wins
    if (player.rebirths !== p.rebirths) player.rebirths = p.rebirths
    if (player.level !== p.level) player.level = p.level
    if (player.bucketId !== p.equippedBucket) player.bucketId = p.equippedBucket
    if (player.world !== p.world) player.world = p.world
    const best = overallStage(p.stats)
    if (player.best !== best) player.best = best
    const pets = p.equippedPets
      .map((uid) => p.pets.find((pet) => pet.uid === uid)?.id)
      .filter(Boolean)
    if (pets.join() !== [...player.petIds].join()) {
      player.petIds.clear()
      for (const id of pets) player.petIds.push(id)
    }
  }

  /**
   * Position reports, ~10 Hz from each client. Accepted if the move is physically
   * possible since the last accepted one and doesn't cross a pit the player can't fill;
   * otherwise the client is snapped back.
   */
  handlePosition(client, msg) {
    const member = this.members.get(client.sessionId)
    const player = this.state.players.get(client.sessionId)
    if (!member || !player || !msg) return
    const x = Number(msg.x)
    const y = Number(msg.y)
    const z = Number(msg.z)
    if (![x, y, z].every(Number.isFinite)) return

    const now = Date.now()
    const dt = Math.max(0.05, (now - member.lastPosAt) / 1000)
    const dist = Math.hypot(x - member.lastPos.x, z - member.lastPos.z)
    // North of the first pit they haven't filled this run is out of bounds.
    const beyond = z < courseLimitZ(member.session.run.open) - RIM_SLACK
    if (beyond || dist > MAX_MOVE_SPEED * dt + MOVE_SLACK) {
      client.send('correct', { x: member.lastPos.x, y: player.y, z: member.lastPos.z })
      return
    }
    const clamped = clampToWalkable(x, z)
    member.lastPos = clamped
    member.lastPosAt = now
    player.x = clamped.x
    // Out on the course, swimmers sit low in the pits.
    player.y = Math.max(clamped.z < COURSE_START_Z ? -PIT_DEPTH : 0, Math.min(y, 6))
    player.z = clamped.z
    player.rotY = Number(msg.r) || 0
    player.anim = ANIMS.includes(msg.a) || (typeof msg.a === 'string' && EMOTE_ANIM.test(msg.a)) ? msg.a : 'idle'
  }

  /**
   * 'adReward' `{ placement, rewardToken }`: the client watched a rewarded ad. Paid
   * only once Boxity confirms the token, and only within the placement's cooldown
   * (applyAdReward); one check at a time per player.
   */
  async handleAdReward(client, msg) {
    const member = this.members.get(client.sessionId)
    const placement = String(msg?.placement || '')
    const rewardToken = msg?.rewardToken
    if (!member || member.adPending || !AD_REWARDS[placement]) return
    if (typeof rewardToken !== 'string' || !rewardToken || rewardToken.length > 4096) return
    member.adPending = true
    try {
      if (!(await verifyAdReward(rewardToken))) return
      // Still here after the wait?
      if (this.members.get(client.sessionId) !== member || member.kicked) return
      member.session.grantAdReward(placement, Date.now())
      this.syncPlayer(client.sessionId)
    } finally {
      member.adPending = false
    }
  }

  /** 'gemsCheck': the client saw a purchase complete; look for its grant now. */
  handleGemsCheck(client) {
    const member = this.members.get(client.sessionId)
    const now = Date.now()
    if (!member || now - (member.gemsCheckAt || 0) < GEMS_CHECK_MS) return
    member.gemsCheckAt = now
    applyGemsForSession(this, client.sessionId)
  }

  /**
   * What a player's avatar wears, so everyone else can dress them the same. Purely
   * cosmetic, so trusted as sent, but kept to a small object of short strings and
   * plain numbers.
   */
  handleLook(client, msg) {
    const player = this.state.players.get(client.sessionId)
    if (!player || !msg || typeof msg !== 'object') return
    const clean = (obj, keep) => {
      const out = {}
      if (!obj || typeof obj !== 'object') return out
      for (const [key, value] of Object.entries(obj).slice(0, 24)) {
        if (key.length > 24) continue
        if (keep(value)) out[key] = value
      }
      return out
    }
    const look = JSON.stringify({
      equipped: clean(msg.equipped, (v) => (typeof v === 'string' && v.length <= 40) || (Number.isFinite(v) && Math.abs(v) < 1e12)),
      // Boxity's ranges: legOffsetX -0.7 to 5, armLength from 0.05, the rest within 0.3 to 2.6.
      proportions: clean(msg.proportions, (v) => Number.isFinite(v) && v >= -1 && v <= 6),
    })
    if (look.length <= 2048 && look !== player.look) player.look = look
  }

  tick(dt) {
    const now = Date.now()
    for (const member of this.members.values()) member.session.helpers = this.helpersAt(member, member.session.run.open + 1).length
    for (const [sessionId, member] of this.members) {
      member.session.tick(dt, now)
      this.syncPlayer(sessionId)
    }
  }

  /**
   * Who's pouring pit `stage` with `member`: everyone else in their world at its rim.
   * (Empty when `member` isn't at it.)
   */
  helpersAt(member, stage) {
    const me = member.session.getPosition()
    if (stage > LAST_STAGE || !atPitRim(stage, me.x, me.z)) return []
    const world = member.session.profile.world
    const out = []
    for (const other of this.members.values()) {
      if (other === member || other.session.profile.world !== world) continue
      const them = other.session.getPosition()
      if (atPitRim(stage, them.x, them.z)) out.push(other)
    }
    return out
  }
}
