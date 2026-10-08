// Lays the HUD snapshot out as rows of styled segments that fit a width.
// Pure: the mod maps each row to a left and a right group of <Text>.
//
//   identity   ◆ model · effort   project ⎇ branch   +added −removed · files      cost +turn · ◷ time
//   capacity   ctx bar % · left · ⟲compactions                cache % │ 5h bar % reset │ 7d bar % reset
//   activity   ● status clock · turn n   since start / start–end   ◑ tool    ↑in ↓out · tok/s │ tasks d/n ▸ active
//   (context)  ↳ the largest parts of the window, once context passes the warning threshold
//   workers    agent / mate / bg / loop rows, while there are any

import type { AgentRun, Hud } from '../../types'
import {
  bar,
  clock,
  wallClock,
  compactDuration,
  modelLabel,
  msUntil,
  rateLabel,
  tokens,
  toolLabel,
  truncate,
  usd,
} from './format'
import { cacheHitPercent, withDefaults } from './hud-model'

export type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type Row = { left: Seg[]; right: Seg[] }

export type BandOptions = { warnPercent: number; criticalPercent: number }

// Lower numbers are dropped last when a row is too wide.
type Group = { priority: number; side: 'left' | 'right'; segs: Seg[] }

const LEFT_GAP: Seg = { text: '   ' }
const RIGHT_SEP: Seg = { text: ' │ ', dim: true }
const MIN_GAP = 2
const SPIN = ['◐', '◓', '◑', '◒']
const MAX_WORKER_ROWS = 4

export function buildBand(raw: Hud, now: number, columns: number, options: BandOptions): Row[] {
  const h = withDefaults(raw)
  const rows = [identityRow(h, now), capacityRow(h, now, options), activityRow(h, now)].map(groups => fit(groups, columns))
  const percent = ctxPercent(h)
  if (percent !== undefined && percent >= options.warnPercent && h.ctxTop?.length) {
    rows.push(fit([contextGroup(h)], columns))
  }
  for (const row of workerRows(h, now)) rows.push(fit([{ priority: 0, side: 'left', segs: row }], columns))
  return rows.filter(row => row.left.length + row.right.length > 0)
}

export function rowText(row: Row): string {
  return [...row.left, ...row.right].map(s => s.text).join('')
}

// ── Rows ────────────────────────────────────────────────────────────────────

function identityRow(h: Hud, now: number): Group[] {
  const groups: Group[] = []
  const model = modelLabel(h.model) ?? 'Claude'
  groups.push({
    priority: 0,
    side: 'left',
    segs: [{ text: `◆ ${model}`, color: 'claude', bold: true }, ...(h.effort ? [{ text: ` · ${h.effort}`, dim: true }] : [])],
  })

  if (h.project) {
    const place: Seg[] = [{ text: h.project, color: 'suggestion' }]
    if (h.git) {
      const marks = `${h.git.isDirty ? '*' : ''}${h.git.ahead ? ` ↑${h.git.ahead}` : ''}${h.git.behind ? ` ↓${h.git.behind}` : ''}`
      place.push({ text: ` ⎇ ${h.git.branch}${marks}`, color: h.git.isDirty ? 'warning' : 'success' })
    }
    groups.push({ priority: 2, side: 'left', segs: place })
  }

  if (h.diff.files.length > 0) {
    groups.push({
      priority: 4,
      side: 'left',
      segs: [
        { text: `+${h.diff.added}`, color: 'success' },
        { text: ` −${h.diff.removed}`, color: 'error' },
        { text: ` · ${h.diff.files.length} file${h.diff.files.length > 1 ? 's' : ''}`, dim: true },
      ],
    })
  }

  const money: Seg[] = []
  if (h.costUsd !== undefined) {
    money.push({ text: usd(h.costUsd), bold: true })
    const delta = h.turn.status !== 'idle' && h.turn.costAtStart !== undefined ? h.costUsd - h.turn.costAtStart : 0
    if (delta >= 0.005) money.push({ text: ` +${usd(delta).slice(1)}`, dim: true })
  }
  if (h.sessionStartedAt !== undefined) {
    money.push({ text: `${money.length ? ' · ' : ''}◷ ${compactDuration(now - h.sessionStartedAt)}`, dim: true })
  }
  if (money.length) groups.push({ priority: 1, side: 'right', segs: money })
  return groups
}

