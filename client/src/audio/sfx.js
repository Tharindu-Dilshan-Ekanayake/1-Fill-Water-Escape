import { createMusic } from './music'

/**
 * Sound effects and the background music, synthesised with WebAudio: no audio files
 * to download.
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is created on
 * the first tap/click/key (which also starts the music) and every sound before that is
 * silently skipped.
 */

const MUTE_KEY = 'pp.muted'
/** Master gain at full volume; everything is mixed to sit under this. */
const BASE_GAIN = 0.5

let ctx = null
let master = null
/** Input of the echo the chimes ring out into (see createEcho). */
let echo = null
let noiseBuffer = null
let music = null
/** The player's own mute button (persisted). */
let muted = readMuted()
/**
 * Muted for a Boxity ad break. Kept apart from `muted` so the break ending restores
 * whatever the player had chosen, never overwrites it.
 */
let adMuted = false
/** Boxity's master_volume / music_volume settings, 0..1 (not persisted: Boxity keeps them). */
let masterVolume = 1
let musicVolume = 1
const lastPlayed = new Map()
const muteListeners = new Set()

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

const silent = () => muted || adMuted

function applyMaster() {
  if (master) master.gain.value = silent() ? 0 : BASE_GAIN * masterVolume
}

function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended' && !adMuted) ctx.resume()
    return
  }
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return
  ctx = new Ctor()
  master = ctx.createGain()
  applyMaster()
  master.connect(ctx.destination)
  echo = createEcho()
  // One second of white noise, reused by every whoosh and crack.
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  music = createMusic(ctx, master, noiseBuffer)
  music.setVolume(musicVolume)
  music.start()
  if (adMuted) ctx.suspend()
}

/**
 * A short, darkening echo for the chimes to ring out into, so they sparkle instead of
 * clicking off. Built once; every sound sent to it shares it.
 */
function createEcho() {
  const input = ctx.createGain()
  input.gain.value = 0.25
  const delay = ctx.createDelay(1)
  delay.delayTime.value = 0.13
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 3200
  const feedback = ctx.createGain()
  feedback.gain.value = 0.32
  input.connect(delay)
  delay.connect(damp).connect(feedback).connect(delay)
  damp.connect(master)
  return input
}

/** Installs the first-gesture unlock. Call once at startup. */
export function installAudioUnlock() {
  const events = ['pointerdown', 'keydown', 'touchend']
  const handler = () => {
    unlock()
    for (const e of events) window.removeEventListener(e, handler, true)
  }
  for (const e of events) window.addEventListener(e, handler, true)
  // Mobile browsers suspend audio in the background; resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx?.state === 'suspended' && !adMuted) ctx.resume()
  })
}

export function isMuted() {
  return muted
}

export function setMuted(value) {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    // Not persisted; fine.
  }
  applyMaster()
  for (const listener of muteListeners) listener(muted)
}

const clampVolume = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)

/** Overall volume 0..1 (Boxity's master_volume setting). */
export function setMasterVolume(volume) {
  masterVolume = clampVolume(volume)
  applyMaster()
}

/** Music volume 0..1 (Boxity's music_volume setting), on top of the master volume. */
export function setMusicVolume(volume) {
  musicVolume = clampVolume(volume)
  music?.setVolume(musicVolume)
}

/**
 * Silences everything for a Boxity ad break, and suspends the audio clock so the music
 * scheduler doesn't pile notes up behind it. Ending the break restores the player's
 * own mute choice and volumes exactly as they were.
 */
export function setAdBreakMuted(on) {
  adMuted = Boolean(on)
  applyMaster()
  if (!ctx) return
  if (adMuted) ctx.suspend()
  else if (ctx.state === 'suspended' && document.visibilityState === 'visible') ctx.resume()
}

/** Calls `listener(muted)` on every change; returns the unsubscribe. */
export function onMutedChange(listener) {
  muteListeners.add(listener)
  return () => muteListeners.delete(listener)
}

// --- Pouring: the gurgle of your bucket emptying into a pit ---------------------------

let pour = null

/**
 * A looping noise source through a bandpass whose pitch and loudness wobble quickly:
 * water glugging out of a bucket. Runs until `pourStop`.
 */
function pourStart() {
  if (!ctx || pour || silent() || ctx.state !== 'running') return
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  src.loop = true
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 700
  filter.Q.value = 2.2
  const gain = ctx.createGain()
  gain.gain.value = 0.0001
  src.connect(filter).connect(gain).connect(master)
  // The glug: the band's pitch and the loudness bubbling up and down.
  const glug = ctx.createOscillator()
  glug.frequency.value = 9
  const pitch = ctx.createGain()
  pitch.gain.value = 260
  glug.connect(pitch).connect(filter.frequency)
  const swell = ctx.createGain()
  swell.gain.value = 0.05
  glug.connect(swell).connect(gain.gain)
  const t = ctx.currentTime
  gain.gain.setTargetAtTime(0.13, t, 0.05)
  glug.start()
  src.start(t, Math.random() * 0.5)
  pour = { src, glug, gain }
}

