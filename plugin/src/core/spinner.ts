// The facts line beside the spinner scene: what this turn has done so far.

import type { Hud } from '../../types'
import { tokens, usd } from './format'

export function turnFacts(h: Hud, toolsAtStart: number): string {
  const calls = Math.max(0, h.tools.total - toolsAtStart)
  const parts = [`${calls} tool${calls === 1 ? '' : 's'}`]
  if (h.turnTokens && h.turnTokens.output > 0) parts.push(`↓${tokens(h.turnTokens.output)}`)
  if (h.tokensPerSecond !== undefined) parts.push(`${Math.round(h.tokensPerSecond)} tok/s`)
  const spent = h.costUsd !== undefined && h.turn.costAtStart !== undefined ? h.costUsd - h.turn.costAtStart : 0
  if (spent >= 0.005) parts.push(`+${usd(spent)}`)
  return parts.join(' · ')
}
