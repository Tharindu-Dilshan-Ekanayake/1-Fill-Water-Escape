import { useState } from 'react'

import { AD_REWARDS, COSMETICS, GEM_PRODUCTS, PETS, SHOP, WELLS } from '@shared/balance'
import { formatNumber } from '@shared/format'

import { buyGems, isRewardedAvailable, useGemsBalance, watchRewardedAd } from '../../bloxity/services'
import { actions } from '../../net/actions'
import { buy } from '../../net/shop'
import { useGame } from '../../store/game'
import { useQuality } from '../../store/quality'
import Icon from '../Icon'
import PetIcon from '../PetIcon'
import RewardIcon from '../RewardIcon'
import StrokeText from '../StrokeText'
import { ChunkyButton, Price } from '../hud/parts'
import { GRADIENTS, u } from '../hud/style'
import Panel from './Panel'

const SECTIONS = [
  { title: 'Passes', items: ['waterX2', 'winsX2', 'autoWin'] },
  { title: 'Training Wells', items: ['wellVeryOp', 'wellBest'] },
  { title: 'Specials', items: ['sphinx'] },
]

const ICONS = {
  waterX2: 'drop',
  winsX2: 'trophy',
  autoWin: 'bucket',
  wellVeryOp: 'portal',
  wellBest: 'portal',
}

/** The well a pass unlocks, for its blurb. */
const wellFor = (product) => WELLS.find((well) => well.product === product)

const BLURBS = {
  waterX2: 'Double every Water gain, forever',
  winsX2: 'Double every Wins pad, forever',
  autoWin: 'Claims your best ledge’s Wins while you stand on the start line',
  wellVeryOp: `Unlocks the x${wellFor('wellVeryOp').mult} ${wellFor('wellVeryOp').name}`,
  wellBest: `Unlocks the x${wellFor('wellBest').mult} ${wellFor('wellBest').name}`,
  sphinx: `Limited: x${formatNumber(PETS.sphinx.mult)} Water pet`,
}

const BLURB_STYLE = { color: '#3a2a10', fontFamily: 'system-ui, sans-serif', fontWeight: 700 }

/** A shop card: icon, name, what it does, and its button. */
function Card({ icon, name, blurb, faded, children }) {
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{ padding: u(10), borderRadius: u(8), border: `${u(5)} solid #111`, background: faded ? GRADIENTS.greyButton : GRADIENTS.rewardCard }}
    >
      {icon}
      <span style={{ fontSize: u(name.length > 12 ? 24 : 30), lineHeight: 1.1 }}>
        <StrokeText stroke={u(6)} style={{ whiteSpace: 'normal' }}>
          {name}
        </StrokeText>
      </span>
      <span className="whitespace-normal" style={{ fontSize: u(18), minHeight: u(44), margin: `${u(4)} 0` }}>
        <span style={BLURB_STYLE}>{blurb}</span>
      </span>
      {children}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: u(40), marginBottom: u(8) }}>
      <StrokeText stroke={u(8)} gradient={GRADIENTS.gold}>
        {children}
      </StrokeText>
    </div>
  )
}

const GRID = { gridTemplateColumns: `repeat(auto-fill, minmax(${u(200)}, 1fr))`, gap: u(12) }

/**
 * Boxity Gems: real-currency extras, priced by Boxity's catalog (the game only names
 * the sku). The purchase is confirmed to the game server by Boxity, which then grants
 * it; offline it's granted here once Boxity says it went through.
 */
function GemsSection() {
  const balance = useGemsBalance()
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState(null)
  const purchase = async (sku) => {
    setBusy(sku)
    setMessage(null)
    const result = await buyGems(sku)
    setBusy(null)
    if (!result.success) setMessage(result.error ? `Purchase not completed: ${result.error}` : 'Purchase not completed')
  }
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between" style={{ gap: u(10) }}>
        <SectionTitle>Gems Shop</SectionTitle>
        {balance !== null && (
          <span style={{ fontSize: u(30) }}>
            <StrokeText stroke={u(6)} fill="#7fe2ff">
              {formatNumber(balance)} Gems
            </StrokeText>
          </span>
        )}
      </div>
      <div className="grid" style={GRID}>
        {Object.entries(GEM_PRODUCTS).map(([sku, product]) => (
          <Card key={sku} icon={<RewardIcon icon={product.icon} size={u(96)} />} name={product.name} blurb={product.blurb}>
            <ChunkyButton gradient={GRADIENTS.blueButton} disabled={busy !== null} onClick={() => purchase(sku)} className="w-full" style={{ height: u(58) }}>
              <span style={{ fontSize: u(30) }}>
                <StrokeText stroke={u(6)}>{busy === sku ? '...' : 'Buy with Gems'}</StrokeText>
              </span>
            </ChunkyButton>
          </Card>
        ))}
      </div>
      {message && (
        <p className="m-0 text-center" style={{ fontSize: u(24), marginTop: u(8) }}>
          <StrokeText stroke={u(5)} fill="#ffd27a">
            {message}
          </StrokeText>
        </p>
      )}
    </div>
  )
}

