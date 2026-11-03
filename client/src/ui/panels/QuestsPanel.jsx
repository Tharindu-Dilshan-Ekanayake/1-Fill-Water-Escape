import { DAILY_INTERVAL_MS, ITEMS, QUEST_BONUS } from '@shared/balance'
import { formatClock, formatNumber } from '@shared/format'
import { currentQuests, questDay } from '@shared/logic'

import { useGame } from '../../store/game'
import Icon from '../Icon'
import RewardIcon from '../RewardIcon'
import StrokeText from '../StrokeText'
import useNow from '../useNow'
import { GRADIENTS, u } from '../hud/style'
import Panel from './Panel'

/** An item reward's picture: its potion, or its egg. */
const rewardIcon = ({ item }) => (ITEMS[item].kind === 'egg' ? `egg:${ITEMS[item].egg}` : item)
const rewardText = ({ item, amount }) => (amount > 1 ? `${amount} ${ITEMS[item].name}s` : ITEMS[item].name)

const BAR_FILL = 'linear-gradient(180deg, #c9ff96 0%, #6fe04a 50%, #26ad3c 100%)'

/** One quest: what to do, how far along you are, and what it pays. */
function QuestRow({ quest }) {
  return (
    <div
      className="flex items-center"
      style={{ gap: u(18), padding: u(14), borderRadius: u(8), border: `${u(4)} solid #111`, background: quest.done ? 'rgba(80, 200, 90, 0.25)' : 'rgba(255,255,255,0.06)' }}
    >
      <div className="flex flex-1 flex-col" style={{ gap: u(8) }}>
        <span style={{ fontSize: u(40) }}>
          <StrokeText stroke={u(8)}>{quest.text}</StrokeText>
        </span>
        <div className="relative w-full overflow-hidden" style={{ height: u(40), borderRadius: u(20), border: `${u(4)} solid #111`, background: 'rgba(0,0,0,0.45)' }}>
          <div className="absolute inset-y-0 left-0" style={{ width: `${(quest.progress / quest.target) * 100}%`, background: BAR_FILL }} />
          <span className="absolute inset-0 flex items-center justify-center" style={{ fontSize: u(28) }}>
            <StrokeText stroke={u(6)}>{quest.done ? 'DONE!' : `${formatNumber(quest.progress)} / ${formatNumber(quest.target)}`}</StrokeText>
          </span>
        </div>
      </div>
      <div className="relative flex flex-col items-center" style={{ width: u(150) }}>
        <RewardIcon icon={rewardIcon(quest.reward)} size={u(84)} />
        <span className="text-center" style={{ fontSize: u(22), lineHeight: 1.1 }}>
          <StrokeText stroke={u(5)}>{rewardText(quest.reward)}</StrokeText>
        </span>
        {quest.done && <Icon name="check" size={u(54)} style={{ position: 'absolute', top: u(-10), right: u(4) }} />}
      </div>
    </div>
  )
}

/**
 * Today's three quests (the same for everyone, new every day at 00:00 UTC): progress
 * bars, each one's reward - given the moment it's done - and the bonus for all three.
 */
export function QuestsPanel() {
  const profile = useGame((s) => s.profile)
  const now = useNow(1000)
  const quests = currentQuests(profile, now)
  const all = quests.every((q) => q.done)
  const resetIn = (questDay(now) + 1) * DAILY_INTERVAL_MS - now

  return (
    <Panel title="DAILY QUESTS" icon="starGold" width={900}>
      <div className="flex flex-col" style={{ gap: u(14) }}>
        {quests.map((quest) => (
          <QuestRow key={quest.id} quest={quest} />
        ))}
        <div
          className="flex flex-wrap items-center justify-between"
          style={{ padding: `${u(10)} ${u(16)}`, gap: `${u(6)} ${u(16)}`, borderRadius: u(8), border: `${u(4)} solid #111`, background: all ? GRADIENTS.rewardCard : 'rgba(255, 196, 31, 0.18)' }}
        >
          <span className="flex items-center" style={{ gap: u(12), fontSize: u(34) }}>
            <RewardIcon icon={rewardIcon(QUEST_BONUS)} size={u(70)} />
            <StrokeText stroke={u(7)}>{all ? `All done! ${rewardText(QUEST_BONUS)} in Items` : `Finish all 3: ${rewardText(QUEST_BONUS)}`}</StrokeText>
          </span>
          <span style={{ fontSize: u(26) }}>
            <StrokeText stroke={u(6)} gradient={GRADIENTS.gold}>
              New quests in {formatClock(resetIn)}
            </StrokeText>
          </span>
        </div>
      </div>
    </Panel>
  )
}

export default QuestsPanel
