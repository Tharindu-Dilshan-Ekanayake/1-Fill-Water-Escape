import { levelCap, rebirthMultiplier, waterForLevel } from '@shared/balance'
import { formatMultiplier, formatNumber } from '@shared/format'
import { gainMultiplier, isMaxLevel, levelProgress, waterPacks } from '@shared/logic'

import { sfx } from '../../audio/sfx'
import { actions } from '../../net/actions'
import { getGame, useGame } from '../../store/game'
import Icon from '../Icon'
import StrokeText from '../StrokeText'
import useNow from '../useNow'
import { ChunkyButton, Price } from './parts'
import { GRADIENTS, u } from './style'

/** Width of the whole bar, in reference pixels: every row lines up to it. */
const WIDTH = 900

const PACK_GRADIENTS = [
  'linear-gradient(180deg, #d9f6ff 0%, #9ad8ee 55%, #6aa8c2 100%)',
  'linear-gradient(180deg, #d9f6ff 0%, #9ad8ee 55%, #6aa8c2 100%)',
  'linear-gradient(135deg, #ff5fd2 0%, #8a5cff 35%, #2fb8ff 70%, #5cff9a 100%)',
]

const BAR_FILL = 'linear-gradient(180deg, #fff27a 0%, #ffcb1f 50%, #ff9500 100%)'
const WATER_FILL = 'linear-gradient(180deg, #ffffff 0%, #c9f4ff 45%, #5fd6ff 100%)'
const MULTI = 'linear-gradient(180deg, #ffd6ff 0%, #e27bff 50%, #a93cf0 100%)'
const BOOST = 'linear-gradient(180deg, #fff6a8 0%, #ffd52a 50%, #ff9c00 100%)'

/**
 * "Level 6/15 ... 510/970": your level out of this rebirth's cap, and how much of the
 * Water this level needs you have. At max level it reads "MAX LEVEL 15 ... Rebirth!"
 * and opens the rebirth panel.
 */
function LevelBar() {
  const level = useGame((s) => s.profile.level)
  const water = useGame((s) => s.profile.water)
  const maxed = useGame((s) => isMaxLevel(s.profile))
  const fill = useGame((s) => levelProgress(s.profile))
  const cap = useGame((s) => levelCap(s.profile.rebirths))
  const openPanel = useGame((s) => s.openPanel)
  const from = waterForLevel(level)
  const to = waterForLevel(level + 1)

  return (
    <button
      type="button"
      onClick={maxed ? () => openPanel('rebirth') : undefined}
      className={`relative w-full overflow-hidden text-left ${maxed ? 'pp-btn pointer-events-auto' : 'pointer-events-none'}`}
      style={{
        height: u(70),
        borderRadius: u(12),
        border: `${u(6)} solid #111`,
        background: 'rgba(255, 255, 255, 0.92)',
        boxShadow: `0 ${u(5)} 0 #111, inset 0 ${u(-6)} 0 rgba(0,0,0,0.12)`,
      }}
    >
      <div className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-out" style={{ width: `${fill * 100}%`, background: BAR_FILL }} />
      <div className="absolute" style={{ left: u(10), right: u(10), top: u(5), height: u(12), borderRadius: u(6), background: 'rgba(255,255,255,0.35)' }} />
      <div className="absolute inset-0 flex items-center justify-between" style={{ padding: `0 ${u(18)}`, fontSize: u(50) }}>
        <StrokeText stroke={u(10)}>{maxed ? `MAX LEVEL ${cap}` : `Level ${level}/${cap}`}</StrokeText>
        <StrokeText stroke={u(10)}>{maxed ? 'Rebirth!' : `${formatNumber(Math.max(0, water - from))}/${formatNumber(to - from)}`}</StrokeText>
      </div>
    </button>
  )
}

/**
 * A Water pack: "+10K" on the button over a water drop, its price in Wins in the corner.
 * Packs only fill you up to your max level, so there it greys out: rebirth instead.
 */
function PackButton({ index, amount, price, afford, maxed }) {
  const buy = () => {
    if (maxed) {
      sfx.error()
      getGame().openPanel('rebirth')
      return
    }
    if (getGame().profile.wins < price) {
      sfx.error()
      return
    }
    actions.buyPack(index)
  }
  return (
    <ChunkyButton
      gradient={maxed ? GRADIENTS.greyButton : PACK_GRADIENTS[index]}
      onClick={buy}
      title={maxed ? 'Max level - rebirth!' : `+${formatNumber(amount)} Water`}
      radius={8}
      border={5}
      style={{ width: u(290), height: u(76), opacity: maxed ? 0.75 : 1 }}
    >
      <Icon name="drop" size={u(66)} className="absolute" style={{ left: u(10), bottom: u(-14) }} />
      <span className="relative" style={{ fontSize: u(48), marginLeft: u(30) }}>
        <StrokeText stroke={u(10)}>+{formatNumber(amount)}</StrokeText>
      </span>
      <span className="absolute" style={{ right: u(8), top: u(-16) }}>
        <Price amount={price} size={26} afford={afford} />
      </span>
    </ChunkyButton>
  )
}

/**
 * Bottom centre: your Water Power over a drop, the "x3 Multi (Rebirth)" your rebirths
 * give (and, when pets or potions add to it, the whole boost), the level bar, and the
 * three Water packs.
 */
export function WaterBar() {
  const water = useGame((s) => s.profile.water)
  const rebirths = useGame((s) => s.profile.rebirths)
  const level = useGame((s) => s.profile.level)
  const world = useGame((s) => s.profile.world)
  const wins = useGame((s) => s.profile.wins)
  const profile = useGame((s) => s.profile)
  // Potions run out on their own; re-read the boost every few seconds.
  const now = useNow(5000)
  const boost = gainMultiplier(profile, now)
  const rebirth = rebirthMultiplier(rebirths)
  const packs = waterPacks({ level, rebirths, world })
  const maxed = isMaxLevel({ level, rebirths })

  return (
    <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ bottom: u(14), width: u(WIDTH), gap: u(8) }}>
      <div className="relative flex w-full items-end justify-center" style={{ height: u(84) }}>
        <span className="flex items-center whitespace-nowrap" style={{ gap: u(6) }}>
          <Icon name="drop" size={u(92)} />
          <span style={{ fontSize: u(68), lineHeight: 1 }}>
            <StrokeText stroke={u(13)} gradient={WATER_FILL}>
              {formatNumber(water)} Water Power
            </StrokeText>
          </span>
        </span>
        {/* Over the bar's right end, clear of the Water Power line however long it grows. */}
        <span className="absolute right-0 flex flex-col items-end whitespace-nowrap" style={{ bottom: u(82), lineHeight: 1.05 }}>
          {boost > rebirth && (
            <span style={{ fontSize: u(30) }}>
              <StrokeText stroke={u(6)} gradient={BOOST}>
                {formatMultiplier(boost)} Water Boost
              </StrokeText>
            </span>
          )}
          <span style={{ fontSize: u(36) }}>
            <StrokeText stroke={u(7)} gradient={MULTI}>
              {formatMultiplier(rebirth)} Multi (Rebirth)
            </StrokeText>
          </span>
        </span>
      </div>
      <LevelBar />
      <div className="flex w-full justify-between" style={{ marginTop: u(14) }}>
        {packs.map((pack, i) => (
          <PackButton key={i} index={i} amount={pack.amount} price={pack.price} afford={wins >= pack.price} maxed={maxed} />
        ))}
      </div>
    </div>
  )
}

export default WaterBar
