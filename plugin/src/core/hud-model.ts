// Pure state transitions of the HUD snapshot. Hooks feed events in through
// `update($, hud, fn)`; nothing here touches `$`, so every rule is testable.

import type { AgentRun, BackgroundTask, CacheStats, Cron, CtxSlice, Hud, RateWindow, TaskItem, Teammate, ToolRun, TurnState } from '../../types'
import { msUntil } from './format'

export const DONE_AGENT_TTL_MS = 60_000
const TTL_MS = { '5m': 300_000, '1h': 3_600_000 } as const
// In its last five minutes the cache countdown turns amber, and a toast says so.
export const CACHE_WARN_MS = 300_000
const MAX_AGENT_SAMPLES = 8
const AGENT_LIST_GRACE_MS = 10_000
const MAX_RUNNING_TOOLS = 50

export function emptyHud(project: string): Hud {
  return {
    project,
    rates: [],
    turn: { count: 0, status: 'idle' },
    tools: { total: 0, failed: 0, running: [] },
    agents: [],
    tasks: [],
    compactions: 0,
    diff: { added: 0, removed: 0, files: [] },
    background: [],
    crons: [],
    teammates: [],
  }
}

// A state written by an older version of the mod (the session outlives a
// reload) gets the fields it lacks.
export function withDefaults(h: Partial<Hud> | undefined): Hud {
  const base = emptyHud(h?.project ?? '')
  // An agent row from before work time was kept starts with none, its clock
  // stopped until the agent's next request.
  const agents = (h?.agents ?? []).map(a => ({ ...a, workedMs: a.workedMs ?? 0 }))
  return { ...base, ...h, diff: { ...base.diff, ...h?.diff }, agents } as Hud
}

export type UsageInput = {
  context?: { tokens?: number; window: number; percent?: number }
  rateLimits?: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
  startedAt?: number
}

// A context reading of 0 or none (start of session, mid-compaction) keeps the
// last good one instead of flashing 0%.
export function applyUsage(h: Hud, usage: UsageInput): Hud {
  const next = { ...h }
  if (usage.context) {
    const hasReading = (usage.context.percent ?? 0) > 0 || (usage.context.tokens ?? 0) > 0
    if (hasReading || !h.ctx) next.ctx = { ...usage.context }
    else next.ctx = { ...h.ctx, window: usage.context.window }
  }
  if (usage.rateLimits) {
    next.rates = usage.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt }))
  }
  if (usage.cost) next.costUsd = usage.cost.usd
  if (usage.startedAt !== undefined) next.sessionStartedAt = usage.startedAt
  return next
}

export type RequestUsage = {
  input_tokens: number
  output_tokens?: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  ephemeral_5m_input_tokens?: number
  ephemeral_1h_input_tokens?: number
}

// One main-thread model request: the session's prompt-cache totals, the
// turn's tokens, the request's output speed when its duration is known, and
// the cache lifetime it renewed from `sentAt`: the lifetime its writes named,
// else the one the cache already had (a read renews what was written).
export function addRequestUsage(h: Hud, usage: RequestUsage, streamMs?: number, sentAt?: number): Hud {
  const prev = h.cache ?? { read: 0, written: 0, uncached: 0, requests: 0 }
  const ttl = (usage.ephemeral_1h_input_tokens ?? 0) > 0 ? '1h' : (usage.ephemeral_5m_input_tokens ?? 0) > 0 ? '5m' : prev.ttl
  const read = usage.cache_read_input_tokens
  const total = usage.input_tokens + read + usage.cache_creation_input_tokens
  const output = usage.output_tokens ?? 0
  const turn = h.turnTokens ?? { input: 0, output: 0 }
  const isTimed = streamMs !== undefined && streamMs >= 250 && output > 0
  return {
    ...h,
    cache: {
      ...prev,
      read: prev.read + read,
      written: prev.written + usage.cache_creation_input_tokens,
      uncached: prev.uncached + usage.input_tokens,
      requests: prev.requests + 1,
      lastHitPercent: total > 0 ? (read / total) * 100 : prev.lastHitPercent,
      isCold: false,
      ttl,
      lastRequestAt: sentAt ?? prev.lastRequestAt,
    },
    turnTokens: { input: turn.input + total, output: turn.output + output },
    tokensPerSecond: isTimed ? output / (streamMs / 1000) : h.tokensPerSecond,
  }
}