function capacityRow(h: Hud, now: number, options: BandOptions): Group[] {
  const groups: Group[] = []
  const percent = ctxPercent(h)
  const compacted: Seg[] = h.compactions > 0 ? [{ text: ` · ⟲${h.compactions}`, dim: true }] : []
  if (percent === undefined) {
    // No response of this session has reported a fill yet (a new or just resumed session).
    const window = h.ctx?.window ? ` · ${tokens(h.ctx.window)} window` : ''
    groups.push({
      priority: 0,
      side: 'left',
      segs: [{ text: `ctx ${bar(0, 12)} —${window} · waiting for first reply`, dim: true }, ...compacted],
    })
  } else {
    const color = percent >= options.criticalPercent ? 'error' : percent >= options.warnPercent ? 'warning' : 'success'
    const left = h.ctx?.tokens !== undefined && h.ctx.window > 0 ? ` · ${tokens(Math.max(0, h.ctx.window - h.ctx.tokens))} left` : ''
    groups.push({
      priority: 0,
      side: 'left',
      segs: [
        { text: 'ctx ', dim: true },
        { text: bar(percent, 12), color },
        { text: ` ${Math.round(percent)}%`, color, bold: percent >= options.criticalPercent },
        { text: left, dim: true },
        ...compacted,
      ],
    })
  }

  const cache = cacheGroup(h)
  if (cache) groups.push(cache)

  h.rates.forEach((rate, i) => {
    const color = rate.percent >= 90 ? 'error' : rate.percent >= 75 ? 'warning' : 'success'
    const wait = msUntil(rate.resetsAt, now)
    groups.push({
      priority: 1 + i,
      side: 'right',
      segs: [
        { text: `${rateLabel(rate.kind)} `, dim: true },
        { text: bar(rate.percent, 4), color },
        { text: ` ${Math.round(rate.percent)}%`, color: rate.percent >= 75 ? color : undefined },
        ...(wait !== undefined ? [{ text: ` ${compactDuration(wait)}`, dim: true }] : []),
      ],
    })
  })
  return groups
}

function cacheGroup(h: Hud): Group | undefined {
  const hit = cacheHitPercent(h.cache)
  if (h.cache?.isCold) {
    const cost = h.cache.rebuildUsd ? ` ~${usd(h.cache.rebuildUsd)}` : ''
    return { priority: 4, side: 'right', segs: [{ text: `cache cold${cost}`, color: 'warning' }] }
  }
  if (hit === undefined) return undefined
  const last = h.cache?.lastHitPercent
  const isMiss = last !== undefined && last < 50 && (h.cache?.requests ?? 0) > 1
  return {
    priority: 4,
    side: 'right',
    segs: [
      { text: 'cache ', dim: true },
      { text: `${Math.round(hit)}%`, color: hit >= 70 ? 'success' : hit < 40 ? 'warning' : undefined },
      ...(isMiss ? [{ text: ` last ${Math.round(last)}%`, color: 'warning' }] : []),
    ],
  }
}

