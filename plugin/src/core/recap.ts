// The step recap: what a small model is asked about the running turn, and how
// its answer is cleaned into one line for the band.

import { sanitize, toolLabel, truncate } from './format'
import type { NotifyLanguage } from './telegram'

export type RecapStep = { tool: string; detail: string; isError: boolean }

export type RecapFacts = {
  language: NotifyLanguage
  // What the person asked for this turn.
  task: string
  // The turn's main-loop tool calls so far, oldest first.
  steps: readonly RecapStep[]
  // The latest text the agent wrote between its calls.
  note: string
  runningAgents: number
}

export const RECAP_MAX_CHARS = 120
const MAX_STEPS = 12

const LANGUAGE_NAMES: Record<NotifyLanguage, string> = {
  en: 'English',
  'zh-TW': 'Traditional Chinese as used in Taiwan',
}

export function recapRequest(f: RecapFacts): { system: string; prompt: string } {
  const system = [
    'You write the live progress line a developer reads while an AI coding agent works.',
    `Reply with exactly one line in ${LANGUAGE_NAMES[f.language]}, at most 80 characters:`,
    'what the agent is doing right now and what it has found or finished so far.',
    'No preamble, quotes, markdown, or emoji. Do not invent facts the steps do not show.',
  ].join(' ')
  const recent = f.steps.slice(-MAX_STEPS)
  const skipped = f.steps.length - recent.length
  const lines = [
    `Task: ${truncate(sanitize(f.task), 600) || '(none given)'}`,
    `Steps so far (${f.steps.length}${skipped > 0 ? `, the first ${skipped} left out` : ''}):`,
    ...recent.map((step, i) => `${skipped + i + 1}. ${toolLabel(step.tool)}${step.detail ? `: ${truncate(step.detail, 100)}` : ''}${step.isError ? ' (failed)' : ''}`),
  ]
  const note = truncate(sanitize(f.note), 400)
  if (note) lines.push(`The agent's latest note: ${note}`)
  if (f.runningAgents > 0) lines.push(`Subagents running: ${f.runningAgents}`)
  return { system, prompt: lines.join('\n') }
}

// The model's answer as one plain line: no quotes, labels or control characters.
export function cleanRecap(text: string): string {
  const line = sanitize(text.split('\n').find(l => l.trim()) ?? '')
    .replace(/^(?:recap|progress|進度|摘要)\s*[:：]\s*/i, '')
    .replace(/^["'「『“]+|["'」』”]+$/g, '')
    .trim()
  return truncate(line, RECAP_MAX_CHARS)
}
