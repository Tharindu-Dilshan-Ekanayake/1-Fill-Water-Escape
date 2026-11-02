/**
 * The course's colours - the game's whole palette, as the lobby's: brown earth walls,
 * green floors and grass, blue water and pool tiles. Only the buckets come in other
 * colours. (The Wins and Skip pads keep their gold and pink, so you can tell them apart
 * at a glance.)
 */
export const COURSE_COLORS = {
  /** The walls' earth (their grass caps come from the toy material's TERRAIN style). */
  wall: '#bb7444',
  /** The checkered floors. */
  floor: '#5fd142',
  /** Bushes along the ledges, and the trees' leaves. */
  leaves: ['#3fc23a', '#33b334', '#4ccf3e'],
  trunk: '#7c4d29',
  rock: '#9a6a44',
  /** The pits: pale pool tiles up their sides, deeper blue on the floor. */
  pool: '#6fd0f5',
  poolFloor: '#2f8fe0',
  /** Gates and arches: blue with white stripes, a navy sign board, light-blue lamps. */
  gate: '#2f7fe6',
  navy: '#1f3c96',
  lamp: '#8fe6ff',
  kerb: '#eaf7ff',
  /** A Mega Pit's gold: its gate's trim and lamps, its chest's bands (like the Wins pads). */
  gold: '#ffc21f',
  chest: '#7c4d29',
  chestLid: '#94592c',
}

/** Signs' text, top to bottom: white into blue. */
export const SIGN_GRADIENT = ['#ffffff', '#9fe8ff', '#3fb4ff']
