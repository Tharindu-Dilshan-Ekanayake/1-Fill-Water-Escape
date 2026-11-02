import { Vector3 } from 'three'

/**
 * Floating "+12" text: a fixed pool of DOM elements (max 10 alive), positioned by
 * projecting a world point each frame. When the pool is full the oldest popup is
 * recycled, so a fast well can never pile up elements.
 */

export const POPUP_POOL_SIZE = 10
const LIFE_MS = 1150
const RISE = 1.4
const DEFAULT_GRADIENT = 'linear-gradient(180deg, #fffaa8 0%, #ffd52a 45%, #ff9c00 100%)'

/** @type {Array<{ el: HTMLElement, texts: HTMLElement[], icon: HTMLImageElement, active: boolean, born: number, life: number, pos: Vector3, scale: number }>} */
const pool = []
const _v = new Vector3()

/** Called by PopupLayer once its elements exist. */
export function registerPopupElements(elements) {
  pool.length = 0
  for (const el of elements) {
    if (!el) continue
    pool.push({
      el,
      texts: [...el.querySelectorAll('[data-popup-text]')],
      icon: el.querySelector('img'),
      // What the DOM currently shows, so spawning only writes what changed: setting an
      // img src (even to the same data URL) or a gradient restyles and re-decodes.
      shown: { text: null, gradient: null, iconUrl: undefined },
      active: false,
      born: 0,
      life: LIFE_MS,
      pos: new Vector3(),
      /** Set for popups that ride along with something moving; `pos` is then relative to it. */
      follow: null,
      scale: 1,
      /** Tilt in degrees. */
      rot: 0,
    })
  }
}

/**
 * @param {string} text
 * @param {{ x: number, y: number, z: number }} position world point to rise from
 * @param {{ iconUrl?: string, scale?: number, gradient?: string, life?: number,
 *   follow?: Vector3, rot?: number }} [style]
 *   no `iconUrl` = text only; `follow` keeps the popup where it started relative to that
 *   (moving) point; `rot` tilts it.
 */
export function spawnPopup(text, position, style = {}) {
  if (pool.length === 0) return
  let slot = pool.find((p) => !p.active)
  if (!slot) slot = pool.reduce((oldest, p) => (p.born < oldest.born ? p : oldest), pool[0])
  slot.active = true
  slot.born = performance.now()
  slot.life = style.life || LIFE_MS
  slot.scale = style.scale || 1
  slot.pos.set(position.x, position.y, position.z)
  slot.follow = style.follow || null
  if (slot.follow) slot.pos.sub(slot.follow)
  slot.rot = style.rot || 0
  const shown = slot.shown
  if (shown.text !== text) {
    shown.text = text
    for (const t of slot.texts) t.textContent = text
  }
  const gradient = style.gradient || DEFAULT_GRADIENT
  if (slot.texts[1] && shown.gradient !== gradient) {
    shown.gradient = gradient
    slot.texts[1].style.backgroundImage = gradient
  }
  const iconUrl = style.iconUrl || null
  if (slot.icon && shown.iconUrl !== iconUrl) {
    shown.iconUrl = iconUrl
    slot.icon.style.display = iconUrl ? '' : 'none'
    if (iconUrl) slot.icon.src = iconUrl
  }
  // Hidden until the next frame places it, so it never shows at the corner first.
  slot.el.style.opacity = '0'
  slot.el.style.display = 'flex'
}

/** Positions every live popup. Runs inside the frame loop; touches only DOM styles. */
export function updatePopups(camera, width, height) {
  const now = performance.now()
  for (const p of pool) {
    if (!p.active) continue
    const t = (now - p.born) / p.life
    if (t >= 1) {
      p.active = false
      p.el.style.display = 'none'
      continue
    }
    // Pop in, hold, fade out.
    const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : t < 0.22 ? 1.15 - ((t - 0.12) / 0.1) * 0.15 : 1
    const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1

    _v.copy(p.pos)
    if (p.follow) _v.add(p.follow)
    _v.y += t * RISE
    _v.project(camera)
    if (_v.z > 1) {
      p.el.style.opacity = '0'
      continue
    }
    const x = (_v.x * 0.5 + 0.5) * width
    const y = (-_v.y * 0.5 + 0.5) * height
    p.el.style.opacity = String(fade)
    p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${p.rot}deg) scale(${pop * p.scale})`
  }
}
