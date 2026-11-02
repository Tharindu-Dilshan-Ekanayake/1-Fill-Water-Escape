import { BUCKETS, TUTORIAL, WORLDS } from '@shared/balance'
import { formatNumber } from '@shared/format'
import { bucketPower } from '@shared/logic'

import { sfx } from '../audio/sfx'
import { coinPaid } from '../game/course/coinState'
import { confirmPit, skipFill } from '../game/course/pits'
import { burst, queueTrainFx } from '../game/fx/fxQueue'
import { runtime } from '../game/runtime'
import { getGame } from '../store/game'
import { fadeThrough } from '../ui/fade'
import { refreshRemoteWorlds } from './remotePlayers'

/** A point above your character. */
const atPlayer = (dy = 1.2) => {
  const p = runtime.player.position
  return { x: p.x, y: p.y + dy, z: p.z }
}

/**
 * Applies one authority event to the client: updates the store and kicks off any
 * visual effect. The same handler serves the Colyseus connection and offline mode.
 */
export function handleServerEvent(type, payload) {
  const game = getGame()
  switch (type) {
    case 'profile': {
      const before = game.profile
      game.setProfile(payload.profile, payload.session)
      if ((payload.profile.world || 0) !== (before.world || 0)) refreshRemoteWorlds()
      // Celebrate the big moments, whatever caused them.
      if (game.profileLoaded && payload.profile.rebirths > before.rebirths) {
        sfx.rebirth()
        burst({ ...atPlayer(), count: 60, speed: 9 })
      } else if (game.profileLoaded && payload.profile.ownedBuckets.length > before.ownedBuckets.length) {
        // A new bucket: a shower of confetti and its name up in lights.
        sfx.buy()
        sfx.wins()
        burst({ ...atPlayer(2.5), count: 60, palette: 'confetti', speed: 9 })
        const id = payload.profile.ownedBuckets.find((b) => !before.ownedBuckets.includes(b))
        const bucket = BUCKETS.find((b) => b.id === id)
        const carried = BUCKETS.find((b) => b.id === payload.profile.equippedBucket)
        // The first bucket bought ends the tutorial: say so too.
        const done = before.tutorialStep < TUTORIAL.length && payload.profile.tutorialStep >= TUTORIAL.length
        // Any bucket can be bought, but you only put it on if it's better.
        const kept = bucket && carried && carried.id !== bucket.id ? ` (${carried.name} is stronger)` : ''
        if (bucket) game.showToast(`NEW BUCKET: ${bucket.name}!${kept}${done ? ' Tutorial complete - have fun!' : ''}`)
      } else if (game.profileLoaded) {
        // A star on a bucket: a golden pop and its new strength.
        const id = Object.keys(payload.profile.bucketStars || {}).find((b) => (payload.profile.bucketStars[b] || 0) > (before.bucketStars?.[b] || 0))
        if (id) {
          sfx.buy()
          burst({ ...atPlayer(2.5), count: 30, palette: 'gold', speed: 7 })
          const stars = payload.profile.bucketStars[id]
          game.showToast(`${BUCKETS.find((b) => b.id === id).name} ★${stars}! +${formatNumber(bucketPower(payload.profile, id))} Water a scoop`)
        }
      }
      break
    }

    case 'train':
      game.patchProfile({
        water: payload.water,
        level: payload.level,
        // Gains from walking aren't well training.
        ...(payload.source === 'well' ? { lastWell: payload.well } : {}),
      })
      queueTrainFx(payload)
      if (payload.leveledUp) {
        sfx.levelUp()
        burst({ ...atPlayer(1.8), count: 24, palette: 'power', speed: 6 })
      }
      break

    case 'claim':
      // A Wins pad paid out: the banner and trophies (RunOverlay), and a fanfare. Unless
      // it was Auto Win, the server's teleport home follows.
      game.showRunResult(payload)
      sfx.wins()
      if (payload.best) sfx.stageUp()
      if (!payload.auto) burst({ ...atPlayer(2), count: 50, palette: 'gold', speed: 9 })
      break

    case 'skip':
      // The Skip pad filled the next pit for you: in gold.
      skipFill(payload.stage)
      sfx.skip()
      sfx.buy()
      burst({ ...atPlayer(2), count: 40, palette: 'gold', speed: 8 })
      game.showToast(`Stage ${payload.stage} skipped! Its pit stays full until you rebirth`)
      break

    case 'quests':
      // Today's quests moved on (a finished one's reward comes as its own 'reward').
      game.patchProfile({ quests: payload.quests })
      break

    case 'coin':
      // One of a ledge's coins, paid.
      game.patchProfile({ wins: payload.total })
      coinPaid(payload.stage, payload.index, payload.wins)
      break

    case 'pit':
      // The authority says a pit is full: swim on.
      confirmPit(payload.stage)
      break

    case 'teleport':
      // Home to the lobby (a claim, or a rebirth out on the course): through a flash of
      // white, the camera jumping with you.
      fadeThrough(() => {
        runtime.player.position.set(payload.x, payload.y || 0, payload.z)
        runtime.player.yaw = Math.PI
        runtime.camera.snap = true
      })
      break

    case 'pack':
      sfx.buy()
      burst({ ...atPlayer(2), count: 30, palette: 'water', speed: 7 })
      break

    case 'hatch':
      game.setHatch({ eggId: payload.eggId, pets: payload.pets, id: Date.now() })
      if (payload.eggId) {
        setTimeout(sfx.crack, 1100)
        setTimeout(sfx.reveal, 1250)
      } else {
        sfx.reveal()
      }
      break

    case 'offline':
      game.openPanel('offline', payload)
      break

    case 'badge':
      sfx.wins()
      break

    case 'world': {
      // Through the portal: a flash of white while the new world's sky and course go
      // in (GameScene follows profile.world), and a fanfare.
      fadeThrough(() => {})
      sfx.rebirth()
      burst({ ...atPlayer(2), count: 60, palette: 'confetti', speed: 9 })
      const world = WORLDS[payload.world]
      game.showToast(payload.world === 1 ? `WELCOME TO ${world.name.toUpperCase()}! Deeper pits, x${world.wins} Wins` : `Back in ${world.name}!`)
      break
    }

    case 'reward':
      // A rewarded ad or a Gems purchase landed.
      sfx.buy()
      burst({ ...atPlayer(2), count: 40, palette: 'gold', speed: 8 })
      game.showToast(`${payload.label}${payload.wins ? ` +${formatNumber(payload.wins)} Wins` : ''}!`)
      break

    default:
      break
  }
}