export function noteCompaction(h: Hud): Hud {
  return { ...h, compactions: h.compactions + 1, ctxTop: undefined }
}

// Lines a successful Edit or Write changed, from its structured patch.
export function patchCounts(result: unknown): { added: number; removed: number } | undefined {
  if (!result || typeof result !== 'object') return undefined
  const r = result as { structuredPatch?: unknown; type?: unknown; content?: unknown }
  let added = 0
  let removed = 0
  if (Array.isArray(r.structuredPatch)) {
    for (const hunk of r.structuredPatch as { lines?: unknown }[]) {
      if (!Array.isArray(hunk.lines)) continue
      for (const line of hunk.lines) {
        if (typeof line !== 'string') continue
        if (line.startsWith('+')) added += 1
        else if (line.startsWith('-')) removed += 1
      }
    }
  }
  // A new file's patch can be empty: count its content.
  if (added === 0 && removed === 0 && r.type === 'create' && typeof r.content === 'string') {
    added = r.content.length === 0 ? 0 : r.content.replace(/\n$/, '').split('\n').length
  }
  return { added, removed }
}

export function addDiff(h: Hud, file: string, counts: { added: number; removed: number }): Hud {
  const files = h.diff.files.includes(file) ? h.diff.files : [...h.diff.files, file]
  return { ...h, diff: { added: h.diff.added + counts.added, removed: h.diff.removed + counts.removed, files } }
}

// What a Stop reports: the session's background tasks and scheduled prompts.
export function setWorkers(h: Hud, background: readonly BackgroundTask[], crons: readonly Cron[]): Hud {
  return { ...h, background: [...background], crons: [...crons] }
}

export function setTeammates(h: Hud, agents: readonly { id: string; teammateId?: string; name?: string; status: string; description: string }[]): Hud {
  const teammates: Teammate[] = agents
    .filter(a => a.teammateId)
    .map(a => ({ id: a.id, name: a.name ?? a.teammateId!.split('@')[0]!, status: a.status, description: a.description }))
  return { ...h, teammates }
}

// The largest parts of the window, from /context's breakdown (used rows only).
export function setCtxTop(h: Hud, categories: readonly { name: string; tokens: number; kind: string }[]): Hud {
  const ctxTop: CtxSlice[] = categories
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 4)
    .map(c => ({ name: c.name, tokens: c.tokens }))
  return { ...h, ctxTop }
}

export function setCacheTtl(h: Hud, ttl: '5m' | '1h'): Hud {
  return { ...h, cache: { ...(h.cache ?? { read: 0, written: 0, uncached: 0, requests: 0 }), ttl } }
}

// How long the prompt cache holds what the last request renewed; undefined
// while no lifetime is known, 0 or less once it has run out.
export function cacheRemainingMs(cache: CacheStats | undefined, now: number): number | undefined {
  if (!cache?.ttl || cache.lastRequestAt === undefined) return undefined
  return cache.lastRequestAt + TTL_MS[cache.ttl] - now
}

const RATE_WINDOW_MS: Record<string, number> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }
// Before this share of a window has gone by, its pace says too little.
const MIN_FORECAST_SHARE = 0.1

// Where a rate-limit window ends up at the pace it has been used since it
// opened: its use at the reset, and how soon it fills if it fills before.
// undefined for a window of unknown length, unused, or too young to judge.
export function rateForecast(rate: RateWindow, now: number): { atResetPercent: number; fullInMs?: number } | undefined {
  const length = RATE_WINDOW_MS[rate.kind]
  const remaining = msUntil(rate.resetsAt, now)
  if (!length || remaining === undefined || rate.percent <= 0 || rate.percent >= 100) return undefined
  const elapsed = length - remaining
  if (elapsed < length * MIN_FORECAST_SHARE) return undefined
  const perMs = rate.percent / elapsed
  const atResetPercent = rate.percent + perMs * remaining
  return { atResetPercent, fullInMs: atResetPercent >= 100 ? (100 - rate.percent) / perMs : undefined }
}

// Share of the session's input tokens served from the prompt cache.
export function cacheHitPercent(cache: CacheStats | undefined): number | undefined {
  if (!cache) return undefined
  const total = cache.read + cache.written + cache.uncached
  return total > 0 ? (cache.read / total) * 100 : undefined
}

