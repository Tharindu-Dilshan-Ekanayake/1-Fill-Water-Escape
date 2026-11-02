import { useCallback, useEffect } from 'react'

import { BUCKETS, COLLECTION_BONUS, LAST_STAGE, runSeconds, SHOP, STAR_POWER, WELLS, WORLD_PORTALS, WORLDS } from '@shared/balance'
import { formatNumber } from '@shared/format'
import { bucketPower, bucketStars, isWellUnlocked, nextStarPrice, pourSeconds, reachStage, skipPrice, world2Open } from '@shared/logic'

import { sfx } from '../../audio/sfx'
import { starText } from '../../game/labels/lobbyLabels'
import { actions } from '../../net/actions'
import { buy } from '../../net/shop'
import { getGame, useGame } from '../../store/game'
import StrokeText from '../StrokeText'
import { ChunkyButton, Price } from './parts'
import { GRADIENTS, u } from './style'

/** Runs `run` on a key (E unless said; no key repeat) while it's set. */
function useKeyE(run, code = 'KeyE') {
  useEffect(() => {
    if (!run) return undefined
    const onKey = (e) => {
      if (e.code === code && !e.repeat) run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, code])
}

/**
 * What standing on the current spot lets you do, if anything: { title, action, run }.
 * One prompt at a time. (The Skip pads and bucket stands have their own: SkipPrompt,
 * StandPrompt.)
 */
function usePrompt() {
  const atFreeReward = useGame((s) => s.zone.freeReward)
  const freeTaken = useGame((s) => s.session.freeRewardTaken)
  const wellNear = useGame((s) => s.zone.wellNear)
  const wellLocked = useGame((s) => s.zone.wellNear >= 0 && !isWellUnlocked(s.profile, s.zone.wellNear))
  const atSphinx = useGame((s) => s.zone.sphinx)
  const atPortal = useGame((s) => s.zone.portal)
  const atStart = useGame((s) => s.zone.startLine)
  const autoWin = useGame((s) => Boolean(s.profile.passes.autoWin && s.profile.settings.autoWin))
  const reach = useGame((s) => reachStage(s.profile))
  const inWorld = useGame((s) => s.profile.world)
  const unlocked = useGame((s) => world2Open(s.profile))
  const best1 = useGame((s) => s.profile.stats.bestStage)

  // Standing on the start line with Auto Win on: it claims here, every run's worth of time.
  if (atStart && autoWin && reach >= 1) {
    return { title: 'AUTO WIN', action: `Stage ${reach} Wins pad every ${runSeconds(reach)}s - stay on the line!`, run: null }
  }

  // Walking into the portal takes you through (ticker.js); this says where to.
  if (atPortal) {
    const world = WORLD_PORTALS[atPortal]
    if (inWorld === 1) return { title: WORLDS[0].name, action: 'Step out and back in to go home', run: null }
    return unlocked
      ? { title: world.name, action: `${LAST_STAGE} new stages, x${WORLDS[1].wins} Wins - step in!`, run: null }
      : { title: world.name, action: `Escape World 1 first: reach stage ${world.stage} (best: ${best1})`, run: null }
  }

  if (atSphinx) {
    return { title: 'Sphinx - Limited!', action: `Buy - ${formatNumber(SHOP.sphinx.price)} Wins`, run: () => buy('sphinx') }
  }

  if (wellLocked) {
    const well = WELLS[wellNear]
    const title = `${well.name} - ${formatNumber(well.mult)}x Water`
    if (well.product) {
      return { title, action: `Unlock - ${formatNumber(SHOP[well.product].price)} Wins`, run: () => buy(well.product) }
    }
    const word = well.rebirths === 1 ? 'Rebirth' : 'Rebirths'
    return { title, action: `Locked: unlocks at ${well.rebirths} ${word}`, run: null }
  }

  if (atFreeReward) {
    return freeTaken
      ? { title: 'Free Reward', action: 'Come back next time!', run: null }
      : { title: 'Free Reward', action: 'Claim', run: () => actions.claimFreeReward() }
  }
  return null
}

/** Pays `price` Wins with `send`, or buzzes if you haven't got them. */
function pay(price, send) {
  if (getGame().profile.wins < price) {
    sfx.error()
    return
  }
  send()
}

/** One line of a prompt box: its key, what it does, and its price if it has one. */
function PromptRow({ keyName, label, price, run }) {
  const afford = useGame((s) => price === undefined || s.profile.wins >= price)
  return (
    <button
      type="button"
      onClick={run}
      className="pp-btn pointer-events-auto flex items-center text-left"
      style={{ gap: u(12), opacity: afford ? 1 : 0.7 }}
    >
      <span
        className="flex shrink-0 items-center justify-center rounded-full"
        style={{ width: u(50), height: u(50), border: `${u(3)} solid #fff`, fontSize: u(24) }}
      >
        {keyName}
      </span>
      <span style={{ fontSize: u(28) }}>{label}</span>
      {price !== undefined && <Price amount={price} size={30} afford={afford} />}
    </button>
  )
}

/**
 * A bucket stand: buy it (any bucket, in any order), put it on, and upgrade it with
 * stars - each a bit more Water a scoop. E does what you'd most want next; F upgrades a
 * bucket you own but aren't carrying.
 */
function StandPrompt({ index }) {
  const bucket = BUCKETS[index]
  const owned = useGame((s) => s.profile.ownedBuckets.includes(bucket.id))
  const equipped = useGame((s) => s.profile.equippedBucket === bucket.id)
  const stars = useGame((s) => bucketStars(s.profile, bucket.id))
  const star = useGame((s) => nextStarPrice(s.profile, bucket.id))
  const carried = useGame((s) => bucketPower(s.profile, s.profile.equippedBucket))
  const carriedName = useGame((s) => BUCKETS.find((b) => b.id === s.profile.equippedBucket)?.name)
  const power = bucket.power * STAR_POWER ** stars

  const buyRun = useCallback(() => pay(bucket.cost, () => actions.buyBucket(bucket.id)), [bucket])
  const equipRun = useCallback(() => actions.equipBucket(bucket.id), [bucket])
  const starRun = useCallback(() => pay(star, () => actions.upgradeBucket(bucket.id)), [bucket, star])

  const rows = []
  if (!owned) rows.push({ keyName: 'E', label: 'Buy', price: bucket.cost, run: buyRun })
  else if (!equipped) rows.push({ keyName: 'E', label: 'Equip', run: equipRun })
  if (owned && star !== null) rows.push({ keyName: rows.length ? 'F' : 'E', label: `Upgrade to ★${stars + 1}`, price: star, run: starRun })
  useKeyE(rows[0]?.run ?? null)
  useKeyE(rows[1]?.run ?? null, 'KeyF')

  let note
  const collection = `+${Math.round(COLLECTION_BONUS * 100)}% Water for your collection`
  if (!owned) note = power < carried ? `Weaker than your ${carriedName}, but ${collection}` : `+${formatNumber(power)} Water a scoop, ${collection}`
  else note = star === null ? 'Every star - fully upgraded!' : `Each star: +${Math.round((STAR_POWER - 1) * 1000) / 10}% Water a scoop`
  return (
    <div
      className="pointer-events-none absolute flex flex-col text-white"
      style={{
        left: '53%',
        top: '46%',
        gap: u(10),
        padding: `${u(12)} ${u(20)} ${u(14)} ${u(14)}`,
        borderRadius: u(10),
        background: 'rgba(24, 26, 30, 0.78)',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 600,
      }}
    >
      <span className="flex flex-col leading-tight">
        <span style={{ fontSize: u(26) }}>
          {bucket.name}
          {owned && <span style={{ color: '#ffd21f' }}>{`  ★ ${starText(index, stars)}`}</span>}
        </span>
        <span style={{ fontSize: u(20), opacity: 0.75 }}>{owned ? `+${formatNumber(power)} Water a scoop${equipped ? ' - Equipped' : ''}` : note}</span>
        {owned && <span style={{ fontSize: u(18), opacity: 0.6 }}>{note}</span>}
      </span>
      {rows.map((row) => (
        <PromptRow key={row.label} {...row} />
      ))}
    </div>
  )
}

/**
 * The Skip pad on a ledge: a big button that fills the next pit for Wins - at once, on
 * every run until your next rebirth - whether you're too weak for it or would rather not
 * wait; or, when it's already skipped, the word to swim on. E works too.
 */
function SkipPrompt({ ledge }) {
  const next = ledge + 1
  const open = useGame((s) => next <= (s.profile.skipTo || 0))
  const wait = useGame((s) => pourSeconds(s.profile, next))
  const price = useGame((s) => skipPrice(s.profile, next))
  const afford = useGame((s) => s.profile.wins >= price)
  const skip = useCallback(() => pay(price, () => actions.skipStage(next)), [price, next])
  const run = open ? null : skip
  useKeyE(run)

  return (
    <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ bottom: u(330), gap: u(8) }}>
      {open ? (
        <span style={{ fontSize: u(54) }}>
          <StrokeText stroke={u(11)} gradient={GRADIENTS.gold}>
            Pit {next} is skipped - it fills at once!
          </StrokeText>
        </span>
      ) : (
        <>
          <ChunkyButton
            gradient={afford ? GRADIENTS.goldButton : GRADIENTS.greyButton}
            onClick={run}
            title={`Skip stage ${next}`}
            radius={22}
            border={5}
            style={{ height: u(110), padding: `0 ${u(30)}`, gap: u(22) }}
          >
            <span className="relative" style={{ fontSize: u(58) }}>
              <StrokeText stroke={u(12)}>SKIP STAGE {next}</StrokeText>
            </span>
            <span className="relative">
              <Price amount={price} size={46} afford={afford} />
            </span>
          </ChunkyButton>
          <span className="text-center" style={{ fontSize: u(30) }}>
            <StrokeText stroke={u(6)} gradient={afford ? undefined : GRADIENTS.priceShort}>
              {!afford
                ? 'Need more Wins - claim a Wins pad first!'
                : wait === Infinity
                  ? `Too weak for pit ${next}? This fills it every run until you rebirth · E`
                  : `Fills pit ${next} at once (not ${Math.ceil(wait)}s) every run until you rebirth · E`}
            </StrokeText>
          </span>
        </>
      )}
    </div>
  )
}

