/**
 * Player intents. The UI never changes game state itself: it calls one of these, the
 * authority (the Colyseus room, or the offline stand-in) validates it, and the result
 * comes back as an updated profile or an event.
 */

let transport = null

/** Installs the active connection: `{ send(type, payload) }`. */
export function setTransport(next) {
  transport = next
}

export function send(type, payload) {
  if (!transport) return
  transport.send(type, payload)
}

export const actions = {
  /** Claims the Wins pad on ledge `stage` (stepping on it sends this); ends the run. */
  claim: (stage) => send('claim', { stage }),
  /** Pays the Skip pad to fill pit `stage` (the one after the ledge you're on). */
  skipStage: (stage) => send('skipStage', { stage }),
  enterWell: (well) => send('enterWell', { well }),
  /** A tap of the screen: a bucketful of Water (the authority limits how many count). */
  click: () => send('click'),
  /** Back to the lobby (a respawn): the authority moves you, so its checks agree. */
  home: () => send('home'),
  leaveWell: () => send('leaveWell'),
  rebirth: () => send('rebirth'),
  skipRebirth: () => send('skipRebirth'),
  buyBucket: (id) => send('buyBucket', { id }),
  equipBucket: (id) => send('equipBucket', { id }),
  /** Buys or shows a cosmetic: `kind` 'stream' (pour colour) or 'trail'. */
  cosmetic: (kind, id) => send('cosmetic', { kind, id }),
  /** One more star on bucket `id` (you own it, and you're at its stand). */
  upgradeBucket: (id) => send('upgradeBucket', { id }),
  /** Buys Water pack `index` (0-2) from the bar under the level. */
  buyPack: (index) => send('buyPack', { index }),
  hatch: (eggId, count = 1) => send('hatch', { eggId, count }),
  openEggItem: (itemId) => send('openEggItem', { itemId }),
  equipPet: (uid) => send('equipPet', { uid }),
  unequipPet: (uid) => send('unequipPet', { uid }),
  equipBestPets: () => send('equipBest'),
  deletePet: (uid) => send('deletePet', { uid }),
  /** Fuses three of pet `id` into a Golden one. */
  fusePets: (id) => send('fusePets', { id }),
  usePotion: (itemId) => send('usePotion', { itemId }),
  claimDaily: (day) => send('claimDaily', { day }),
  claimPlaytime: (index) => send('claimPlaytime', { index }),
  claimFreeReward: () => send('claimFreeReward'),
  setSetting: (key, value) => send('setting', { key, value }),
  portal: () => send('portal'),
  /** Buys a shop item with Wins; see shop.js. */
  purchase: (productId) => send('purchase', { productId }),
  /** A rewarded ad Boxity says was watched; the server verifies the token. */
  adReward: (placement, rewardToken) => send('adReward', { placement, rewardToken }),
  /** Asks the server to apply any Gems purchases Boxity has confirmed. */
  gemsCheck: () => send('gemsCheck'),
}
