import { formatDuration, formatNumber } from '@shared/format'
import { LAST_STAGE } from '@shared/balance'
import { overallStage, weekWins } from '@shared/logic'

/** The four leaderboards, as in the reference: titles, colours and value formatting. */
export const BOARD_INFO = {
  rebirths: { title: 'Top Rebirths', color: '#c45cff', format: (v) => formatNumber(v) },
  wins: { title: 'Top Wins', color: '#3fdc4a', format: (v) => formatNumber(v) },
  stage: { title: 'Best Stage', color: '#2fb6ff', format: (v) => (v > LAST_STAGE ? `W2 Stage ${v - LAST_STAGE}` : `Stage ${v}`) },
  playtime: { title: 'Top Playtime', color: '#4fc3ff', format: (v) => formatDuration(v * 1000) },
}

/** The weekly board (the Leaderboards panel only; the lobby has the four above). */
export const WEEKLY_INFO = { title: 'This Week: Most Wins', color: '#ffc21f', format: (v) => formatNumber(v) }

/** Your own value on each board, for offline play. */
const OWN_VALUE = {
  weekly: (p) => weekWins(p, Date.now()),
  rebirths: (p) => p.rebirths,
  wins: (p) => p.stats.totalWins,
  stage: (p) => overallStage(p.stats),
  playtime: (p) => p.stats.playtime,
}


/** Rows for a board: the server's top 10, or just you when offline. */
export function boardRows(leaderboards, profile, id) {
  if (leaderboards?.[id]?.length) return leaderboards[id]
  return [{ name: profile.name, value: OWN_VALUE[id](profile) }]
}
