// Builds the Telegram message (HTML parse mode), in English or Traditional
// Chinese: project, branch, time, duration, model, effort, cost, limits,
// context, a summary of the reply and the session id.

import { compactDuration, modelLabel, msUntil, preciseDuration, usd } from './format'

export type NotifyKind = 'done' | 'permission' | 'failure' | 'test'

export type NotifyLanguage = 'en' | 'zh-TW'

export type LanguageChoice = 'auto' | NotifyLanguage

export type NotifyFacts = {
  kind: NotifyKind
  language: NotifyLanguage
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

type Strings = {
  titles: Record<NotifyKind, string>
  project: string
  topic: string
  time: string
  took: string
  error: string
  details: string
  summary: string
  session: string
}

const STRINGS: Record<NotifyLanguage, Strings> = {
  en: {
    titles: {
      done: '✅ Claude Code is done',
      permission: '⚠️ Claude Code needs your approval',
      failure: '❌ Claude Code turn failed',
      test: '🧪 hudcade test notification',
    },
    project: 'Project: ',
    topic: 'Topic: ',
    time: 'Time: ',
    took: 'Took',
    error: 'Error: ',
    details: 'Details: ',
    summary: 'Summary: ',
    session: 'Session: ',
  },
  'zh-TW': {
    titles: {
      done: '✅ Claude Code 完成回覆',
      permission: '⚠️ Claude Code 需要你的確認',
      failure: '❌ Claude Code 回覆失敗',
      test: '🧪 hudcade 測試通知',
    },
    project: '專案：',
    topic: '主題：',
    time: '時間：',
    took: '耗時',
    error: '錯誤：',
    details: '內容：',
    summary: '摘要：',
    session: 'Session：',
  },
}

// `auto` follows Claude Code's own `language` setting: Chinese there means
// Traditional Chinese messages, anything else English.
export function resolveLanguage(choice: LanguageChoice, settingsLanguage: unknown): NotifyLanguage {
  if (choice !== 'auto') return choice
  return typeof settingsLanguage === 'string' && /中文|chinese|^zh/i.test(settingsLanguage.trim()) ? 'zh-TW' : 'en'
}

export function buildMessage(f: NotifyFacts): string {
  const s = STRINGS[f.language]
  const lines = [`<b>${s.titles[f.kind]}</b>`]
  lines.push(`${s.project}<code>${esc(f.project)}</code>${f.branch ? ` (${esc(f.branch)})` : ''}`)
  if (f.sessionTitle) lines.push(`${s.topic}${esc(f.sessionTitle)}`)
  lines.push(`${s.time}${esc(f.time)}`)

  const run = [
    f.durationMs !== undefined ? `${s.took} ${preciseDuration(f.durationMs)}` : undefined,
    modelLabel(f.model),
    f.effort,
    f.costUsd !== undefined ? usd(f.costUsd) : undefined,
  ].filter(Boolean)
  if (run.length > 0) lines.push(esc(run.join(' · ')))

  const stats = statsLine(f)
  if (stats) lines.push(esc(stats))

  if (f.detail) lines.push(`${f.kind === 'failure' ? s.error : s.details}${esc(f.detail)}`)
  if (f.summary) lines.push(`${s.summary}${esc(f.summary)}`)
  if (f.sessionId) lines.push(`${s.session}<code>${esc(f.sessionId.slice(0, 8))}</code>`)
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
