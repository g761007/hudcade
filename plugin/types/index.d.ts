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
}

declare module 'claude-code' {
  interface PluginState {
    'hudcade': { hud: Hud }
  }
}
