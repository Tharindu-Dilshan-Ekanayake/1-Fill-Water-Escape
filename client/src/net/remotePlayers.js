import { Vector3 } from 'three'

import { LAST_STAGE } from '@shared/balance'

import { runtime } from '../game/runtime'
import { getGame } from '../store/game'

/**
 * Other players, as the network last described them. Network callbacks write here;
 * the renderer reads it each frame and interpolates between snapshots, drawing
 * everyone ~110 ms in the past so 10 Hz updates still move smoothly.
 */

/** sessionId -> remote player */
export const remotePlayers = new Map()

const MAX_SNAPSHOTS = 24

/** Everyone's synced state, whichever world they're in, so a change of world can redraw them. */
const latest = new Map()

/** A name tag's second line: rebirths and best stage ("R12 · Stage 45", "R40 · World 2 · Stage 8"). */
function progressTag(rebirths, best) {
  if (best <= 0) return rebirths > 0 ? `R${rebirths}` : ''
  const stage = best > LAST_STAGE ? `World 2 · Stage ${best - LAST_STAGE}` : `Stage ${best}`
  return rebirths > 0 ? `R${rebirths} · ${stage}` : stage
}
export function upsertRemotePlayer(sessionId, state) {
  latest.set(sessionId, state)
  // Only players in your world are drawn: each world feels like its own place.
  if ((state.world || 0) !== (getGame().profile.world || 0)) {
    dropRemotePlayer(sessionId)
    return
  }
  let r = remotePlayers.get(sessionId)
  if (!r) {
    r = {
      sessionId,
      name: '',
      /** Their verified Boxity user id ('' for guests): matches Boxity chat to them. */
      uid: '',
      snaps: [],
      position: new Vector3(state.x, state.y, state.z),
      yaw: state.rotY,
      speed: 0,
      anim: 'idle',
      bucketId: 'pail',
      /** "R12 · Stage 45": under their name, how far they've got. */
      tag: '',
      /**
       * Where their right hand is, in the world, while their real avatar is drawn
       * (RemoteAvatars writes it; RemotePlayers hangs their bucket there). `handSeen` is
       * when it was last written.
       */
      hand: new Vector3(),
      handSeen: 0,
      /** Their avatar's outfit, parsed from `look`; `lookKey` is the raw string. */
      look: null,
      lookKey: '',
      petIds: [],
      /** Follow state per equipped pet, grown as needed and reused. */
      pets: [],
      walkPhase: 0,
    }
    r.shadow = { position: r.position, size: 1.1, visible: true }
    runtime.shadowCasters.add(r.shadow)
    remotePlayers.set(sessionId, r)
  }
  r.name = state.name
  r.uid = state.uid || ''
  r.anim = state.anim
  r.bucketId = state.bucketId || 'pail'
  r.tag = progressTag(state.rebirths || 0, state.best || 0)
  if (state.look !== r.lookKey) {
    r.lookKey = state.look
    try {
      r.look = state.look ? JSON.parse(state.look) : null
    } catch {
      r.look = null
    }
  }
  r.petIds = [...state.petIds]
  while (r.pets.length < r.petIds.length) {
    r.pets.push({ id: '', position: r.position.clone(), yaw: 0, hop: 0 })
  }
  const last = r.snaps[r.snaps.length - 1]
  if (!last || last.x !== state.x || last.y !== state.y || last.z !== state.z || last.r !== state.rotY) {
    r.snaps.push({ t: performance.now(), x: state.x, y: state.y, z: state.z, r: state.rotY })
    if (r.snaps.length > MAX_SNAPSHOTS) r.snaps.shift()
  }
}

/** You changed world: shows the players in the new one, hides the rest. */
export function refreshRemoteWorlds() {
  for (const [sessionId, state] of latest) upsertRemotePlayer(sessionId, state)
}

export function removeRemotePlayer(sessionId) {
  latest.delete(sessionId)
  dropRemotePlayer(sessionId)
}

function dropRemotePlayer(sessionId) {
  const r = remotePlayers.get(sessionId)
  if (!r) return
  runtime.shadowCasters.delete(r.shadow)
  remotePlayers.delete(sessionId)
}

export function clearRemotePlayers() {
  for (const id of [...remotePlayers.keys()]) removeRemotePlayer(id)
  latest.clear()
  runtime.remotePets.length = 0
}
