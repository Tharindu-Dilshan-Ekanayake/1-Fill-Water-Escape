import { SHOP } from '@shared/balance'

import { actions } from '../../net/actions'
import { buy } from '../../net/shop'
import { useGame } from '../../store/game'
import Icon from '../Icon'
import StrokeText from '../StrokeText'
import { ChunkyButton, Price } from './parts'
import { GRADIENTS, u } from './style'

/** `setting`: a pass that, once owned, the button switches on and off. */
const PASSES = [
  { product: 'waterX2', label: 'x2 Water', icon: 'drop', gradient: 'linear-gradient(135deg, #ff5fd2 0%, #8a5cff 35%, #2fb8ff 70%, #5cff9a 100%)' },
  { product: 'winsX2', label: 'x2 Wins', icon: 'trophy', gradient: 'linear-gradient(180deg, #fff27a 0%, #ffcb1f 48%, #ff9a0a 100%)' },
  { product: 'autoWin', label: 'Auto Win!', icon: 'bucket', setting: 'autoWin', gradient: 'linear-gradient(180deg, #ff9a8a 0%, #ff3b3b 50%, #c8102a 100%)' },
]

/**
 * One pass: its name over a big icon, and the price (or OWNED) underneath. Auto Win,
 * once owned, is a switch: ON claims your best ledge's Wins pad while you stand on the
 * course's start line.
 */
function PassButton({ product, label, icon, gradient, setting }) {
  const item = SHOP[product]
  const owned = useGame((s) => Boolean(s.profile.passes[product]))
  const on = useGame((s) => Boolean(setting && s.profile.settings[setting]))
  const afford = useGame((s) => s.profile.wins >= item.price)
  const toggles = owned && setting
  const press = toggles ? () => actions.setSetting(setting, !on) : () => buy(product)
  return (
    <div className="flex flex-col items-center">
      <ChunkyButton
        gradient={toggles && !on ? GRADIENTS.greyButton : gradient}
        onClick={press}
        disabled={owned && !setting}
        title={toggles ? `${item.name}: ${on ? 'ON' : 'OFF'}` : item.name}
        radius={20}
        border={5}
        style={{ width: u(250), height: u(84) }}
      >
        <Icon name={icon} size={u(96)} className="absolute" style={{ opacity: 0.85 }} />
        <span className="relative" style={{ fontSize: u(50) }}>
          <StrokeText stroke={u(10)}>{label}</StrokeText>
        </span>
      </ChunkyButton>
      <span style={{ marginTop: u(8) }}>
        {owned ? (
          <span style={{ fontSize: u(30) }}>
            <StrokeText stroke={u(7)} fill={toggles && !on ? '#ff8a7a' : '#7dff4a'}>
              {toggles ? (on ? 'ON' : 'OFF') : 'OWNED'}
            </StrokeText>
          </span>
        ) : (
          <Price amount={item.price} size={32} afford={afford} />
        )}
      </span>
    </div>
  )
}

/** The x2 Water, x2 Wins and Auto Win passes down the right-hand side, as in the reference. */
export function PassButtons() {
  return (
    <div className="hud-passes pointer-events-none absolute flex flex-col" style={{ gap: u(26) }}>
      {PASSES.map((pass) => (
        <PassButton key={pass.product} {...pass} />
      ))}
    </div>
  )
}

export default PassButtons
