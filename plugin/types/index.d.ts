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
  type: string
  description: string
  model?: string
  isBackground: boolean
  startedAt: number
  endedAt?: number
  tools: number
  currentTool?: string
  status: 'running' | 'done' | 'failed'
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
}

declare module 'claude-code' {
  interface PluginState {
    'hudcade': { hud: Hud }
  }
}