// What SessionStart says of a resumed transcript: its context size, and
// whether the prompt cache has outlived its TTL since the last response.
export function applyResume(h: Hud, facts: { contextTokens?: number; isCacheCold?: boolean; rebuildUsd?: number }): Hud {
  const hasReading = (h.ctx?.percent ?? 0) > 0 || (h.ctx?.tokens ?? 0) > 0
  const ctx =
    !hasReading && facts.contextTokens !== undefined
      ? { window: h.ctx?.window ?? 0, tokens: facts.contextTokens }
      : h.ctx
  const cache = facts.isCacheCold
    ? { ...(h.cache ?? { read: 0, written: 0, uncached: 0, requests: 0 }), isCold: true, rebuildUsd: facts.rebuildUsd }
    : h.cache
  return { ...h, ctx, cache }
}

export function startTurn(h: Hud, now: number): Hud {
  return {
    ...h,
    turn: {
      ...h.turn,
      count: h.turn.count + 1,
      status: 'working',
      startedAt: now,
      endedAt: undefined,
      costAtStart: h.costUsd,
    },
    turnTokens: { input: 0, output: 0 },
    agents: pruneAgents(h.agents, now),
    recap: undefined,
  }
}

export function completeTurn(h: Hud, durationMs: number, now: number, outcome?: TurnState['outcome']): Hud {
  return {
    ...h,
    turn: { ...h.turn, status: 'idle', startedAt: h.turn.startedAt ?? now - durationMs, endedAt: now, lastDurationMs: durationMs, outcome },
    // A main-loop tool still listed when the turn ends was interrupted.
    tools: { ...h.tools, running: h.tools.running.filter(t => t.agentId && isAgentRunning(h, t.agentId)) },
    agents: pruneAgents(h.agents, now),
  }
}

export function setWaiting(h: Hud, isWaiting: boolean): Hud {
  if (h.turn.status === 'idle') return h
  return { ...h, turn: { ...h.turn, status: isWaiting ? 'waiting' : 'working' } }
}

// A call in an agent's loop counts on that agent's row. One no row stands for
// (a teammate's, listed as a mate) counts on none.
export function startTool(h: Hud, run: ToolRun): Hud {
  let agents = h.agents
  if (run.agentId) {
    agents = agents.map(a => (a.agentId === run.agentId ? { ...a, tools: a.tools + 1, currentTool: run.tool } : a))
  }
  const running = [...h.tools.running, run].slice(-MAX_RUNNING_TOOLS)
  return {
    ...setWaiting(h, false),
    tools: { ...h.tools, total: h.tools.total + 1, running },
    agents,
  }
}

export function endTool(h: Hud, id: string, isError: boolean): Hud {
  const run = h.tools.running.find(t => t.id === id)
  const running = h.tools.running.filter(t => t.id !== id)
  const agents = run?.agentId
    ? h.agents.map(a => {
        if (a.agentId !== run.agentId) return a
        const still = running.filter(t => t.agentId === a.agentId)
        return { ...a, currentTool: still[still.length - 1]?.tool }
      })
    : h.agents
  return {
    ...h,
    tools: { ...h.tools, failed: h.tools.failed + (isError ? 1 : 0), running },
    agents,
  }
}

export type AgentLaunch = {
  toolUseId: string
  type: string
  description: string
  model?: string
  isBackground: boolean
  now: number
}

export function launchAgent(h: Hud, launch: AgentLaunch): Hud {
  const run: AgentRun = {
    key: `tu:${launch.toolUseId}`,
    toolUseId: launch.toolUseId,
    type: launch.type,
    description: launch.description,
    model: launch.model,
    isBackground: launch.isBackground,
    startedAt: launch.now,
    workedMs: 0,
    workingSince: launch.now,
    tools: 0,
    status: 'running',
  }
  return { ...h, agents: [...pruneAgents(h.agents, launch.now), run] }
}

// SubagentStart names the loop's id but not its Agent call: attach it, as a
// guess, to the oldest launched agent of that type still without one, or
// list the agent on its own. agent.spawn and the call's result correct it.
export function linkAgent(h: Hud, agentId: string, agentType: string, now: number): Hud {
  if (h.agents.some(a => a.agentId === agentId)) return h
  const index = h.agents.findIndex(a => !a.agentId && a.status === 'running' && a.type === agentType)
  if (index < 0) return { ...h, agents: [...h.agents, ownRow({ agentId, type: agentType, now }, 'guess')] }
  return { ...h, agents: h.agents.map((a, i) => (i === index ? { ...a, agentId, link: 'guess' } : a)) }
}

