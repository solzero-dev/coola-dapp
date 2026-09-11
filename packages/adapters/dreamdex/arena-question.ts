import type { GameQuestion } from './game-creation'

export function questionFromArena(raw: any, agents: any, eventId: string, agentId: string, gameOrigin: string, now = Date.now()): GameQuestion {
  const match = raw.match, policy = raw.policy
  const actualEventId = match?.matchId ? `arena-${match.matchId.slice(2)}` : `arena-${match?.roomId}`
  if (!raw.ok || eventId !== actualEventId || !['reserved', 'live'].includes(match.status) || policy?.participants !== 12 || policy.matchDurationMs !== 1_200_000) throw Error('Select the current twelve-agent arena match.')
  const participant = match.participants?.find((p: any) => p.agentId === agentId)
  const agent = agents.agents?.find((a: any) => a.agentId === agentId)
  if (!agents.ok || !participant || !agent || match.participants.length !== 12 || new Set(match.participants.map((p: any) => p.agentId)).size !== 12) throw Error('The selected agent is not in this match roster.')
  const start = Date.parse(match.scheduledStartAt)
  if (!Number.isFinite(start)) throw Error('The game has no authoritative start time.')
  const tradingLocksAt = Math.floor((start + policy.matchDurationMs - 120_000) / 1000) * 1000
  if (tradingLocksAt <= now + 60_000) throw Error('This match is too close to its finish. Open the next match question instead.')
  return { eventId, roomId: match.roomId, agentId, subjectId: participant.actorId, label: `Will ${agent.codename} win?`, sourceUrl: new URL(`/api/v1/agent-arena/matches/${encodeURIComponent(match.roomId)}/logs`, gameOrigin).toString(), tradingStartsAt: Math.floor(now / 1000) * 1000, tradingLocksAt, resolutionAt: Math.floor((start + policy.matchDurationMs + 180_000) / 1000) * 1000 }
}
