// Builds the Telegram message (HTML parse mode). Same fields as the old
// notify-telegram.sh, plus duration, model, effort, cost and branch.

import { compactDuration, modelLabel, msUntil, preciseDuration, usd } from './format'

export type NotifyKind = 'done' | 'permission' | 'failure' | 'test'

export type NotifyFacts = {
  kind: NotifyKind
  project: string
  branch?: string
  time: string
  now: number
  durationMs?: number
  model?: string
  effort?: string
  costUsd?: number
  ctxPercent?: number
  rates: readonly { kind: string; percent: number; resetsAt?: string }[]
  summary?: string
  detail?: string
  sessionId?: string
  sessionTitle?: string
}

const TITLES: Record<NotifyKind, string> = {
  done: '✅ Claude Code 完成回覆',
  permission: '⚠️ Claude Code 需要你的確認',
  failure: '❌ Claude Code 回覆失敗',
  test: '🧪 hudcade 測試通知',
}

export function buildMessage(f: NotifyFacts): string {
  const lines = [`<b>${TITLES[f.kind]}</b>`]
  lines.push(`專案：<code>${esc(f.project)}</code>${f.branch ? ` (${esc(f.branch)})` : ''}`)
  if (f.sessionTitle) lines.push(`主題：${esc(f.sessionTitle)}`)
  lines.push(`時間：${esc(f.time)}`)

  const run = [
    f.durationMs !== undefined ? `耗時 ${preciseDuration(f.durationMs)}` : undefined,
    modelLabel(f.model),
    f.effort,
    f.costUsd !== undefined ? usd(f.costUsd) : undefined,
  ].filter(Boolean)
  if (run.length > 0) lines.push(esc(run.join(' · ')))

  const stats = statsLine(f)
  if (stats) lines.push(esc(stats))

  if (f.detail) lines.push(`${f.kind === 'failure' ? '錯誤' : '內容'}：${esc(f.detail)}`)
  if (f.summary) lines.push(`摘要：${esc(f.summary)}`)
  if (f.sessionId) lines.push(`Session：<code>${esc(f.sessionId.slice(0, 8))}</code>`)
  return lines.join('\n')
}

// 5h:13%(2h15m) wk:38%(5d18h) ctx:9%(opus) — the old hook's stats line.
function statsLine(f: NotifyFacts): string {
  const parts: string[] = []
  for (const rate of f.rates) {
    const label = rate.kind === 'five_hour' ? '5h' : rate.kind === 'seven_day' ? 'wk' : rate.kind
    const wait = msUntil(rate.resetsAt, f.now)
    parts.push(`${label}:${Math.round(rate.percent)}%${wait !== undefined ? `(${compactDuration(wait)})` : ''}`)
  }
  if (f.ctxPercent !== undefined) {
    const family = /opus|sonnet|haiku|fable/i.exec(f.model ?? '')?.[0]?.toLowerCase()
    parts.push(`ctx:${Math.round(f.ctxPercent)}%${family ? `(${family})` : ''}`)
  }
  return parts.join(' ')
}

// The reply's gist: no code blocks or markdown marks, one line, ~max chars.
export function summarize(text: string, max = 120): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${space > max - 24 ? cut.slice(0, space) : cut}…`
}

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