export type AgentSpawn = {
  toolUseId: string
  agentId: string
  type: string
  description?: string
  isBackground?: boolean
  // A workflow's agent() or a fork no tool call starts: no launch row stands for it.
  isWorkflow?: boolean
  // A finished agent taken up again (SendMessage), under the same id.
  isResume?: boolean
  now: number
}

// agent.spawn names the Agent call the loop belongs to: attach its id to that
// launch exactly. A spawn no launch stands for (a workflow's agent, a fork)
// gets a row of its own and never takes another's. Where a SubagentStart
// guessed first, the guess gives way; an exact link stands.
export function spawnAgent(h: Hud, spawn: AgentSpawn): Hud {
  const holder = h.agents.findIndex(a => a.agentId === spawn.agentId)
  if (holder >= 0 && spawn.isResume) {
    return { ...h, agents: h.agents.map((a, i) => (i === holder ? reopen(a, spawn.now) : a)) }
  }
  if (holder >= 0 && h.agents[holder]!.link === 'exact') return h

  const launch =
    spawn.isWorkflow || !spawn.toolUseId ? -1 : h.agents.findIndex(a => a.toolUseId === spawn.toolUseId && !a.agentId)
  if (launch >= 0) return { ...h, agents: claim(h.agents, launch, spawn.agentId) }

  if (holder >= 0) {
    const row = h.agents[holder]!
    if (row.toolUseId !== undefined && row.toolUseId === spawn.toolUseId && !spawn.isWorkflow) {
      return { ...h, agents: h.agents.map((a, i) => (i === holder ? { ...a, link: 'exact' } : a)) }
    }
    // A guess put the id on a row that is not this agent's: free that row and
    // list the agent with what the spawn says of it.
    const freed = row.toolUseId !== undefined ? [{ ...row, agentId: undefined, link: undefined, tools: 0, currentTool: undefined }] : []
    const own = { ...ownRow(spawn, 'exact'), tools: row.tools, currentTool: row.currentTool }
    return { ...h, agents: h.agents.flatMap((a, i) => (i === holder ? [...freed, own] : [a])) }
  }
  return { ...h, agents: [...pruneAgents(h.agents, spawn.now), ownRow(spawn, 'exact')] }
}

// The Agent tool's result: a foreground agent is finished; a background one
// only reports its id. The id is the call's own, whichever row held it.
export function agentResult(
  h: Hud,
  toolUseId: string,
  result: { agentId?: string; model?: string; isLaunchOnly: boolean; isError: boolean },
  now: number,
): Hud {
  const index = h.agents.findIndex(a => a.toolUseId === toolUseId)
  if (index < 0) return h
  const agents = result.agentId && h.agents[index]!.agentId !== result.agentId ? claim(h.agents, index, result.agentId) : h.agents
  return {
    ...h,
    agents: agents.map(a => {
      if (a.toolUseId !== toolUseId) return a
      const linked = { ...a, model: result.model ?? a.model }
      if (result.isLaunchOnly && !result.isError) return linked
      return endRun(linked, result.isError ? 'failed' : 'done', now)
    }),
  }
}

// SubagentStop, or the end of a run nothing else reports.
export function finishAgent(h: Hud, agentId: string, now: number): Hud {
  return {
    ...h,
    agents: h.agents.map(a => (a.agentId === agentId && a.status === 'running' ? endRun(a, 'done', now) : a)),
    tools: { ...h.tools, running: h.tools.running.filter(t => t.agentId !== agentId) },
  }
}

// agent.report says how a run ended, more exactly than the roster or a
// SubagentStop: it ends a running row, and corrects the status of one they
// ended first.
export function reportAgent(h: Hud, agentId: string, report: 'completed' | 'failed' | 'stopped', now: number): Hud {
  const status = report === 'completed' ? 'done' : report
  if (!h.agents.some(a => a.agentId === agentId && a.status !== status)) return h
  return {
    ...h,
    agents: h.agents.map(a => (a.agentId !== agentId ? a : a.status === 'running' ? endRun(a, status, now) : { ...a, status })),
    tools: { ...h.tools, running: h.tools.running.filter(t => t.agentId !== agentId) },
  }
}

// An agent's turn.complete: the run of a workflow's agent ends there; any
// other agent may take on more work, so its clock only stops.
export function agentTurnEnded(h: Hud, agentId: string, now: number): Hud {
  const isWorkflow = h.agents.some(a => a.agentId === agentId && a.isWorkflow)
  return isWorkflow ? finishAgent(h, agentId, now) : pauseAgent(h, agentId, now)
}

