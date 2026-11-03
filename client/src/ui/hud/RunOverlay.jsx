import { useEffect, useRef } from 'react'

import { coopSpeed, LAST_STAGE, levelCap, stagesOf, TUTORIAL } from '@shared/balance'
import { formatNumber } from '@shared/format'

import { sfx } from '../../audio/sfx'
import { pourInfo } from '../../game/course/pits'
import { getGame, useGame } from '../../store/game'
import Icon from '../Icon'
import StrokeText from '../StrokeText'
import { GRADIENTS, u } from './style'

const WATER_FILL = 'linear-gradient(180deg, #c9f4ff 0%, #5fd6ff 45%, #1a8ff0 100%)'
const STUCK = 'linear-gradient(180deg, #ffd0c8 0%, #ff7a6a 50%, #e2242c 100%)'

/** Writes `text` into a StrokeText (both its outline and its fill copy), if it changed. */
function setStroke(el, text) {
  if (!el || el.dataset.text === text) return
  el.dataset.text = text
  for (const span of el.children) span.textContent = text
}

/**
 * The course's HUD, one slim bar at the top so it never hides the course: the stage
 * you're on, then the next pit this run - "Pit 9 · Lv 15" - filling as you pour into
 * it, with the seconds left at your Water Power, or red with the level it needs if
 * you're too weak for it. A short hint shows under it only when it helps: standing at
 * a pit you can't fill (train, or rebirth past your max level - or the Skip pad), while
 * you pour (tapping pours faster), and on your very first pit. Written straight into the page ten times a second from the
 * course's pit state (game/course/pits.js), never through React.
 */
function CourseHud({ stage }) {
  const tutorial = useGame((s) => Boolean(TUTORIAL[s.profile.tutorialStep]))
  const bar = useRef(null)
  const title = useRef(null)
  const time = useRef(null)
  const hint = useRef(null)
  const meter = useRef(null)

  useEffect(() => {
    const id = setInterval(() => {
      const { profile } = getGame()
      const info = pourInfo
      const next = info.stage
      const done = next > LAST_STAGE || (next === LAST_STAGE && info.fill >= 1)
      if (meter.current) meter.current.style.display = done ? 'none' : 'flex'
      const first = profile.stats.bestStage === 0 && profile.world === 0
      if (done) {
        setStroke(hint.current, 'All pits full - run for the finish!')
        if (hint.current) hint.current.style.display = ''
        return
      }
      const pit = stagesOf(profile.world)[next]
      const cap = levelCap(profile.rebirths)
      setStroke(title.current, `Pit ${next} · Lv ${pit.level}`)
      if (bar.current) {
        bar.current.style.width = `${Math.round(info.fill * 1000) / 10}%`
        bar.current.style.background = info.weak ? STUCK : WATER_FILL
      }
      let right
      let line = ''
      if (info.weak) {
        right = `Need Lv ${pit.level}`
        if (info.atRim) line = pit.level > cap ? `Max Lv ${cap}: rebirth - or use the Skip pad` : `Train to Lv ${pit.level} at the wells - or Skip`
      } else if (info.fill >= 0.98) {
        right = 'Full!'
      } else {
        right = `${Math.ceil(info.secondsLeft)}s`
        if (info.atRim && info.helpers > 0) line = `${info.helpers} pouring with you: x${coopSpeed(info.helpers)} speed!`
        else if (info.atRim) line = info.secondsLeft > 1.5 ? 'Tap to pour faster!' : ''
        else if (first) line = 'Walk up to the pit to pour'
      }
      setStroke(time.current, right)
      // Red when you're too weak for it (the fill copy carries the gradient).
      const fill = time.current?.children[1]
      if (fill) fill.style.backgroundImage = info.weak ? GRADIENTS.priceShort : GRADIENTS.gold
      setStroke(hint.current, line)
      if (hint.current) hint.current.style.display = line ? '' : 'none'
    }, 100)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center"
      style={{ top: u(tutorial ? 160 : 84), width: u(480), maxWidth: '70vw', gap: u(4) }}
    >
      <div
        className="flex w-full items-center overflow-hidden"
        style={{ height: u(42), borderRadius: u(21), border: `${u(4)} solid #111`, background: 'rgba(20, 30, 60, 0.92)', fontSize: u(24) }}
      >
        <span className="flex h-full shrink-0 items-center" style={{ padding: `0 ${u(12)}`, background: '#111' }}>
          <StrokeText stroke={u(6)} gradient={GRADIENTS.gold}>
            {stage === 0 ? 'START' : `STAGE ${stage}/${LAST_STAGE}`}
          </StrokeText>
        </span>
        <div ref={meter} className="relative h-full flex-1">
          <div ref={bar} className="absolute inset-y-0 left-0" style={{ width: '0%', background: WATER_FILL, transition: 'width 120ms linear' }} />
          <div className="absolute inset-0 flex items-center justify-between" style={{ padding: `0 ${u(12)} 0 ${u(4)}` }}>
            <span className="flex items-center" style={{ gap: u(2) }}>
              <Icon name="drop" size={u(30)} />
              <StrokeText ref={title} stroke={u(6)}>
                {' '}
              </StrokeText>
            </span>
            <StrokeText ref={time} stroke={u(6)} gradient={GRADIENTS.gold}>
              {' '}
            </StrokeText>
          </div>
        </div>
      </div>
      <span style={{ fontSize: u(22), whiteSpace: 'nowrap' }}>
        <StrokeText ref={hint} stroke={u(5)} style={{ display: 'none' }}>
          {' '}
        </StrokeText>
      </span>
    </div>
  )
}

/** How many trophies fly to the Wins counter, and where each bursts out to first. */
const FLYERS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + 0.3
  const r = 110 + (i % 3) * 45
  return { sx: Math.cos(a) * r, sy: Math.sin(a) * r * 0.7, delay: 0.35 + i * 0.06 }
})
/** Auto Win's few: it pays out every run's worth of seconds, so it stays quick. */
const AUTO_FLYERS = FLYERS.filter((_, i) => i % 3 === 0).map((f, i) => ({ ...f, sx: f.sx * 0.6, sy: f.sy * 0.6, delay: 0.15 + i * 0.06 }))