/** A trail's colours, for its swatch. */
const TRAIL_SWATCHES = {
  none: 'linear-gradient(135deg, #8a929c, #5b626b)',
  bubbles: 'radial-gradient(circle at 35% 35%, #ffffff 0 18%, #7fe2ff 19% 55%, #2fa8ff 56%)',
  sparkle: 'radial-gradient(circle at 35% 35%, #ffffff 0 15%, #ffe45c 16% 55%, #ff9a12 56%)',
  confetti: GRADIENTS.rainbow,
  stardust: 'radial-gradient(circle at 35% 35%, #ffffff 0 12%, #ff7ad6 13% 40%, #6a5cff 41%)',
  fire: 'radial-gradient(circle at 50% 70%, #ffd21f 0 25%, #ff6a1e 26% 60%, #d4142a 61%)',
}

/** A cosmetic's swatch: the colour it pours, or its trail's sparkles. */
function Swatch({ kind, id, look }) {
  const background = kind === 'trail' ? TRAIL_SWATCHES[id] : look.color === 'rainbow' ? GRADIENTS.rainbow : look.color
  return <span className="block rounded-full" style={{ width: u(84), height: u(84), margin: u(6), border: `${u(5)} solid #111`, background }} />
}

/**
 * Cosmetics: the colour of the Water you pour and a trail behind you - bought once with
 * Wins, shown or swapped any time. Looks only.
 */
function CosmeticsSection({ kind, title, blurb }) {
  const looks = useGame((s) => s.profile.cosmetics)
  const wins = useGame((s) => s.profile.wins)
  const particles = useQuality((s) => s.settings.particles)
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="grid" style={GRID}>
        {Object.entries(COSMETICS[kind]).map(([id, look]) => {
          const owned = looks.owned.includes(id)
          const shown = looks[kind] === id
          const note = kind === 'trail' && id !== 'none' && !particles ? `${blurb} (needs Medium graphics)` : blurb
          return (
            <Card key={id} icon={<Swatch kind={kind} id={id} look={look} />} name={look.name} blurb={note} faded={shown}>
              <ChunkyButton
                gradient={shown ? GRADIENTS.greyButton : owned ? GRADIENTS.blueButton : GRADIENTS.greenButton}
                disabled={shown}
                onClick={() => actions.cosmetic(kind, id)}
                className="w-full"
                style={{ height: u(58) }}
              >
                {shown || owned ? (
                  <span style={{ fontSize: u(30) }}>
                    <StrokeText stroke={u(6)}>{shown ? 'Showing' : 'Show'}</StrokeText>
                  </span>
                ) : (
                  <Price amount={look.price} size={32} afford={wins >= look.price} />
                )}
              </ChunkyButton>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/** Free potions for watching an ad (Boxity rewarded ads), when Boxity has one to show. */
function FreeSection() {
  const [state, setState] = useState({})
  if (!isRewardedAvailable()) return null
  const watch = async (placement) => {
    setState((s) => ({ ...s, [placement]: 'watching' }))
    const result = await watchRewardedAd(placement)
    setState((s) => ({ ...s, [placement]: result.ok ? 'done' : 'retry' }))
  }
  return (
    <div>
      <SectionTitle>Free Rewards</SectionTitle>
      <div className="grid" style={GRID}>
        {Object.entries(AD_REWARDS).map(([placement, reward]) => {
          const status = state[placement]
          return (
            <Card key={placement} icon={<Icon name={reward.icon} size={u(96)} />} name={reward.label} blurb="Watch a short ad to get it">
              <ChunkyButton
                gradient={GRADIENTS.greenButton}
                disabled={status === 'watching'}
                onClick={() => watch(placement)}
                className="w-full"
                style={{ height: u(58) }}
              >
                <span style={{ fontSize: u(28) }}>
                  <StrokeText stroke={u(6)}>{status === 'watching' ? '...' : status === 'retry' ? 'Try again later' : status === 'done' ? 'Got it!' : 'Watch Ad'}</StrokeText>
                </span>
              </ChunkyButton>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

/** Everything Wins can buy besides buckets, eggs and Water packs, grouped - passes, wells, cosmetics - plus Gems and free rewards. */
export function StorePanel() {
  const passes = useGame((s) => s.profile.passes)
  const wins = useGame((s) => s.profile.wins)
  return (
    <Panel title="STORE" width={1080}>
      <div className="flex flex-col" style={{ gap: u(18) }}>
        <FreeSection />
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <SectionTitle>{section.title}</SectionTitle>
            <div className="grid" style={GRID}>
              {section.items.map((id) => {
                const product = SHOP[id]
                const owned = product.kind === 'pass' && passes[id]
                const icon = id === 'sphinx' ? <PetIcon id="sphinx" size={u(96)} /> : <Icon name={ICONS[id]} size={u(96)} />
                return (
                  <Card key={id} icon={icon} name={product.name} blurb={BLURBS[id]} faded={owned}>
                    <ChunkyButton
                      gradient={owned ? GRADIENTS.greyButton : GRADIENTS.greenButton}
                      disabled={owned}
                      onClick={() => buy(id)}
                      className="w-full"
                      style={{ height: u(58) }}
                    >
                      {owned ? (
                        <span style={{ fontSize: u(30) }}>
                          <StrokeText stroke={u(6)}>Owned</StrokeText>
                        </span>
                      ) : (
                        <Price amount={product.price} size={32} afford={wins >= product.price} />
                      )}
                    </ChunkyButton>
                  </Card>
                )
              })}
            </div>
          </div>
        ))}
        <CosmeticsSection kind="stream" title="Pour Colours" blurb="The colour of the Water you pour" />
        <CosmeticsSection kind="trail" title="Trails" blurb="Sparkles behind you as you move" />
        <GemsSection />
      </div>
    </Panel>
  )
}

export default StorePanel