/**
 * Proximity prompt, styled like the platform's own: a dark box with the key to press.
 * E on keyboard; tap the box on touch screens.
 */
function NearbyPrompt() {
  const prompt = usePrompt()
  const run = prompt?.run ?? null
  useKeyE(run)

  if (!prompt) return null
  return (
    <button
      type="button"
      onClick={() => prompt.run?.()}
      className="pp-btn pointer-events-auto absolute flex items-center text-left text-white"
      style={{
        left: '53%',
        top: '50%',
        gap: u(14),
        padding: `${u(12)} ${u(20)} ${u(12)} ${u(12)}`,
        borderRadius: u(10),
        background: 'rgba(24, 26, 30, 0.78)',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 600,
      }}
    >
      {prompt.run && (
        <span
          className="flex items-center justify-center rounded-full"
          style={{ width: u(54), height: u(54), border: `${u(3)} solid #fff`, fontSize: u(26) }}
        >
          E
        </span>
      )}
      <span className="flex flex-col leading-tight">
        <span style={{ fontSize: u(20), opacity: 0.75 }}>{prompt.title}</span>
        <span style={{ fontSize: u(28) }}>{prompt.action}</span>
      </span>
    </button>
  )
}

/** Whatever the spot you're standing on lets you do: the Skip pad's button, a bucket stand's, or a prompt. */
export function InteractPrompt() {
  const busy = useGame((s) => Boolean(s.panel))
  const skipPad = useGame((s) => s.zone.skipPad)
  const stand = useGame((s) => s.zone.stand)
  if (busy) return null
  if (skipPad >= 0) return <SkipPrompt key={skipPad} ledge={skipPad} />
  return stand >= 0 ? <StandPrompt key={stand} index={stand} /> : <NearbyPrompt />
}

export default InteractPrompt