// An agent's clock counts the time it works, not how long its row is listed:
// it runs from the launch to the end of the run (`turn.complete`), and again
// from the agent's next request (`turn.step`) when it takes on more work.
export function agentWorkedMs(a: AgentRun, now: number): number {
  return a.workedMs + (a.workingSince === undefined ? 0 : Math.max(0, now - a.workingSince))
}

export function pauseAgent(h: Hud, agentId: string, now: number): Hud {
  return { ...h, agents: h.agents.map(a => (a.agentId === agentId ? stopWork(a, now) : a)) }
}

// An agent's turn.start or first request restarts its clock.
export function resumeAgent(h: Hud, agentId: string, now: number): Hud {
  return {
    ...h,
    agents: h.agents.map(a =>
      a.agentId === agentId && a.status === 'running' && a.workingSince === undefined ? { ...a, workingSince: now } : a,
    ),
  }
}

function stopWork(a: AgentRun, now: number): AgentRun {
  return a.workingSince === undefined ? a : { ...a, workedMs: agentWorkedMs(a, now), workingSince: undefined }
}

function endRun(a: AgentRun, status: AgentRun['status'], now: number): AgentRun {
  return { ...stopWork(a, now), status, endedAt: now, currentTool: undefined }
}

function reopen(a: AgentRun, now: number): AgentRun {
  if (a.status === 'running') return a
  return { ...a, status: 'running', endedAt: undefined, workingSince: now, currentTool: undefined }
}

function ownRow(spawn: Pick<AgentSpawn, 'agentId' | 'type' | 'description' | 'isBackground' | 'isWorkflow' | 'now'>, link: AgentRun['link']): AgentRun {
  return {
    key: `ag:${spawn.agentId}`,
    agentId: spawn.agentId,
    link,
    ...(spawn.isWorkflow ? { isWorkflow: true } : {}),
    type: spawn.type,
    description: spawn.description ?? '',
    isBackground: spawn.isBackground ?? false,
    startedAt: spawn.now,
    workedMs: 0,
    workingSince: spawn.now,
    tools: 0,
    status: 'running',
  }
}

// Gives agentId to the row at `index`, exactly. A row a guess listed on its
// own for that id folds into it; a launch row a guess lent the id gets it back
// free, for its own spawn.
function claim(agents: AgentRun[], index: number, agentId: string): AgentRun[] {
  const other = agents.findIndex((a, i) => i !== index && a.agentId === agentId)
  const moved = other >= 0 ? agents[other]! : undefined
  return agents.flatMap((a, i): AgentRun[] => {
    if (i === index) {
      return [{ ...a, agentId, link: 'exact', tools: a.tools + (moved?.tools ?? 0), currentTool: moved?.currentTool ?? a.currentTool }]
    }
    if (i !== other) return [a]
    return a.toolUseId === undefined ? [] : [{ ...a, agentId: undefined, link: undefined, tools: 0, currentTool: undefined }]
  })
}

export type RosterAgent = {
  id: string
  status: string
  teammateId?: string
  tokenCount?: number
  contextWindowSize?: number
  tokenSamples?: readonly number[]
}

// `$.agent.list()` as the backstop for a SubagentStop that never arrived: a
// running row the roster calls ended is finished. So is one it no longer
// lists, once past the launch grace, but only a row an Agent call launched:
// a workflow's agents are never listed. A row for a teammate (a guess made
// one) goes: the roster lists it as a mate. Rows it lists with token figures
// take their context share and last readings.
export function reconcileAgents(h: Hud, live: readonly RosterAgent[], now: number): Hud {
  const roster = new Map(live.map(a => [a.id, a]))
  const ended = new Set<string>()
  let isChanged = false
  const agents = h.agents.flatMap((a): AgentRun[] => {
    if (!a.agentId) return [a]
    const entry = roster.get(a.agentId)
    if (entry?.teammateId) {
      isChanged = true
      return []
    }
    if (a.status !== 'running') return [a]
    const isDropped = entry === undefined && a.toolUseId !== undefined && now - a.startedAt >= AGENT_LIST_GRACE_MS
    const status = entry?.status
    const end = status === 'completed' || isDropped ? 'done' : status === 'failed' || status === 'killed' ? 'failed' : undefined
    if (end) {
      ended.add(a.agentId)
      isChanged = true
      return [endRun(a, end, now)]
    }
    const figures = rosterFigures(entry)
    if (!figures || (figures.ctxPercent === a.ctxPercent && sameSamples(figures.samples, a.samples))) return [a]
    isChanged = true
    return [{ ...a, ...figures }]
  })
  if (!isChanged) return h
  return {
    ...h,
    agents,
    tools: { ...h.tools, running: h.tools.running.filter(t => !t.agentId || !ended.has(t.agentId)) },
  }
}

