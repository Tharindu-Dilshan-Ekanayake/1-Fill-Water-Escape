/**
 * Hand-off from network events to the frame loop. Events arrive on timers and sockets;
 * the effects they trigger need the renderer's clock and camera, so they are queued
 * here and drained by the effect systems inside useFrame. Plain arrays, never state.
 */

const MAX_QUEUED = 12
const trainQueue = []

export function queueTrainFx(event) {
  trainQueue.push(event)
  if (trainQueue.length > MAX_QUEUED) trainQueue.shift()
}

export function drainTrainFx(handle) {
  while (trainQueue.length) handle(trainQueue.shift())
}

const MAX_BURSTS = 8
const bursts = []

/**
 * Queues a confetti burst at (x, y, z). Dropped by the particle system on presets
 * without particles.
 *
 * `drops: true` throws water droplets instead of confetti: small, stretched along their
 * flight, not spinning, flung up `speed` and out `spread` times that sideways.
 *
 * @param {{ x: number, y: number, z: number, count?: number, speed?: number,
 *           palette?: 'confetti' | 'gold' | 'power' | 'water', drops?: boolean, spread?: number }} burst
 */
export function burst({ x, y, z, count = 30, speed = 7, palette = 'confetti', drops = false, spread = 0.6 }) {
  bursts.push({ x, y, z, count, speed, palette, drops, spread })
  if (bursts.length > MAX_BURSTS) bursts.shift()
}

export function drainBursts(handle) {
  while (bursts.length) handle(bursts.shift())
}
