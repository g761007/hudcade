export type SceneName =
  | 'robot'
  | 'coffee'
  | 'garden'
  | 'rocket'
  | 'cat'
  | 'fishing'
  | 'train'
  | 'campfire'
  | 'weather'
  | 'equalizer'

export type GitInfo = {
  branch: string
  isDirty: boolean
  ahead: number
  behind: number
}

export type RateWindow = {
  kind: string
  percent: number
  resetsAt?: string
}

export type ToolRun = {
  id: string
  tool: string
  detail: string
  startedAt: number
  agentId?: string
}

export type AgentRun = {
  key: string
  toolUseId?: string
  agentId?: string
  // How agentId was attached: `exact` by agent.spawn or the Agent call's own
  // result, `guess` by a classic SubagentStart matching the agent type.
  link?: 'exact' | 'guess'
  // A workflow's agent() or a fork no tool call starts: no roster row or
  // report ends it, so its own turn.complete does.
  isWorkflow?: boolean
  type: string
  description: string
  model?: string
  isBackground: boolean
  startedAt: number
  endedAt?: number
  // Time spent working, over the runs already ended; the run under way began at workingSince.
  workedMs: number
  workingSince?: number
  tools: number
  currentTool?: string
  // From the engine's roster: the share of its window in use, and its last token readings.
  ctxPercent?: number
  samples?: number[]
  status: 'running' | 'done' | 'failed' | 'stopped'
}

export type TaskItem = {
  id?: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type CacheStats = {
  read: number
  written: number
  uncached: number
  requests: number
  lastHitPercent?: number
  isCold?: boolean
  rebuildUsd?: number
  ttl?: '5m' | '1h'
  // When the last main-thread request was sent: the cache lifetime counts from it.
  lastRequestAt?: number
}

export type TurnTokens = { input: number; output: number }

export type BackgroundTask = { id: string; type: string; status: string; description: string }

export type Cron = { id: string; schedule: string; isRecurring: boolean; prompt: string }

export type Teammate = { id: string; name: string; status: string; description: string }

export type CtxSlice = { name: string; tokens: number }

export type DiffStats = { added: number; removed: number; files: string[] }

export type TurnState = {
  count: number
  status: 'idle' | 'working' | 'waiting'
  startedAt?: number
  endedAt?: number
  lastDurationMs?: number
  costAtStart?: number
  // How the last turn ended.
  outcome?: 'answer' | 'aborted' | 'refusal' | 'error'
}

// A one-line account of the running turn, written by a small model as its steps go by.
export type Recap = { text: string; turn: number }

// One unified-diff hunk: where it starts in the old and new file, and its
// lines, each marked ' ' (unchanged), '-' (removed) or '+' (added).
export type DiffHunk = { oldStart: number; newStart: number; lines: string[] }

// One of a call's arguments, as its step shows it.
export type ReplayField = { label: string; value: string }

// One tool call of a turn, as /hud replay shows it. It is noted as the call
// starts and given its outcome when the call ends (`endedAt` absent until then).
export type ReplayStep = {
  callId: string
  tool: string
  detail: string
  // Its arguments, and the start of what it answered (or why it was refused).
  fields?: ReplayField[]
  output?: string
  startedAt: number
  endedAt?: number
  isError: boolean
  // Still running when its turn or its agent ended.
  isUnfinished?: boolean
  // An Agent call's agent, whose own steps are its track in `Replay.agents`.
  agentId?: string
  // The lines an Edit or Write asked to add and remove.
  added?: number
  removed?: number
  // That change, read from the file before the call ran, cut to a few
  // hundred lines; `diffMore` counts the lines left out.
  diff?: DiffHunk[]
  diffMore?: number
}

// A subagent's own steps, by its agent id.
export type ReplayTrack = { type: string; description: string; steps: ReplayStep[] }

// The last turn that called a tool: what /hud replay re-enacts in its scene.
// `endedAt` is absent while the turn runs; a background agent's track keeps
// growing after it.
export type Replay = {
  // The session the turn ran in; a replay from an earlier one is restored from the store.
  sessionId?: string
  turn: number
  task: string
  scene: SceneName
  startedAt: number
  endedAt?: number
  outcome?: TurnState['outcome']
  steps: ReplayStep[]
  agents: Record<string, ReplayTrack>
}

export type Hud = {
  model?: string
  effort?: string
  project: string
  sessionTitle?: string
  git?: GitInfo
  sessionStartedAt?: number
  tzOffsetMinutes?: number
  ctx?: { tokens?: number; window: number; percent?: number }
  costUsd?: number
  rates: RateWindow[]
  turn: TurnState
  tools: { total: number; failed: number; running: ToolRun[] }
  agents: AgentRun[]
  tasks: TaskItem[]
  cache?: CacheStats
  turnTokens?: TurnTokens
  tokensPerSecond?: number
  compactions: number
  diff: DiffStats
  background: BackgroundTask[]
  crons: Cron[]
  teammates: Teammate[]
  ctxTop?: CtxSlice[]
  recap?: Recap
  replay?: Replay
}

declare module 'claude-code' {
  interface PluginState {
    // `draft`: the running turn's replay, kept here so a hot reload mid-turn keeps its steps.
    'hudcade': { hud: Hud; draft: Replay | null }
  }
}