function rosterFigures(entry: RosterAgent | undefined): Pick<AgentRun, 'ctxPercent' | 'samples'> | undefined {
  if (!entry || entry.tokenCount === undefined) return undefined
  const window = entry.contextWindowSize ?? 0
  return {
    ctxPercent: window > 0 ? (entry.tokenCount / window) * 100 : undefined,
    samples: entry.tokenSamples ? entry.tokenSamples.slice(-MAX_AGENT_SAMPLES) : undefined,
  }
}

function sameSamples(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

export function setAgentModel(h: Hud, agentId: string, model: string): Hud {
  if (!h.agents.some(a => a.agentId === agentId && a.model !== model)) return h
  return { ...h, agents: h.agents.map(a => (a.agentId === agentId ? { ...a, model } : a)) }
}

// A row still kept (for the agents pane): running, or ended within the last minute.
export function isAgentShown(a: AgentRun, now: number): boolean {
  return a.status === 'running' || now - (a.endedAt ?? now) < DONE_AGENT_TTL_MS
}

export function pruneAgents(agents: AgentRun[], now: number): AgentRun[] {
  return agents.filter(a => isAgentShown(a, now))
}

function isAgentRunning(h: Hud, agentId: string): boolean {
  return h.agents.some(a => a.agentId === agentId && a.status === 'running')
}

// The step recap of the running turn; one for a turn already over is dropped.
export function setRecap(h: Hud, text: string, turn: number): Hud {
  if (turn !== h.turn.count || h.recap?.text === text) return h
  return { ...h, recap: { text, turn } }
}

// TaskCreate adds one; its result carries the id.
export function taskCreated(h: Hud, subject: string, id: string | undefined): Hud {
  return { ...h, tasks: [...h.tasks, { id, subject, status: 'pending' }] }
}

// TaskUpdate names the task by id; tasks created before the id was known are
// matched by their 1-based position, as Claude Code numbers them.
export function taskUpdated(
  h: Hud,
  taskId: string,
  change: { status?: 'pending' | 'in_progress' | 'completed' | 'deleted'; subject?: string },
): Hud {
  let index = h.tasks.findIndex(t => t.id === taskId)
  if (index < 0 && /^\d+$/.test(taskId)) {
    const position = Number(taskId) - 1
    if (position >= 0 && position < h.tasks.length && !h.tasks[position]!.id) index = position
  }
  if (index < 0) return h
  const status = change.status
  if (status === 'deleted') return { ...h, tasks: h.tasks.filter((_, i) => i !== index) }
  const tasks = h.tasks.map((t, i): TaskItem =>
    i === index ? { ...t, id: taskId, subject: change.subject ?? t.subject, status: status ?? t.status } : t,
  )
  return { ...h, tasks }
}

// TodoWrite replaces the whole list.
export function todosWritten(h: Hud, todos: readonly { content: string; status: TaskItem['status'] }[]): Hud {
  return { ...h, tasks: todos.map(t => ({ subject: t.content, status: t.status })) }
}

// porcelain v2 `# branch.*` headers and change lines.
export function parseGitStatus(stdout: string): { branch: string; isDirty: boolean; ahead: number; behind: number } | undefined {
  const records = stdout.split('\0').filter(Boolean)
  let branch: string | undefined
  let oid: string | undefined
  let ahead = 0
  let behind = 0
  let isDirty = false
  for (const record of records) {
    if (record.startsWith('# branch.head ')) branch = record.slice('# branch.head '.length)
    else if (record.startsWith('# branch.oid ')) oid = record.slice('# branch.oid '.length)
    else if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record)
      if (match) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
    } else if (!record.startsWith('#')) isDirty = true
  }
  if (!branch) return undefined
  if (branch === '(detached)') branch = oid && oid !== '(initial)' ? oid.slice(0, 7) : 'detached'
  return { branch, isDirty, ahead, behind }
}
