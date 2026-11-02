import { BUCKETS, EGGS, LAST_STAGE, maxStars, PETS, RARITIES, SHOP, STAR_POWER, WELLS, WORLD_PORTALS, WORLDS } from '@shared/balance'
import { formatNumber } from '@shared/format'
import { bucketStars, collectionMultiplier, isWellUnlocked, world2Open } from '@shared/logic'
import { BUCKET_STANDS, EGG_STANDS, FREE_REWARD, PORTALS, SHOP_SIGN, SPHINX_STAND, WELL_X, wellCenterZ } from '@shared/world'

import { eggHeight } from '../world/eggs'
import { WELL_THEMES, WELL_TOP } from '../world/structures'

/**
 * Text styles, as gradients top-to-bottom.
 */
export const TEXT = {
  gold: ['#fffaa8', '#ffd52a', '#ff9c00'],
  green: ['#e6ffb0', '#8dff4f', '#2fd12f'],
  price: ['#d9ff9a', '#7dff4a', '#2fd12f'],
  white: ['#ffffff', '#ffffff', '#dfe7f0'],
  red: ['#ffb0a8', '#ff4a3b', '#d4142a'],
  blue: ['#e0faff', '#7fe2ff', '#2fa8ff'],
}

const tint = (hex) => ['#ffffff', hex, hex]

/** "4x WATER / 2 Rebirths", "1x WATER / FREE", "40x WATER / VERY OP! / 150K Wins"... */
export function wellLabelSpec(index, unlocked) {
  const well = WELLS[index]
  const theme = WELL_THEMES[index]
  const lines = [{ text: `${formatNumber(well.mult)}x WATER`, size: 54, icon: 'drop', gradient: tint(theme.text) }]
  if (unlocked) {
    lines.push({ text: well.rebirths === 0 && !well.product ? 'FREE' : 'UNLOCKED', size: 44, gradient: TEXT.green })
  } else if (well.product) {
    lines.push({ text: well.tag, size: 46, rainbow: true })
    lines.push({ text: `${formatNumber(SHOP[well.product].price)} Wins`, size: 42, icon: 'trophy', gradient: TEXT.gold })
  } else {
    const word = well.rebirths === 1 ? 'Rebirth' : 'Rebirths'
    lines.push({ text: `LOCKED: ${well.rebirths} ${word}`, size: 44, icon: 'rebirth', gradient: TEXT.red })
  }
  return { lines, pxPerUnit: 50 }
}

/** Largest a well label can get, so its atlas slot fits every state. */
const wellReserve = (index) => {
  const well = WELLS[index]
  const lines = [{ text: `${formatNumber(well.mult)}x WATER`, size: 54, icon: 'drop' }]
  if (well.product) {
    lines.push({ text: well.tag, size: 46 })
    lines.push({ text: `${formatNumber(SHOP[well.product].price)} Wins`, size: 42, icon: 'trophy' })
  } else {
    lines.push({ text: 'LOCKED: 88 Rebirths', size: 44, icon: 'rebirth' })
  }
  return { lines }
}

export function wellLabels(profile) {
  return WELLS.map((well, i) => ({
    id: `well-${i}`,
    // Over the well's roof.
    position: [WELL_X, WELL_TOP + (well.product ? 1.9 : 1.3), wellCenterZ(i)],
    spec: wellLabelSpec(i, isWellUnlocked(profile, i)),
    reserve: wellReserve(i),
    fade: 150,
  }))
}

/**
 * Ownership state of each bucket stand: 'equipped' | 'owned' | 'buy'. Any bucket can be
 * bought, in any order.
 */
export function standState(profile, index) {
  const bucket = BUCKETS[index]
  if (profile.equippedBucket === bucket.id) return 'equipped'
  return profile.ownedBuckets.includes(bucket.id) ? 'owned' : 'buy'
}

/** A bucket's rarity line: in its rarity's colour, rainbow for the Secret ones. */
const rarityLine = (bucket) => {
  const rarity = RARITIES[bucket.rarity]
  return bucket.rarity === 'secret'
    ? { text: rarity.name.toUpperCase(), size: 36, rainbow: true }
    : { text: rarity.name.toUpperCase(), size: 34, gradient: tint(rarity.color) }
}

/** "3/8" stars, or just "12" on the last bucket, whose stars never run out. */
export const starText = (index, stars) => (Number.isFinite(maxStars(index)) ? `${stars}/${maxStars(index)}` : `${stars}`)

/**
 * "MYTHIC" over "Diamond Bucket", "+7M Water" (with its stars counted) and "1B Wins",
 * or "Owned"/"Equipped" and its stars.
 */
export function standLabelSpec(index, state, stars = 0) {
  const bucket = BUCKETS[index]
  const mine = state !== 'buy'
  const status = mine
    ? { text: `${state === 'equipped' ? 'Equipped' : 'Owned'}  ${starText(index, stars)}`, size: 40, icon: 'starGold', gradient: state === 'equipped' ? TEXT.green : TEXT.blue }
    : { text: `${formatNumber(bucket.cost)} Wins`, size: 40, icon: 'trophy', gradient: TEXT.price }
  const power = mine ? bucket.power * STAR_POWER ** stars : bucket.power
  return {
    lines: [
      rarityLine(bucket),
      { text: bucket.name, size: 46, fill: '#ffffff' },
      { text: `+${formatNumber(power)} Water`, size: 42, icon: 'drop', gradient: TEXT.blue },
      status,
    ],
    pxPerUnit: 70,
  }
}