/**
 * The Wins flying home: a ring of trophies bursts out of the banner and streams into
 * the Wins counter in the top-left (which bumps as it changes - see StatsPanel), with a
 * coin ping for each. They start from 48% down the screen: the pp-fly animation ends
 * on the counter from there.
 */
function FlyingTrophies({ flyers, size }) {
  useEffect(() => sfx.coins(flyers.length), [flyers])
  return flyers.map((f, i) => (
    <span
      key={i}
      className="pp-fly pointer-events-none absolute left-1/2 top-[48%]"
      style={{ '--sx': u(f.sx), '--sy': u(f.sy), animationDelay: `${f.delay}s` }}
    >
      <Icon name="trophy" size={u(size)} />
    </span>
  ))
}

/** How long each banner stays before the result is cleared. */
const RESULT_MS = 2600
const AUTO_RESULT_MS = 1300

/**
 * A Wins pad paid out: "+123 Wins!" with a trophy, the stage it was (NEW BEST! if it's
 * the furthest yet) and any first-visit prize in it. Auto Win's is a smaller, quicker
 * popup.
 */
function RunResult({ result }) {
  const clearRunResult = useGame((s) => s.clearRunResult)

  useEffect(() => {
    const id = setTimeout(() => {
      if (useGame.getState().runResult?.id === result.id) clearRunResult()
    }, result.auto ? AUTO_RESULT_MS : RESULT_MS)
    return () => clearTimeout(id)
  }, [result, clearRunResult])

  const total = result.wins + result.prize
  if (result.auto) {
    return (
      <>
        <FlyingTrophies key={`fly-${result.id}`} flyers={AUTO_FLYERS} size={52} />
        <div
          key={result.id}
          className="pp-result pointer-events-none absolute left-1/2 top-[48%] flex flex-col items-center"
          style={{ animationDuration: `${AUTO_RESULT_MS}ms` }}
        >
          <div className="flex items-center" style={{ gap: u(10), fontSize: u(58) }}>
            <Icon name="trophy" size={u(72)} />
            <StrokeText stroke={u(11)} gradient={GRADIENTS.gold}>
              +{formatNumber(total)} Wins
            </StrokeText>
          </div>
          <span style={{ fontSize: u(30) }}>
            <StrokeText stroke={u(6)}>AUTO WIN · Stage {result.stage}</StrokeText>
          </span>
        </div>
      </>
    )
  }
  return (
    <>
      <FlyingTrophies key={`fly-${result.id}`} flyers={FLYERS} size={70} />
      {/* Centred by the pp-result animation's own transform. */}
      <div
        key={result.id}
        className="pp-result pointer-events-none absolute left-1/2 top-[48%] flex flex-col items-center"
        style={{ animationDuration: `${RESULT_MS}ms` }}
      >
        <div className="flex items-center" style={{ gap: u(14), fontSize: u(100) }}>
          <Icon name="trophy" size={u(140)} />
          <StrokeText stroke={u(18)} gradient={GRADIENTS.gold}>
            +{formatNumber(total)} Wins!
          </StrokeText>
        </div>
        <div style={{ fontSize: u(46) }}>
          <StrokeText stroke={u(10)} gradient={WATER_FILL}>
            {result.best ? `NEW BEST: Stage ${result.stage}!` : `Stage ${result.stage}`}
          </StrokeText>
        </div>
        {result.prize > 0 && (
          <div className="flex items-center" style={{ gap: u(8), fontSize: u(38), marginTop: u(6) }}>
            <Icon name="starGold" size={u(50)} />
            <StrokeText stroke={u(8)} gradient={GRADIENTS.gold}>
              +{formatNumber(result.prize)} first-visit prize!
            </StrokeText>
          </div>
        )}
      </div>
    </>
  )
}

/** How long a toast stays up. */
const TOAST_MS = 3500

/** A celebration banner across the middle: a new bucket, an ad reward, a Gems purchase. */
function Toast() {
  const toast = useGame((s) => s.toast)
  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => {
      if (useGame.getState().toast === toast) useGame.setState({ toast: null })
    }, TOAST_MS)
    return () => clearTimeout(id)
  }, [toast])
  if (!toast) return null
  return (
    <div
      key={toast.id}
      className="pp-result pointer-events-none absolute left-1/2 top-[30%] flex flex-col items-center text-center"
      style={{ fontSize: u(60), animationDuration: `${TOAST_MS}ms`, width: 'max-content', maxWidth: '92vw' }}
    >
      <StrokeText stroke={u(12)} gradient={GRADIENTS.gold} style={{ whiteSpace: 'normal' }}>
        {toast.text}
      </StrokeText>
    </div>
  )
}

/** The course's HUD, the Wins pads' payouts and the celebration toasts. */
export function RunOverlay() {
  const stage = useGame((s) => s.zone.stage)
  const result = useGame((s) => s.runResult)
  return (
    <>
      {stage >= 0 && <CourseHud stage={stage} />}
      {result && <RunResult result={result} />}
      <Toast />
    </>
  )
}

export default RunOverlay
