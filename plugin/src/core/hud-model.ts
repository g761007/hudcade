// Pure state transitions of the HUD snapshot. Hooks feed events in through
// `update($, hud, fn)`; nothing here touches `$`, so every rule is testable.

import type { AgentRun, BackgroundTask, CacheStats, Cron, CtxSlice, Hud, TaskItem, Teammate, ToolRun } from '../../types'

const DONE_AGENT_TTL_MS = 60_000
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
  return { ...base, ...h, diff: { ...base.diff, ...h?.diff } } as Hud
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
}

// One main-thread model request: the session's prompt-cache totals, the
// turn's tokens, and the request's output speed when its duration is known.
export function addRequestUsage(h: Hud, usage: RequestUsage, streamMs?: number): Hud {
  const prev = h.cache ?? { read: 0, written: 0, uncached: 0, requests: 0 }
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
  }
}

export function completeTurn(h: Hud, durationMs: number, now: number): Hud {
  return {
    ...h,
    turn: { ...h.turn, status: 'idle', startedAt: h.turn.startedAt ?? now - durationMs, endedAt: now, lastDurationMs: durationMs },
    // A main-loop tool still listed when the turn ends was interrupted.
    tools: { ...h.tools, running: h.tools.running.filter(t => t.agentId && isAgentRunning(h, t.agentId)) },
    agents: pruneAgents(h.agents, now),
  }
}

export function setWaiting(h: Hud, isWaiting: boolean): Hud {
  if (h.turn.status === 'idle') return h
  return { ...h, turn: { ...h.turn, status: isWaiting ? 'waiting' : 'working' } }
}

export function startTool(h: Hud, run: ToolRun): Hud {
  let agents = h.agents
  if (run.agentId) {
    agents = ensureAgent(agents, run.agentId, run.startedAt).map(a =>
      a.agentId === run.agentId ? { ...a, tools: a.tools + 1, currentTool: run.tool } : a,
    )
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
    tools: 0,
    status: 'running',
  }
  return { ...h, agents: [...pruneAgents(h.agents, launch.now), run] }
}

// SubagentStart names the loop's id: attach it to the oldest launched agent of
// that type still without one, or list the agent on its own.
export function linkAgent(h: Hud, agentId: string, agentType: string, now: number): Hud {
  if (h.agents.some(a => a.agentId === agentId)) return h
  const index = h.agents.findIndex(a => !a.agentId && a.status === 'running' && a.type === agentType)
  const fallback = index >= 0 ? index : h.agents.findIndex(a => !a.agentId && a.status === 'running')
  if (fallback < 0) return { ...h, agents: ensureAgent(h.agents, agentId, now, agentType) }
  return { ...h, agents: h.agents.map((a, i) => (i === fallback ? { ...a, agentId } : a)) }
}

// The Agent tool's result: a foreground agent is finished; a background one
// only reports its id.
export function agentResult(
  h: Hud,
  toolUseId: string,
  result: { agentId?: string; model?: string; isLaunchOnly: boolean; isError: boolean },
  now: number,
): Hud {
  return {
    ...h,
    agents: h.agents.map(a => {
      if (a.toolUseId !== toolUseId) return a
      const linked = { ...a, agentId: a.agentId ?? result.agentId, model: result.model ?? a.model }
      if (result.isLaunchOnly && !result.isError) return linked
      return { ...linked, status: result.isError ? 'failed' : 'done', endedAt: now, currentTool: undefined }
    }),
  }
}

export function finishAgent(h: Hud, agentId: string, now: number): Hud {
  return {
    ...h,
    agents: h.agents.map(a =>
      a.agentId === agentId && a.status === 'running' ? { ...a, status: 'done', endedAt: now, currentTool: undefined } : a,
    ),
    tools: { ...h.tools, running: h.tools.running.filter(t => t.agentId !== agentId) },
  }
}

export function setAgentModel(h: Hud, agentId: string, model: string): Hud {
  if (!h.agents.some(a => a.agentId === agentId && a.model !== model)) return h
  return { ...h, agents: h.agents.map(a => (a.agentId === agentId ? { ...a, model } : a)) }
}

export function pruneAgents(agents: AgentRun[], now: number): AgentRun[] {
  return agents.filter(a => a.status === 'running' || now - (a.endedAt ?? now) < DONE_AGENT_TTL_MS)
}

function isAgentRunning(h: Hud, agentId: string): boolean {
  return h.agents.some(a => a.agentId === agentId && a.status === 'running')
}

function ensureAgent(agents: AgentRun[], agentId: string, now: number, type = 'agent'): AgentRun[] {
  if (agents.some(a => a.agentId === agentId)) return agents
  return [
    ...agents,
    { key: `ag:${agentId}`, agentId, type, description: '', isBackground: false, startedAt: now, tools: 0, status: 'running' },
  ]
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