/** Largest a stand label can get, so its atlas slot fits every state. */
const standReserve = (index) => {
  const price = `${formatNumber(BUCKETS[index].cost)} Wins`
  const owned = 'Equipped  888/8'
  return {
    lines: [
      { text: 'LEGENDARY', size: 36 },
      { text: BUCKETS[index].name, size: 46 },
      { text: `+${formatNumber(BUCKETS[index].power * 9.99)} Water`, size: 42, icon: 'drop' },
      { text: price.length > owned.length ? price : owned, size: 40, icon: 'trophy' },
    ],
  }
}

export function standLabels(profile) {
  return BUCKET_STANDS.map((stand) => ({
    id: `stand-${stand.index}`,
    // Each row back rides higher, so they clear the rows in front seen from the plaza.
    position: [stand.x, stand.y + 6.8 + stand.row * 1.35, stand.z],
    spec: standLabelSpec(stand.index, standState(profile, stand.index), bucketStars(profile, BUCKETS[stand.index].id)),
    reserve: standReserve(stand.index),
    fade: 70,
  }))
}

/** Over the BUCKETS sign: how much of the collection you own, and its bonus. */
export function collectionLabelSpec(profile) {
  const owned = profile.ownedBuckets.length
  const bonus = Math.round((collectionMultiplier(profile) - 1) * 100)
  return {
    lines: [
      { text: `COLLECTION ${owned}/${BUCKETS.length}`, size: 58, gradient: TEXT.gold },
      { text: `+${bonus}% Water on every scoop`, size: 42, icon: 'drop', gradient: TEXT.blue },
    ],
    pxPerUnit: 26,
  }
}

const collectionLabel = (profile) => ({
  id: 'collection',
  position: [SHOP_SIGN.x - 1, SHOP_SIGN.top + 2.2, (SHOP_SIGN.minZ + SHOP_SIGN.maxZ) / 2],
  spec: collectionLabelSpec(profile),
  reserve: { lines: [{ text: 'COLLECTION 24/24', size: 58 }, { text: '+46% Water on every scoop', size: 42, icon: 'drop' }] },
  fade: 220,
})

export function eggLabels() {
  return EGG_STANDS.map((stand) => {
    const egg = EGGS[stand.eggId]
    const lines = stand.big
      ? [
          { text: 'Volcano Egg', size: 54, gradient: TEXT.red },
          { text: `${formatNumber(egg.cost.wins)} Wins`, size: 46, icon: 'trophy', gradient: TEXT.gold },
        ]
      : [
          { text: `${egg.name} Egg`, size: 50, fill: '#ffffff' },
          { text: `${formatNumber(egg.cost.wins)} Wins`, size: 44, icon: 'trophy', gradient: TEXT.gold },
        ]
    return {
      id: `egg-${stand.eggId}`,
      position: [stand.x, eggHeight(stand) + (stand.big ? 4 : 2.5), stand.z],
      spec: { lines, pxPerUnit: 62 },
      fade: 100,
    }
  })
}

/** The limited Sphinx showcase: price, hype, and live stock. */
export function sphinxLabelSpec(stock) {
  const mult = PETS.sphinx.mult
  return {
    lines: [
      { text: `${formatNumber(SHOP.sphinx.price)} Wins`, size: 46, icon: 'trophy', gradient: TEXT.gold },
      { text: 'BEST IN GAME', size: 56, gradient: TEXT.red },
      { text: 'Sphinx', size: 76, fill: '#ffffff' },
      { text: `${formatNumber(mult * 100 - 100)}% BETTER`, size: 54, rainbow: true },
      { text: `${formatNumber(stock)} Left`, size: 50, gradient: TEXT.green },
    ],
    pxPerUnit: 48,
  }
}

export function sphinxLabel(stock) {
  return {
    id: 'sphinx',
    position: [SPHINX_STAND.x, 11.5, SPHINX_STAND.z],
    spec: sphinxLabelSpec(stock),
    reserve: sphinxLabelSpec(88888),
    fade: 140,
  }
}

const freeRewardLabel = () => ({
  id: 'free-reward',
  position: [FREE_REWARD.x, 4.6, FREE_REWARD.z],
  spec: { lines: [{ text: 'FREE REWARD', size: 50, gradient: ['#fff2b0', '#ffb347', '#ff6a1e'] }], pxPerUnit: 60 },
  fade: 90,
})

/** Where the portal goes: World 2 (once you've escaped World 1: until then, what it takes), or home. */
export function portalLabelSpec(profile) {
  const home = profile.world === 1
  const second = home
    ? { text: 'Back to World 1', size: 42, gradient: TEXT.white }
    : world2Open(profile)
      ? { text: `${LAST_STAGE} new stages · x${WORLDS[1].wins} Wins!`, size: 42, icon: 'trophy', gradient: TEXT.gold }
      : { text: `Escape World 1 first (stage ${WORLD_PORTALS.world2.stage})`, size: 40, gradient: TEXT.white }
  return { lines: [{ text: home ? 'WORLD 1' : 'WORLD 2', size: 60, gradient: TEXT.green }, second], pxPerUnit: 56 }
}

const portalLabel = (profile) => (portal) => ({
  id: `portal-${portal.id}`,
  position: [portal.x, portal.radius * 2 + 2.8, portal.z],
  spec: portalLabelSpec(profile),
  reserve: { lines: [{ text: 'WORLD 2', size: 60 }, { text: `Escape World 1 first (stage ${WORLD_PORTALS.world2.stage})`, size: 42, icon: 'trophy' }] },
  fade: 140,
})

/** Every label in the lobby. */
export function lobbyLabels(profile, { sphinxStock = 0 } = {}) {
  return [...wellLabels(profile), ...standLabels(profile), collectionLabel(profile), ...eggLabels(), sphinxLabel(sphinxStock), freeRewardLabel(), ...PORTALS.map(portalLabel(profile))]
}