function activityRow(h: Hud, now: number): Group[] {
  const groups: Group[] = []
  const { turn } = h
  const at = (ms: number) => wallClock(ms, h.tzOffsetMinutes)
  if (turn.status === 'idle') {
    groups.push({ priority: 0, side: 'left', segs: [{ text: `○ idle · turn ${turn.count}`, dim: true }] })
    if (turn.startedAt !== undefined && turn.endedAt !== undefined) {
      const took = turn.lastDurationMs !== undefined ? ` (${clock(turn.lastDurationMs)})` : ''
      groups.push({ priority: 2, side: 'left', segs: [{ text: `${at(turn.startedAt)}–${at(turn.endedAt)}${took}`, dim: true }] })
    }
  } else {
    const elapsed = turn.startedAt !== undefined ? ` ${clock(now - turn.startedAt)}` : ''
    const status: Seg =
      turn.status === 'waiting'
        ? { text: `⚠ waiting for you${elapsed}`, color: 'warning', bold: true }
        : { text: `● working${elapsed}`, color: 'claude', bold: true }
    groups.push({ priority: 0, side: 'left', segs: [status, { text: ` · turn ${turn.count}`, dim: true }] })
    if (turn.startedAt !== undefined) {
      groups.push({ priority: 2, side: 'left', segs: [{ text: `since ${at(turn.startedAt)}`, dim: true }] })
    }
  }

  const main = h.tools.running.filter(t => !t.agentId)
  const current = main[main.length - 1]
  if (current && turn.status !== 'idle') {
    groups.push({
      priority: 1,
      side: 'left',
      segs: [
        { text: `${spin(now)} ${toolLabel(current.tool)}`, color: 'suggestion' },
        { text: ` ${clock(now - current.startedAt)}`, dim: true },
        ...(current.detail ? [{ text: ` ${truncate(current.detail, 40)}` }] : []),
      ],
    })
  }

  const io: Seg[] = []
  if (h.turnTokens && h.turnTokens.input + h.turnTokens.output > 0) {
    io.push({ text: `↑${tokens(h.turnTokens.input)} ↓${tokens(h.turnTokens.output)}`, dim: true })
  }
  if (h.tokensPerSecond !== undefined) io.push({ text: `${io.length ? ' · ' : ''}${Math.round(h.tokensPerSecond)} tok/s`, dim: true })
  if (h.tools.total > 0) {
    io.push({ text: `${io.length ? ' · ' : ''}tools ${h.tools.total}`, dim: true })
    if (h.tools.failed > 0) io.push({ text: ` ✗${h.tools.failed}`, color: 'error' })
  }
  if (io.length) groups.push({ priority: 3, side: 'right', segs: io })

  if (h.tasks.length > 0) {
    const done = h.tasks.filter(t => t.status === 'completed').length
    const active = h.tasks.find(t => t.status === 'in_progress')
    groups.push({
      priority: 2,
      side: 'right',
      segs: [
        { text: `tasks ${done}/${h.tasks.length}`, color: done === h.tasks.length ? 'success' : undefined },
        ...(active ? [{ text: ` ▸ ${truncate(active.subject, 28)}`, dim: true }] : []),
      ],
    })
  }
  return groups
}

function contextGroup(h: Hud): Group {
  const total = h.ctx?.tokens ?? h.ctxTop!.reduce((sum, c) => sum + c.tokens, 0)
  const parts = h.ctxTop!.map(c => `${c.name.toLowerCase()} ${Math.round((c.tokens / Math.max(1, total)) * 100)}%`)
  return { priority: 0, side: 'left', segs: [{ text: '  ↳ ', dim: true }, { text: parts.join(' · '), dim: true }] }
}

// ── Workers ─────────────────────────────────────────────────────────────────

function workerRows(h: Hud, now: number): Seg[][] {
  const rows: Seg[][] = []
  const agents = [...h.agents].sort((a, b) => rankAgent(a) - rankAgent(b) || a.startedAt - b.startedAt)
  for (const agent of agents) rows.push(agentRow(agent, now))
  for (const mate of h.teammates) {
    const isBusy = mate.status === 'running' || mate.status === 'pending'
    rows.push([
      tag('mate'),
      { text: `◇ ${mate.name}`, color: isBusy ? 'suggestion' : undefined, bold: isBusy },
      { text: ` · ${mate.status}`, dim: !isBusy },
      ...(mate.description ? [{ text: ` · ${mate.description}`, dim: true }] : []),
    ])
  }
  for (const task of h.background) {
    rows.push([
      tag('bg'),
      { text: `» ${task.description || task.type}`, color: task.status === 'running' ? 'suggestion' : undefined },
      { text: ` · ${task.status}`, dim: true },
    ])
  }
  for (const cron of h.crons) {
    rows.push([
      tag('loop'),
      { text: `↻ ${cron.schedule}`, color: 'suggestion' },
      { text: `${cron.isRecurring ? '' : ' · once'} · ${truncate(cron.prompt.replace(/\s+/g, ' '), 60)}`, dim: true },
    ])
  }
  if (rows.length <= MAX_WORKER_ROWS) return rows
  return [...rows.slice(0, MAX_WORKER_ROWS - 1), [{ text: `  +${rows.length - MAX_WORKER_ROWS + 1} more`, dim: true }]]
}

function rankAgent(a: AgentRun): number {
  return a.status === 'running' ? 0 : 1
}

