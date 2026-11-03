import { openBoxityLeaderboard } from '../../bloxity/services'
import { DAILY_INTERVAL_MS, WEEKLY_REWARDS } from '@shared/balance'
import { formatClock, formatDuration, formatNumber } from '@shared/format'
import { weekOf } from '@shared/logic'

import { BOARD_INFO, boardRows, WEEKLY_INFO } from '../../game/world/boards'
import { useGame } from '../../store/game'
import StrokeText from '../StrokeText'
import { u } from '../hud/style'
import useNow from '../useNow'
import Panel from './Panel'

/** "6d 8h", "5h 12m", "4:59": how long's left, at the precision that matters. */
function formatDaysLeft(ms) {
  const days = Math.floor(ms / DAILY_INTERVAL_MS)
  if (days > 0) return `${days}d ${Math.floor((ms % DAILY_INTERVAL_MS) / 3600000)}h`
  return ms >= 3600000 ? formatDuration(ms) : formatClock(ms)
}

/** When this week's board closes (Monday 00:00 UTC), from `now`. */
const weekEndsIn = (now) => (weekOf(now) + 1) * 7 * DAILY_INTERVAL_MS + 4 * DAILY_INTERVAL_MS - now

/**
 * This week's board: Wins earned since Monday, its top 10, what they win when it closes,
 * and when that is.
 */
function WeeklyBoard({ leaderboards, profile }) {
  const now = useNow(1000)
  const rows = boardRows(leaderboards, profile, 'weekly').slice(0, 10)
  const prize = WEEKLY_REWARDS.map((r, i) => `${i ? `#${WEEKLY_REWARDS[i - 1].upTo + 1}-${r.upTo}` : '#1'}: ${r.amount} Volcano Eggs`).join(' · ')
  return (
    <div style={{ borderRadius: u(8), border: `${u(5)} solid #111`, background: 'linear-gradient(180deg,#3a2a08,#1a1204)', overflow: 'hidden', marginBottom: u(14) }}>
      <div className="flex flex-wrap items-center justify-between" style={{ background: WEEKLY_INFO.color, padding: `${u(6)} ${u(12)}`, gap: u(8) }}>
        <span style={{ fontSize: u(36) }}>
          <StrokeText stroke={u(7)}>{WEEKLY_INFO.title}</StrokeText>
        </span>
        <span style={{ fontSize: u(24) }}>
          <StrokeText stroke={u(5)}>Ends in {formatDaysLeft(weekEndsIn(now))}</StrokeText>
        </span>
      </div>
      <p className="m-0 text-center" style={{ fontSize: u(22), padding: `${u(6)} ${u(8)} 0` }}>
        <StrokeText stroke={u(5)} fill="#ffe08a">
          {prize}
        </StrokeText>
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ padding: u(8), columnGap: u(14) }}>
        {rows.map((row, i) => (
          <div
            key={`${row.name}-${i}`}
            className="flex items-center justify-between"
            style={{ padding: `${u(5)} ${u(8)}`, background: i % 2 ? 'transparent' : 'rgba(255,255,255,0.06)', fontSize: u(26), gap: u(8) }}
          >
            <span className="truncate">
              <StrokeText stroke={u(5)} fill={i === 0 ? '#ffd21f' : '#ffffff'}>
                #{i + 1} {row.name}
              </StrokeText>
            </span>
            <StrokeText stroke={u(5)} fill={WEEKLY_INFO.color}>
              {formatNumber(row.value)}
            </StrokeText>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The four leaderboards, the same data as the boards in the lobby. Inside Boxity each
 * title also opens Boxity's own board for it (all players, all time).
 */
export function LeaderboardsPanel() {
  const leaderboards = useGame((s) => s.leaderboards)
  const profile = useGame((s) => s.profile)
  const online = useGame((s) => s.net.mode === 'online')

  return (
    <Panel title="LEADERBOARDS" width={1100}>
      {!online && (
        <p className="m-0 text-center" style={{ fontSize: u(26), marginBottom: u(10) }}>
          <StrokeText stroke={u(5)} fill="#ffd27a">
            Offline - connect to a server to compete with everyone.
          </StrokeText>
        </p>
      )}
      <WeeklyBoard leaderboards={leaderboards} profile={profile} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4" style={{ gap: u(14) }}>
        {Object.entries(BOARD_INFO).map(([id, info]) => (
          <div key={id} style={{ borderRadius: u(8), border: `${u(5)} solid #111`, background: 'linear-gradient(180deg,#1d2a5c,#101634)', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => openBoxityLeaderboard(id)}
              className="pp-btn pointer-events-auto block w-full text-center"
              style={{ background: info.color, padding: u(8), fontSize: u(36) }}
            >
              <StrokeText stroke={u(7)}>{info.title}</StrokeText>
            </button>
            <div style={{ padding: u(8) }}>
              {boardRows(leaderboards, profile, id)
                .slice(0, 10)
                .map((row, i) => (
                  <div
                    key={`${row.name}-${i}`}
                    className="flex items-center justify-between"
                    style={{ padding: `${u(5)} ${u(8)}`, background: i % 2 ? 'transparent' : 'rgba(255,255,255,0.06)', fontSize: u(26), gap: u(8) }}
                  >
                    <span className="truncate">
                      <StrokeText stroke={u(5)} fill={i === 0 ? '#ffd21f' : '#ffffff'}>
                        #{i + 1} {row.name}
                      </StrokeText>
                    </span>
                    <StrokeText stroke={u(5)} fill={info.color}>
                      {info.format(row.value)}
                    </StrokeText>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

export default LeaderboardsPanel