function pourStop() {
  if (!pour) return
  const { src, glug, gain } = pour
  pour = null
  const t = ctx.currentTime
  gain.gain.setTargetAtTime(0.0001, t, 0.08)
  src.stop(t + 0.6)
  glug.stop(t + 0.6)
}

function ready(name, minGapMs = 0) {
  if (!ctx || silent() || ctx.state !== 'running') return false
  const now = performance.now()
  if (minGapMs && now - (lastPlayed.get(name) || 0) < minGapMs) return false
  lastPlayed.set(name, now)
  return true
}

/** A short enveloped oscillator note; `echo` also sends it into the echo. */
function tone(freq, { type = 'sine', at = 0, duration = 0.12, volume = 0.3, slideTo = null, attack = 0.01, echo: wet = false } = {}) {
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(volume, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(gain).connect(master)
  if (wet) gain.connect(echo)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

/** A struck bell: the note, a quieter octave and a glassy strike, ringing into the echo. */
function bell(freq, { at = 0, volume = 0.1, decay = 0.4 } = {}) {
  tone(freq, { at, duration: decay, volume, echo: true })
  tone(freq * 2, { at, duration: decay * 0.6, volume: volume * 0.35, echo: true })
  tone(freq * 3.01, { type: 'triangle', at, duration: 0.05, volume: volume * 0.3 })
}

/** Trophy chimes climb and fall this scale while they keep coming (C major pentatonic). */
const TROPHY_SCALE = [1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637]
/** A trophy within this long of the last carries the run on; otherwise it starts again. */
const TROPHY_RUN_MS = 700
let trophyRun = 0
let trophyAt = 0

/** Filtered noise: whooshes and cracks. */
function noise({ at = 0, duration = 0.3, volume = 0.25, from = 400, to = 2400, q = 1.2 } = {}) {
  const t = ctx.currentTime + at
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = q
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(to, t + duration)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(volume, t + duration * 0.3)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  src.connect(filter).connect(gain).connect(master)
  // Looped, so a long one from a random spot never runs off the end of the second.
  src.loop = true
  src.start(t, Math.random() * 0.5)
  src.stop(t + duration + 0.02)
}

export const sfx = {
  click() {
    if (ready('click', 40)) tone(660, { type: 'triangle', duration: 0.05, volume: 0.15 })
  },
  /** A Water gain: a bright tick. */
  gain() {
    if (ready('gain', 110)) tone(880 + Math.random() * 120, { type: 'triangle', duration: 0.07, volume: 0.07, slideTo: 1400 })
  },
  levelUp() {
    if (!ready('levelUp')) return
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, { type: 'square', at: i * 0.07, duration: 0.14, volume: 0.09 }))
  },
  /** Jumping into a pit full of water: a deep plunge, a spray of droplets and a bloop. */
  splash() {
    if (!ready('splash', 250)) return
    tone(180, { duration: 0.25, volume: 0.16, slideTo: 60 })
    noise({ duration: 0.5, volume: 0.28, from: 3200, to: 500, q: 0.6 })
    for (let i = 0; i < 5; i += 1) tone(900 + Math.random() * 900, { type: 'sine', at: 0.08 + i * 0.05, duration: 0.06, volume: 0.04, slideTo: 1800 })
  },
  /** One stroke swimming across: a soft wash of water. */
  swim() {
    if (ready('swim', 380)) noise({ duration: 0.3, volume: 0.07, from: 1400, to: 500, q: 0.7 })
  },
  /** A pit filled to the brim: bubbles rising into a bright chime. */
  filled() {
    if (!ready('filled', 200)) return
    for (let i = 0; i < 4; i += 1) tone(500 + i * 180, { type: 'sine', at: i * 0.04, duration: 0.09, volume: 0.06, slideTo: 900 + i * 220 })
    ;[784, 1047, 1319].forEach((f, i) => bell(f, { at: 0.16 + i * 0.07, volume: 0.06, decay: 0.35 }))
  },
  /** A pit your Water can't fill: the pour runs dry with a sad low bloop. */
  tooDeep() {
    if (!ready('tooDeep', 400)) return
    tone(330, { type: 'sine', duration: 0.18, volume: 0.12, slideTo: 140 })
    tone(220, { type: 'triangle', at: 0.18, duration: 0.3, volume: 0.08, slideTo: 90 })
  },
  /** Scooping water up in a well: a quick hollow bloop. */
  scoop() {
    if (!ready('scoop', 250)) return
    tone(300 + Math.random() * 60, { type: 'sine', duration: 0.12, volume: 0.08, slideTo: 720 })
  },
  /** A Skip pad filling the next pit: a magic shimmer rising. */
  skip() {
    if (!ready('skip')) return
    noise({ duration: 0.6, volume: 0.12, from: 800, to: 5200, q: 1.4 })
    ;[659, 880, 1175, 1568, 2093].forEach((f, i) => bell(f, { at: i * 0.06, volume: 0.05, decay: 0.3 }))
  },
  /** A new best stage reached: a quick, cheerful rising jingle. */
  stageUp() {
    if (!ready('stageUp', 300)) return
    ;[659, 784, 988, 1319].forEach((f, i) => tone(f, { type: 'triangle', at: i * 0.06, duration: 0.16, volume: 0.08, echo: true }))
    for (let i = 0; i < 3; i += 1) bell(1760 + Math.random() * 900, { at: 0.24 + i * 0.05, volume: 0.03, decay: 0.18 })
  },
  /** Trophies landing in the Wins counter: little coin pings, one after another. */
  coins(count = 8) {
    if (!ready('coins', 400)) return
    for (let i = 0; i < count; i += 1) bell(1900 + (i % 4) * 230, { at: 0.55 + i * 0.07, volume: 0.04, decay: 0.12 })
  },
  /**
   * A trophy landing: a bell that climbs the scale and back down while they keep
   * coming, so a run of them plays a little tune.
   */
  trophy() {
    if (!ready('trophy', 90)) return
    const now = performance.now()
    trophyRun = now - trophyAt < TROPHY_RUN_MS ? trophyRun + 1 : 0
    trophyAt = now
    const n = TROPHY_SCALE.length
    const k = trophyRun % (2 * n - 2)
    bell(TROPHY_SCALE[k < n ? k : 2 * n - 2 - k], { volume: 0.085, decay: 0.32 })
  },
  /** Wins paid out (a Wins pad, a badge): a fanfare, a shimmering chord and a shower of coins. */
  wins() {
    if (!ready('wins')) return
    ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, { type: 'triangle', at: i * 0.07, duration: 0.2, volume: 0.1, echo: true }))
    // G major, held, each voice doubled a hair apart so it shimmers.
    for (const f of [784, 988, 1175]) {
      tone(f * 1.003, { at: 0.28, duration: 0.9, volume: 0.045, attack: 0.05, echo: true })
      tone(f * 0.997, { at: 0.28, duration: 0.9, volume: 0.045, attack: 0.05 })
    }
    for (let i = 0; i < 6; i += 1) bell(2093 + Math.random() * 1200, { at: 0.3 + i * 0.07 + Math.random() * 0.03, volume: 0.035, decay: 0.2 })
  },
  crack() {
    if (!ready('crack', 150)) return
    noise({ duration: 0.12, volume: 0.35, from: 1800, to: 600, q: 0.8 })
    tone(220, { type: 'square', duration: 0.08, volume: 0.08, slideTo: 90 })
  },
  reveal() {
    if (!ready('reveal')) return
    ;[392, 523, 659, 784, 1047].forEach((f, i) => tone(f, { type: 'triangle', at: i * 0.06, duration: 0.22, volume: 0.12 }))
  },
  buy() {
    if (!ready('buy')) return
    tone(1047, { type: 'square', duration: 0.07, volume: 0.08 })
    tone(1568, { type: 'square', at: 0.08, duration: 0.16, volume: 0.08 })
  },
  error() {
    if (ready('error', 200)) tone(160, { type: 'sawtooth', duration: 0.18, volume: 0.07, slideTo: 110 })
  },
  rebirth() {
    if (!ready('rebirth')) return
    noise({ duration: 0.8, volume: 0.15, from: 200, to: 4000, q: 0.6 })
    ;[262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, { type: 'sawtooth', at: 0.1 + i * 0.07, duration: 0.25, volume: 0.06 }))
  },
  /** Stepping into an unlocked well: a soft rising chime. */
  wellEnter() {
    if (!ready('wellEnter', 400)) return
    ;[523, 784, 1047].forEach((f, i) => tone(f, { type: 'sine', at: i * 0.05, duration: 0.28, volume: 0.07 }))
  },
  /** A jump: a springy little boing. */
  jump() {
    if (ready('jump', 120)) tone(260, { type: 'triangle', duration: 0.18, volume: 0.1, slideTo: 620 })
  },
  /** Landing from a jump: a soft thump. */
  jumpLand() {
    if (!ready('jumpLand', 150)) return
    tone(140, { type: 'sine', duration: 0.12, volume: 0.12, slideTo: 70 })
    noise({ duration: 0.08, volume: 0.06, from: 900, to: 300, q: 0.7 })
  },
  pourStart,
  pourStop,
}