function agentRow(a: AgentRun, now: number): Seg[] {
  const isRunning = a.status === 'running'
  const glyph = isRunning ? spin(now) : a.status === 'done' ? '✓' : '✗'
  const color = isRunning ? 'suggestion' : a.status === 'done' ? 'success' : 'error'
  const model = modelLabel(a.model)
  return [
    tag('agent'),
    { text: `${glyph} `, color },
    { text: a.type, color, bold: isRunning },
    ...(model ? [{ text: ` · ${model}`, dim: true }] : []),
    ...(a.isBackground ? [{ text: ' · bg', dim: true }] : []),
    { text: ` · ${clock((a.endedAt ?? now) - a.startedAt)} · ${a.tools} tools`, dim: true },
    ...(a.currentTool ? [{ text: ` ▸ ${toolLabel(a.currentTool)}`, color: 'suggestion' }] : []),
    ...(a.description ? [{ text: ` · ${a.description}`, dim: !isRunning }] : []),
  ]
}

function tag(name: string): Seg {
  return { text: `  ${name.padEnd(6)}`, dim: true }
}

function spin(now: number): string {
  return SPIN[Math.floor(now / 1000) % SPIN.length]!
}

// ── Fitting ─────────────────────────────────────────────────────────────────

// Drops the lowest-priority groups until left, gap and right fit, then cuts
// the left side's tail.
function fit(groups: Group[], columns: number): Row {
  const kept = [...groups]
  const widthOf = () => {
    const left = width(joinSide(kept, 'left'))
    const right = width(joinSide(kept, 'right'))
    return left + right + (left > 0 && right > 0 ? MIN_GAP : 0)
  }
  while (kept.length > 1 && widthOf() > columns) {
    let drop = 0
    for (let i = 1; i < kept.length; i++) if (kept[i]!.priority >= kept[drop]!.priority) drop = i
    kept.splice(drop, 1)
  }
  const right = joinSide(kept, 'right')
  const rightWidth = width(right)
  const room = columns - (rightWidth > 0 ? rightWidth + MIN_GAP : 0)
  return { left: fitSegs(joinSide(kept, 'left'), Math.max(0, room)), right: rightWidth > columns ? fitSegs(right, columns) : right }
}

function joinSide(groups: Group[], side: 'left' | 'right'): Seg[] {
  const out: Seg[] = []
  for (const g of groups.filter(g => g.side === side)) {
    if (out.length > 0) out.push(side === 'left' ? LEFT_GAP : RIGHT_SEP)
    out.push(...g.segs)
  }
  return out
}

function fitSegs(segs: Seg[], columns: number): Seg[] {
  const out: Seg[] = []
  let used = 0
  for (const seg of segs) {
    const w = displayWidth(seg.text)
    if (used + w <= columns) {
      out.push(seg)
      used += w
      continue
    }
    const room = columns - used
    if (room > 1) out.push({ ...seg, text: cutToWidth(seg.text, room - 1) + '…' })
    break
  }
  return out
}

function width(segs: Seg[]): number {
  return segs.reduce((sum, seg) => sum + displayWidth(seg.text), 0)
}

// Context fill: the engine's percent, else tokens over a known window.
function ctxPercent(h: Hud): number | undefined {
  if (!h.ctx) return undefined
  if (h.ctx.percent !== undefined && h.ctx.percent > 0) return h.ctx.percent
  if (h.ctx.tokens !== undefined && h.ctx.window > 0) return (h.ctx.tokens / h.ctx.window) * 100
  return h.ctx.percent
}

// Terminal columns: East Asian wide characters and most emoji take two.
export function displayWidth(text: string): number {
  let w = 0
  for (const ch of text) w += isWide(ch.codePointAt(0)!) ? 2 : 1
  return w
}

export function cutToWidth(text: string, max: number): string {
  let w = 0
  let out = ''
  for (const ch of text) {
    const cw = isWide(ch.codePointAt(0)!) ? 2 : 1
    if (w + cw > max) break
    out += ch
    w += cw
  }
  return out
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
}

// The compact line pinned under the prompt: model · effort │ ctx │ cost │ 5h │ 7d.
export function statusLine(raw: Hud): string {
  const h = withDefaults(raw)
  const model = modelLabel(h.model) ?? 'Claude'
  const parts = [h.effort ? `${model} · ${h.effort}` : model]
  const percent = ctxPercent(h)
  parts.push(percent !== undefined ? `ctx ${Math.round(percent)}%` : 'ctx —')
  if (h.costUsd !== undefined) parts.push(usd(h.costUsd))
  for (const [kind, label] of [['five_hour', '5h'], ['seven_day', '7d']] as const) {
    const rate = h.rates.find(r => r.kind === kind)
    if (rate) parts.push(`${label} ${Math.round(rate.percent)}%`)
  }
  return parts.join(' │ ')
}
