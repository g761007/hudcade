// hudcade: a HUD band with session and agent progress, a status line, a
// pixel-scene spinner (terminal), and Telegram notifications.
//
// The engine admits one hook per event in a module and follows `$` only into
// functions of the same file, so every hook lives here and dispatches to the
// enabled features; the rules themselves are pure functions in src/core.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Hud, SceneName } from '../types'
import { agentSummary, buildBand, paneRows, statusLine, type Seg } from '../src/core/band'
import { createRuntime, parseEnvFile, resolveConfig, type Layer, type Runtime } from '../src/core/config'
import { basename, clock, modelLabel, parseTzOffset, tokens, toolDetail, toolLabel, truncate, usd } from '../src/core/format'
import { cleanRecap, recapRequest, type RecapStep } from '../src/core/recap'
import { SCENE_ROWS, SCENES, modeLabel, modeOf, pickScene, renderScene, type SpinnerMode } from '../src/core/scenes'
import { turnFacts } from '../src/core/spinner'
import {
  addDiff,
  addRequestUsage,
  agentResult,
  agentTurnEnded,
  applyResume,
  applyUsage,
  cacheRemainingMs,
  completeTurn,
  emptyHud,
  endTool,
  finishAgent,
  isAgentShown,
  launchAgent,
  linkAgent,
  noteCompaction,
  parseGitStatus,
  patchCounts,
  reconcileAgents,
  reportAgent,
  resumeAgent,
  setCacheTtl,
  setCtxTop,
  setAgentModel,
  setRecap,
  setTeammates,
  setWaiting,
  setWorkers,
  spawnAgent,
  startTool,
  startTurn,
  taskCreated,
  taskUpdated,
  todosWritten,
  withDefaults,
  type UsageInput,
} from '../src/core/hud-model'
import { buildMessage, resolveLanguage, summarize, type NotifyKind, type NotifyLanguage } from '../src/core/telegram'

// The one session value the drawings read: a write redraws the band and the spinner.
const hudAtom = atom({ plugin: 'hudcade', key: 'hud' } as const, emptyHud(''))

const PROJECT_FILES = ['claude-mods.json', 'claude-mods.local.json'] as const
const GIT_THROTTLE_MS = 3_000
const GIT_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit'])
const AGENT_SYNC_MS = 15_000
const FRAME_MS = 80
const SPINNER_TEXT_COLUMNS = 36
const AGENTS_PANE = 'hudcade-agents'
// While idle, the band redraws this often for the cache countdown and the
// agent rows that are about to go.
const IDLE_REDRAW_MS = 15_000
// An ask the mode gives to no classifier within this time is the person's.
const ASK_SETTLE_MS = 1_500
// A permission or failure notice that both a native and a classic event
// raised is sent once.
const NOTIFY_DEDUPE_MS = 15_000
const COMPACTION_DEDUPE_MS = 30_000
const RECAP_MIN_INTERVAL_MS = 10_000

type NotifyExtra = { durationMs?: number; summary?: string; detail?: string }

// Every write and read sees a complete state, even one an older version of
// the mod left in this session.
function patch($: EngineInterface, change: (h: Hud) => Hud): Promise<Hud> {
  return update($, hudAtom, h => change(withDefaults(h)))
}

async function snapshot($: EngineInterface): Promise<Hud> {
  return withDefaults(await read($, hudAtom))
}

// Module-local working state (starts over on a hot reload); the values the
// drawings read live in hudAtom.
let runtime: Runtime = createRuntime({})
let values: Record<string, unknown> = {}
let lastGitAt = 0
let lastAgentSyncAt = 0
let gitNote = 'not read yet'
let lastStatus: string | undefined
let ticker: Timer | undefined
let warned: 'none' | 'warn' | 'critical' = 'none'
let frameTimer: Timer | undefined
let isTicking = false
let turnStartedAt = 0
let toolsAtStart = 0
let scene: SceneName = 'robot'
let lastScene: SceneName | undefined
let spinnerMode: SpinnerMode | undefined
const spinners = new Map<string, number>() // mounted spinner requestId → scene columns
let idleTimer: Timer | undefined
let settingsLanguage: unknown
// Main-loop calls the mode put to a person: settled at tool.run or the call's end.
const pendingAsks = new Map<string, { detail: string; isAsked: boolean; timer?: Timer }>()
const lastNotifyAt: Partial<Record<NotifyKind, number>> = {}
let lastCompactionAt = Number.NEGATIVE_INFINITY
// The running turn's step recap.
let recapTask = ''
let recapNote = ''
let recapSteps: RecapStep[] = []
let recapTimer: Timer | undefined
let isRecapping = false
let isRecapDirty = false
let lastRecapAt = Number.NEGATIVE_INFINITY

// ── Configuration ─────────────────────────────────────────────────────────

// Project overrides and the legacy Telegram env file are read through `$`,
// so the configuration is completed when the session starts.
async function loadRuntime($: EngineInterface): Promise<void> {
  const root = await $.session.root()
  const layers: Layer[] = []
  const readWarnings: string[] = []

  for (const name of PROJECT_FILES) {
    const path = `${root}/.claude/${name}`
    if (!(await $.fs.exists(path))) continue
    try {
      const parsed: unknown = JSON.parse(await $.fs.read(path))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        layers.push({ source: `.claude/${name}`, values: parsed as Record<string, unknown> })
      } else {
        readWarnings.push(`.claude/${name}: expected a JSON object`)
      }
    } catch (error) {
      readWarnings.push(`.claude/${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const { config, warnings } = resolveConfig(values, layers)
  runtime.config = config
  runtime.warnings = [...readWarnings, ...warnings]
  runtime.sources = ['userConfig', ...layers.map(layer => layer.source)]
  runtime.telegramSource = config.telegramBotToken && config.telegramChatId ? 'userConfig' : undefined

  if (!runtime.telegramSource) {
    const home = await $.env.get('HOME')
    const path = `${home}/.claude/hooks/.telegram.env`
    if (home && (await $.fs.exists(path))) {
      const env = parseEnvFile(await $.fs.read(path))
      config.telegramBotToken ||= env.TELEGRAM_BOT_TOKEN
      config.telegramChatId ||= env.TELEGRAM_CHAT_ID
      if (config.telegramBotToken && config.telegramChatId) runtime.telegramSource = '~/.claude/hooks/.telegram.env'
    }
  }
}

// ── HUD tracking ──────────────────────────────────────────────────────────

async function refreshGit($: EngineInterface, force = false): Promise<void> {
  const now = await $.clock.now()
  if (!force && now - lastGitAt < GIT_THROTTLE_MS) return
  lastGitAt = now
  try {
    const { exitCode, stdout } = await $.process.run(
      ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z'],
      { timeoutMs: 2_000 },
    )
    const git = exitCode === 0 ? parseGitStatus(stdout) : undefined
    gitNote = git ? 'ok' : `exit ${exitCode}`
    await patch($, h => ({ ...h, git }))
  } catch (error) {
    // Not a repository, or no git: the band shows no branch.
    gitNote = error instanceof Error ? error.message : String(error)
  }
}

async function applyMeasure($: EngineInterface, usage: UsageInput): Promise<void> {
  await patch($, h => applyUsage(h, usage))
  const percent = usage.context?.percent
  if (percent === undefined || percent <= 0 || !runtime.config.hud) return
  const { ctxWarnPercent, ctxCriticalPercent } = runtime.config
  if (percent >= ctxCriticalPercent && warned !== 'critical') {
    warned = 'critical'
    $.ui.toast(`Context ${Math.round(percent)}% — consider /compact soon`, { timeoutMs: 8_000 })
  } else if (percent >= ctxWarnPercent && warned === 'none') {
    warned = 'warn'
    $.ui.toast(`Context ${Math.round(percent)}% used`)
  } else if (percent < ctxWarnPercent) {
    warned = 'none'
  }
}

// The engine's roster: teammate rows, and agent rows it has ended though no
// SubagentStop arrived. The ticker reads it once per AGENT_SYNC_MS at most.
async function refreshAgents($: EngineInterface, isThrottled = false): Promise<void> {
  try {
    const now = await $.clock.now()
    if (isThrottled && now - lastAgentSyncAt < AGENT_SYNC_MS) return
    lastAgentSyncAt = now
    const agents = await $.agent.list()
    const h = await patch($, h => reconcileAgents(setTeammates(h, agents), agents, now))
    syncTicker($, h.turn.status !== 'idle' || h.agents.some(a => a.status === 'running'))
    void syncIdleRedraw($)
  } catch {
    // Agent teams off, or the roster unavailable: no teammate rows, and agent
    // rows wait for SubagentStop.
  }
}

// The window's largest parts, worth showing once context passes the warning threshold.
async function refreshContextBreakdown($: EngineInterface): Promise<void> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const categories = usage.context.breakdown?.categories
    if (categories) await patch($, h => setCtxTop(h, categories))
  } catch {
    // The band shows no breakdown row.
  }
}

// Pins the compact line under the prompt; only a changed text is sent.
async function syncStatus($: EngineInterface): Promise<void> {
  if (!runtime.config.statusLine) {
    if (lastStatus !== undefined) $.ui.status(undefined)
    lastStatus = undefined
    return
  }
  const text = statusLine(await snapshot($))
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

// Redraws once a second while something runs, for the elapsed clocks, and
// rechecks the agent roster now and then.
function syncTicker($: EngineInterface, isBusy: boolean): void {
  const wantsTicks = isBusy && (runtime.config.hud || runtime.config.spinner)
  if (wantsTicks && !ticker) {
    ticker = $.clock.every(1_000, () => {
      $.ui.invalidate('ui.render')
      void refreshAgents($, true)
    })
  } else if (!wantsTicks && ticker) {
    ticker.cancel()
    ticker = undefined
  }
}

// ── Spinner frames ────────────────────────────────────────────────────────

function stopFrames(): void {
  frameTimer?.cancel()
  frameTimer = undefined
  spinners.clear()
}

async function paintFrame($: EngineInterface): Promise<void> {
  if (isTicking || spinners.size === 0) return
  isTicking = true
  try {
    const t = (await $.clock.now()) - turnStartedAt
    for (const [requestId, columns] of spinners) {
      const cells = renderScene(scene, modeOf(spinnerMode), t, columns)
      const painted = await $.ui.blit({ requestId, key: 'scene', cells, columns, rows: SCENE_ROWS })
      if ('deny' in painted && painted.deny) spinners.delete(requestId)
    }
  } catch {
    // A missed frame is painted on the next tick.
  } finally {
    isTicking = false
  }
}

// ── Telegram ──────────────────────────────────────────────────────────────

async function notify($: EngineInterface, kind: NotifyKind, extra: NotifyExtra): Promise<string> {
  const { config } = runtime
  if (!config.telegramBotToken || !config.telegramChatId) return 'telegram is not configured'
  const project = basename(await $.session.root())
  if (kind !== 'test' && config.notifyBlocklist.includes(project)) return `project ${project} is blocklisted`

  const [usage, h, sessionId, now, time] = await Promise.all([
    $.session.usage(),
    read($, hudAtom),
    $.session.id(),
    $.clock.now(),
    localTime($),
  ])
  let settingsLanguage: unknown
  if (config.notifyLanguage === 'auto') {
    try {
      settingsLanguage = ((await $.settings.read()) as Record<string, unknown>).language
    } catch {
      // Unreadable settings: English.
    }
  }
  const text = buildMessage({
    kind,
    language: resolveLanguage(config.notifyLanguage, settingsLanguage),
    project,
    branch: h.git?.branch,
    time,
    now,
    durationMs: extra.durationMs,
    model: h.model,
    effort: h.effort,
    costUsd: usage.cost?.usd,
    ctxPercent: usage.context.percent,
    rates: usage.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt })),
    summary: extra.summary,
    detail: extra.detail,
    sessionId,
    sessionTitle: h.sessionTitle,
  })

  try {
    const response = await $.http.fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    $.ui.log(`hudcade: telegram ${kind} http=${response.status} project=${project}`, { to: 'debug' })
    return `http ${response.status}`
  } catch (error) {
    // The error's text may carry the request URL, and with it the token.
    const name = error instanceof Error ? error.name : 'error'
    $.ui.log(`hudcade: telegram ${kind} failed (${name}) project=${project}`, { to: 'debug' })
    return `failed (${name})`
  }
}

function notifyLater($: EngineInterface, kind: NotifyKind, extra: NotifyExtra): void {
  if (!runtime.config.notify) return
  void notify($, kind, extra).catch(() => undefined)
}

// Local wall-clock time with the zone name, as the old hook's `date` printed it.
async function localTime($: EngineInterface): Promise<string> {
  try {
    const { exitCode, stdout } = await $.process.run(['date', '+%Y-%m-%d %H:%M:%S %Z'], { timeoutMs: 2_000 })
    if (exitCode === 0 && stdout.trim()) return stdout.trim()
  } catch {
    // Fall back to UTC.
  }
  return `${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`
}

// A permission or failure notice heard from both a native and a classic event
// goes out once.
async function notifyOnce($: EngineInterface, kind: NotifyKind, extra: NotifyExtra): Promise<void> {
  const now = await $.clock.now()
  if (now - (lastNotifyAt[kind] ?? Number.NEGATIVE_INFINITY) < NOTIFY_DEDUPE_MS) return
  lastNotifyAt[kind] = now
  notifyLater($, kind, extra)
}

// ── Waiting for the person ────────────────────────────────────────────────

// The mode put a main-loop call to a person: the band says so and Telegram tells them.
async function askReachedPerson($: EngineInterface, id: string): Promise<void> {
  const ask = pendingAsks.get(id)
  if (!ask || ask.isAsked) return
  ask.isAsked = true
  ask.timer = undefined
  await patch($, h => setWaiting(h, true))
  await notifyOnce($, 'permission', { detail: ask.detail })
}

async function settleAsk($: EngineInterface, id: string): Promise<void> {
  const ask = pendingAsks.get(id)
  if (!ask) return
  ask.timer?.cancel()
  pendingAsks.delete(id)
  if (ask.isAsked && ![...pendingAsks.values()].some(other => other.isAsked)) await patch($, h => setWaiting(h, false))
}

function clearAsks(): void {
  for (const ask of pendingAsks.values()) ask.timer?.cancel()
  pendingAsks.clear()
}

// Compactions heard from both session.compact and classic.PostCompact count once.
async function countCompaction($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (now - lastCompactionAt < COMPACTION_DEDUPE_MS) return
  lastCompactionAt = now
  await patch($, h => noteCompaction(h))
}

// Redraws the idle band while it shows something that changes with time: the
// cache countdown, or agent rows that are about to go.
async function syncIdleRedraw($: EngineInterface): Promise<void> {
  const [h, now] = await Promise.all([snapshot($), $.clock.now()])
  const remaining = cacheRemainingMs(h.cache, now)
  const isNeeded =
    runtime.config.hud &&
    h.turn.status === 'idle' &&
    ((remaining !== undefined && remaining > 0) || h.agents.some(a => a.status !== 'running' && isAgentShown(a, now)))
  if (isNeeded && !idleTimer) {
    idleTimer = $.clock.every(IDLE_REDRAW_MS, () => {
      $.ui.invalidate('ui.render')
      void syncIdleRedraw($)
    })
  } else if (!isNeeded && idleTimer) {
    idleTimer.cancel()
    idleTimer = undefined
  }
}

// ── Step recap ────────────────────────────────────────────────────────────

function resetRecap(task: string): void {
  recapTimer?.cancel()
  recapTimer = undefined
  recapTask = task
  recapNote = ''
  recapSteps = []
  isRecapDirty = false
}

// After a main-loop step: one model call at a time, at most one per
// RECAP_MIN_INTERVAL_MS, over the steps so far. Started from a timer, so it
// outlives the step's own dispatch.
function scheduleRecap($: EngineInterface, now: number): void {
  if (!runtime.config.recap || !runtime.config.hud) return
  isRecapDirty = true
  if (isRecapping || recapTimer) return
  const wait = Math.max(1, lastRecapAt + RECAP_MIN_INTERVAL_MS - now)
  recapTimer = $.clock.after(wait, () => {
    recapTimer = undefined
    void runRecap($)
  })
}

async function runRecap($: EngineInterface): Promise<void> {
  if (!isRecapDirty || isRecapping) return
  const hud = await snapshot($)
  if (hud.turn.status === 'idle') return
  isRecapDirty = false
  isRecapping = true
  const turn = hud.turn.count
  try {
    const { system, prompt } = recapRequest({
      language: resolveLanguage(runtime.config.notifyLanguage, settingsLanguage) as NotifyLanguage,
      task: recapTask,
      steps: recapSteps,
      note: recapNote,
      runningAgents: hud.agents.filter(a => a.status === 'running').length,
    })
    const reply = await $.model.complete({ model: runtime.config.recapModel, system, prompt, maxTokens: 200, timeoutMs: 20_000 })
    const text = reply.isAnswered ? cleanRecap(reply.text) : ''
    if (text) await patch($, h => setRecap(h, text, turn))
    else $.ui.log(`hudcade: recap got no line (${reply.isAnswered ? 'empty' : reply.reason})`, { to: 'debug' })
  } catch (error) {
    $.ui.log(`hudcade: recap failed (${error instanceof Error ? error.name : 'error'})`, { to: 'debug' })
  } finally {
    isRecapping = false
    lastRecapAt = await $.clock.now()
    if (isRecapDirty) scheduleRecap($, lastRecapAt)
  }
}


export const register: Register = (on, options) => {
  values = options as Record<string, unknown>
  runtime = createRuntime(values)

  // ── Session ───────────────────────────────────────────────────────────────

  on('session.start', async ($, e, next) => {
    try {
      await loadRuntime($)
    } catch (error) {
      runtime.warnings.push(`config: ${error instanceof Error ? error.message : String(error)}`)
    }
    await $.command.register({
      name: 'hud',
      description: 'hudcade status; `/hud agents` opens the agents pane; `/hud test-notify` sends a test Telegram message',
      argumentHint: '[agents|test-notify]',
    })
    // Each fact is read on its own: one that fails must not blank the others,
    // and its reason shows in /hud.
    const failed: string[] = []
    const note = (what: string, error: unknown) =>
      failed.push(`${what}: ${error instanceof Error ? error.message : String(error)}`)
    let project = ''
    let model: string | undefined
    let effort: string | undefined
    let turns: number | undefined
    try {
      project = basename(await $.session.root())
    } catch (error) {
      note('session.root', error)
    }
    try {
      model = await $.session.model()
    } catch (error) {
      note('session.model', error)
    }
    try {
      const settings = (await $.settings.read()) as Record<string, unknown>
      if (typeof settings.effortLevel === 'string') effort = settings.effortLevel
      settingsLanguage = settings.language
    } catch (error) {
      note('settings.read', error)
    }
    try {
      turns = await $.session.turns()
    } catch (error) {
      note('session.turns', error)
    }
    let tzOffsetMinutes: number | undefined
    try {
      const { exitCode, stdout } = await $.process.run(['date', '+%z'], { timeoutMs: 2_000 })
      if (exitCode === 0) tzOffsetMinutes = parseTzOffset(stdout)
    } catch (error) {
      note('date +%z', error)
    }
    try {
      // Session state outlives a reload, so merge: what classic.SessionStart
      // already noted (a resumed context, a cold cache) stays.
      await patch($, h => ({
        ...h,
        project: project || h.project,
        model: model ?? h.model,
        effort: effort ?? h.effort,
        tzOffsetMinutes: tzOffsetMinutes ?? h.tzOffsetMinutes,
        turn: { ...h.turn, count: Math.max(h.turn.count, turns ?? 0) },
      }))
    } catch (error) {
      note('state', error)
    }
    try {
      const usage = await $.session.usage()
      await applyMeasure($, { context: usage.context, rateLimits: usage.rateLimits, cost: usage.cost, startedAt: usage.startedAt })
    } catch (error) {
      note('session.usage', error)
    }
    await refreshGit($, true)
    await syncStatus($)
    runtime.warnings.push(...failed)
    return next(e)
  })

  // A /clear ends the conversation and its prompt cache.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await patch($, h => ({ ...h, cache: undefined }))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await applyMeasure($, { context: e.context, rateLimits: e.rateLimits, cost: e.cost })
    await syncStatus($)
    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    if (e.args.trim() === 'test-notify') {
      return { text: `hudcade test notification: ${await notify($, 'test', {})}` }
    }
    if (e.args.trim() === 'agents') {
      const { isPlaced } = await $.ui.open({ id: AGENTS_PANE, title: 'hudcade · agents' })
      return { text: isPlaced ? 'Agents pane opened.' : 'The agents pane opens once the window has room for it.' }
    }
    return { text: statusText(runtime, await snapshot($)) }
  })

  // ── Turns ─────────────────────────────────────────────────────────────────

  // A subagent's turn.start (e.agentId) starts its run's clock; only the
  // main loop's starts a turn of the band.
  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId) {
      const agentId = e.agentId
      await patch($, h => resumeAgent(h, agentId, now))
      return next(e)
    }
    const h = await patch($, h => startTurn(h, now))
    syncTicker($, true)
    idleTimer?.cancel()
    idleTimer = undefined
    clearAsks()
    resetRecap(e.text)

    turnStartedAt = now
    toolsAtStart = h.tools.total
    scene = pickScene(runtime.config.spinnerScene, lastScene, Math.random())
    lastScene = scene
    spinnerMode = undefined
    stopFrames()
    if (runtime.config.spinner) frameTimer = $.clock.every(FRAME_MS, () => void paintFrame($))
    return next(e)
  })

  // Every model request of a turn passes here: write only what changed, so
  // the drawings are not redrawn for nothing.
  on('turn.step', async function* ($, e, next) {
    const effort = e.effort === undefined ? undefined : String(e.effort)
    const hud = await snapshot($)
    const isChanged = e.agentId
      ? hud.agents.some(a => a.agentId === e.agentId && a.model !== e.model)
      : hud.model !== e.model || (effort !== undefined && hud.effort !== effort)
    if (isChanged) {
      await patch($, h =>
        e.agentId ? setAgentModel(h, e.agentId, e.model) : { ...h, model: e.model, effort: effort ?? h.effort },
      )
      if (!e.agentId) await syncStatus($)
    }
    const agentId = e.agentId
    if (agentId && hud.agents.some(a => a.agentId === agentId && a.status === 'running' && a.workingSince === undefined)) {
      const now = await $.clock.now()
      await patch($, h => resumeAgent(h, agentId, now))
    }

    // Read the request's stream through unchanged; its stop chunk carries the
    // tokens, cache reads and writes included, and the cache lifetime counts
    // from when the request was sent. Its text is the recap's latest note.
    const sentAt = e.agentId ? 0 : await $.clock.now()
    const stream = next(e)
    let firstChunkAt: number | undefined
    let said = ''
    for await (const chunk of stream) {
      if (!e.agentId) {
        firstChunkAt ??= await $.clock.now()
        if (chunk.kind === 'text') said += chunk.text
        if (chunk.kind === 'stop' && chunk.usage) {
          const usage = chunk.usage
          const streamMs = (await $.clock.now()) - firstChunkAt
          try {
            await patch($, h => addRequestUsage(h, usage, streamMs, sentAt))
          } catch {
            // A missed reading only skews the ratio and the speed.
          }
        }
      }
      yield chunk
    }
    if (said.trim()) recapNote = said
    return await stream.result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      const h = await patch($, h => completeTurn(h, e.durationMs, now, e.reason))
      syncTicker($, h.agents.some(a => a.status === 'running'))
      stopFrames()
      clearAsks()
      recapTimer?.cancel()
      recapTimer = undefined
      isRecapDirty = false
      void refreshGit($)
      void refreshAgents($)
      const percent = h.ctx?.percent
      if (percent !== undefined && percent >= runtime.config.ctxWarnPercent) void refreshContextBreakdown($)
      await syncStatus($)

      const isLongEnough = e.durationMs >= runtime.config.notifyMinTurnSeconds * 1_000
      if (!e.isAborted && isLongEnough) {
        const extra = { durationMs: e.durationMs, summary: summarize(e.answer) }
        if (e.reason === 'error') await notifyOnce($, 'failure', extra)
        else notifyLater($, 'done', extra)
      }
      void syncIdleRedraw($)
    } else {
      const now = await $.clock.now()
      const agentId = e.agentId
      await patch($, h => agentTurnEnded(h, agentId, now))
      void syncIdleRedraw($)
    }
    return next(e)
  })

  // ── Tools, subagents, tasks ───────────────────────────────────────────────

  on('tool.call', async ($, e, next) => {
    const now = await $.clock.now()
    const input = e as unknown as Record<string, unknown>
    const id = e.tool_use_id ?? `${e.tool}:${now}`
    await patch($, h => {
      let state = startTool(h, { id, tool: e.tool, detail: toolDetail(e.tool, input), startedAt: now, agentId: e.agentId })
      if (e.tool === 'Agent') {
        state = launchAgent(state, {
          toolUseId: id,
          type: typeof input.subagent_type === 'string' ? input.subagent_type : 'general-purpose',
          description: toolDetail('Agent', input),
          model: typeof input.model === 'string' ? input.model : undefined,
          isBackground: input.run_in_background === true,
          now,
        })
      }
      return state
    })

    const ran = await next(e)

    try {
      const end = await $.clock.now()
      const isError = ran.deny !== undefined || ran.isError === true
      const result = (ran.result ?? {}) as Record<string, unknown>
      await patch($, h => {
        let state = endTool(h, id, isError)
        if (e.tool === 'Agent') {
          state = agentResult(
            state,
            id,
            {
              agentId: typeof result.agentId === 'string' ? result.agentId : undefined,
              model: typeof result.resolvedModel === 'string' ? result.resolvedModel : undefined,
              isLaunchOnly: result.status === 'async_launched',
              isError,
            },
            end,
          )
        } else if (e.tool === 'TaskCreate' && !isError) {
          const task = result.task as { id?: unknown } | undefined
          state = taskCreated(state, String(input.subject ?? ''), typeof task?.id === 'string' ? task.id : undefined)
        } else if (e.tool === 'TaskUpdate' && !isError && typeof input.taskId === 'string') {
          state = taskUpdated(state, input.taskId, {
            status: input.status as 'pending' | 'in_progress' | 'completed' | 'deleted' | undefined,
            subject: typeof input.subject === 'string' ? input.subject : undefined,
          })
        } else if ((e.tool === 'Edit' || e.tool === 'Write') && !isError && typeof input.file_path === 'string') {
          const counts = patchCounts(ran.result)
          if (counts) state = addDiff(state, input.file_path, counts)
        } else if (e.tool === 'TodoWrite' && !isError && Array.isArray(input.todos)) {
          state = todosWritten(state, input.todos as { content: string; status: 'pending' | 'in_progress' | 'completed' }[])
        }
        return state
      })
      if (GIT_TOOLS.has(e.tool)) void refreshGit($)
      // A call the person denied ends here, never reaching tool.run.
      if (pendingAsks.has(id)) await settleAsk($, id)
      if (!e.agentId) {
        recapSteps.push({ tool: e.tool, detail: toolDetail(e.tool, input), isError })
        scheduleRecap($, end)
      }
    } catch {
      // Bookkeeping never changes what the tool returned.
    }
    return ran
  }).catch(($, e, next) => next(e))

  // ── Native events for what the classic hooks below also report ────────────
  //
  // Where a managed plugin sits above this one (cc-plugin-sec-default on Team
  // and Enterprise plans) every classic.* hook is passed over, so these native
  // events carry what they can. Elsewhere both arrive: each pair links, ends,
  // counts and notifies once.

  // The exact link: an agent row belongs to the Agent call the spawn names. A
  // workflow's agent or a fork no call starts gets a row of its own.
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const agentId = spawned.agentId
    // Teammates are listed from the roster, not as agent rows.
    if (!agentId || e.isTeammate) return spawned
    try {
      const now = await $.clock.now()
      const isWorkflow = e.workflow !== undefined || (e.fork && !e.tool_use_id)
      const description = e.description || (e.workflow ? `workflow agent ${e.workflow.agentIndex}` : '')
      await patch($, h =>
        spawnAgent(h, {
          toolUseId: e.tool_use_id,
          agentId,
          type: e.subagentType,
          description,
          isBackground: e.background,
          isWorkflow,
          isResume: e.resume !== undefined,
          now,
        }),
      )
      syncTicker($, true)
      void refreshAgents($)
    } catch {
      // Bookkeeping never changes the spawn.
    }
    return spawned
  })

  // How an agent's run ended, as its report reaches the parent; the report
  // itself passes on untouched.
  on('agent.report', async ($, e, next) => {
    const reported = await next(e)
    try {
      const now = await $.clock.now()
      const h = await patch($, h => reportAgent(h, e.agentId, e.status, now))
      syncTicker($, h.turn.status !== 'idle' || h.agents.some(a => a.status === 'running'))
      void syncIdleRedraw($)
    } catch {
      // Bookkeeping never changes the report.
    }
    return reported
  })

  // A compaction of the main conversation that took place (not a precompute
  // kept for later, nor one a hook skipped).
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && compacted.messages !== undefined) {
      try {
        await countCompaction($)
      } catch {
        // Bookkeeping never changes the compaction.
      }
    }
    return compacted
  })

  // A main-loop call the mode puts to a person. Auto mode asks its classifier
  // first (tool.judge): only a call it gives no verdict on reaches the person.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (verdict.decision === 'ask' && id && !e.agentId && e.approver === 'person' && !pendingAsks.has(id)) {
      const input = (e.input ?? {}) as Record<string, unknown>
      const detail = [toolLabel(e.tool), toolDetail(e.tool, input)].filter(Boolean).join(': ')
      pendingAsks.set(id, { detail, isAsked: false, timer: $.clock.after(ASK_SETTLE_MS, () => void askReachedPerson($, id)) })
    }
    return verdict
  })

  on('tool.judge', async ($, e, next) => {
    const ask = pendingAsks.get(e.tool_use_id)
    ask?.timer?.cancel()
    if (ask) ask.timer = undefined
    const verdict = await next(e)
    if (ask) {
      if (verdict.decision === 'ask') await askReachedPerson($, e.tool_use_id)
      else await settleAsk($, e.tool_use_id)
    }
    return verdict
  })

  // An allowed call is about to run: whoever was asked has answered.
  on('tool.run', async ($, e, next) => {
    if (e.tool_use_id && pendingAsks.has(e.tool_use_id)) await settleAsk($, e.tool_use_id)
    return next(e)
  })

  on('classic.SubagentStart', async ($, e, next) => {
    const now = await $.clock.now()
    await patch($, h => linkAgent(h, e.agent_id, e.agent_type, now))
    syncTicker($, true)
    void refreshAgents($)
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const now = await $.clock.now()
    const h = await patch($, h => (e.agent_id ? finishAgent(h, e.agent_id, now) : h))
    syncTicker($, h.turn.status !== 'idle' || h.agents.some(a => a.status === 'running'))
    void syncIdleRedraw($)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'resume' || e.source === 'fork') {
      await patch($, h =>
        applyResume(h, {
          contextTokens: e.context_tokens,
          isCacheCold: e.prompt_cache_likely_expired,
          rebuildUsd: e.estimated_cache_write_usd,
        }),
      )
    } else if (e.source === 'clear') {
      await patch($, h => ({ ...h, cache: undefined }))
    }
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    if (!e.agent_id) {
      const finished = new Set(['completed', 'failed', 'killed', 'stopped'])
      const background = (e.background_tasks ?? [])
        .filter(t => !finished.has(t.status))
        .map(t => ({ id: t.id, type: t.type, status: t.status, description: t.description || t.command || t.name || t.type }))
      const crons = (e.session_crons ?? []).map(c => ({ id: c.id, schedule: c.schedule, isRecurring: c.recurring, prompt: c.prompt }))
      await patch($, h => setWorkers(h, background, crons))
      void refreshAgents($)
    }
    return next(e)
  })

  on('classic.PostCompact', async ($, e, next) => {
    await countCompaction($)
    return next(e)
  })

  on('classic.TeammateIdle', async ($, e, next) => {
    void refreshAgents($)
    return next(e)
  })

  // A switch forfeits a warm prompt cache: say what rebuilding it costs.
  on('classic.PreModelSwitch', async ($, e, next) => {
    await patch($, h => setCacheTtl(h, e.cache_ttl))
    if (runtime.config.hud && e.prompt_cache_warm && e.estimated_cache_write_usd >= 0.01) {
      const target = modelLabel(e.to_model) ?? e.to_model
      $.ui.toast(
        `Switching to ${target} rebuilds the prompt cache: ~${usd(e.estimated_cache_write_usd)} for ${tokens(e.context_tokens)} tokens`,
        { timeoutMs: 8_000 },
      )
    }
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    await patch($, h => setCacheTtl(h, e.cache_ttl))
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.session_title) await patch($, h => ({ ...h, sessionTitle: e.session_title }))
    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    if (!e.agent_id && e.notification_type === 'permission_prompt') {
      await patch($, h => setWaiting(h, true))
      await notifyOnce($, 'permission', { detail: summarize(e.message, 200) })
    }
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    if (!e.agent_id) {
      const detail = [String(e.error), e.error_details].filter(Boolean).join(' — ')
      await notifyOnce($, 'failure', { detail: summarize(detail, 200) })
    }
    return next(e)
  })

  // ── Drawing ───────────────────────────────────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!runtime.config.hud || e.props.hasSurvey) return next(e)
    const hud = await snapshot($)
    const now = await $.clock.now()
    const rows = buildBand(hud, now, Math.max(20, e.props.bodyColumns), {
      warnPercent: runtime.config.ctxWarnPercent,
      criticalPercent: runtime.config.ctxCriticalPercent,
    }).slice(0, Math.max(1, e.props.maxRows))
    const { Box, Text } = $.ui.resolve(e)
    const texts = (segs: Seg[]) =>
      segs.map(seg => (
        <Text color={seg.color} dimColor={seg.dim} bold={seg.bold} wrap="truncate">
          {seg.text}
        </Text>
      ))
    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row">{texts(row.left)}</Box>
            {row.right.length > 0 && <Box flexDirection="row">{texts(row.right)}</Box>}
          </Box>
        ))}
      </Box>
    )
  })

  // Under an Agent call's transcript row, while its agent runs: model, work
  // time, tools, the tool in hand and its context.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!runtime.config.hud || e.props.tool !== 'Agent') return next(e)
    const row = await next(e)
    const hud = await snapshot($)
    const agent = hud.agents.find(a => a.toolUseId === e.props.tool_use_id)
    if (!agent || agent.status !== 'running') return row
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        <Text dimColor wrap="truncate">
          {agentSummary(agent, now)}
        </Text>
      </Box>
    )
  })

  // `/hud agents`: every agent of the session with its task, and the teammates,
  // background tasks and scheduled prompts.
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e) => {
    const hud = await snapshot($)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {paneRows(hud, now).map(row => (
          <Box flexDirection="row">
            {row.map(seg => (
              <Text color={seg.color} dimColor={seg.dim} bold={seg.bold} wrap="truncate">
                {seg.text}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!runtime.config.spinner || e.surface !== 'terminal') return next(e)

    spinnerMode = e.props.mode
    const columns = Math.max(16, Math.min(56, (e.viewport?.columns ?? 100) - SPINNER_TEXT_COLUMNS))
    spinners.set(e.requestId, columns)

    const hud = await snapshot($)
    const now = await $.clock.now()
    const t = turnStartedAt ? now - turnStartedAt : 0
    const elapsed = clock(hud.turn.startedAt !== undefined ? now - hud.turn.startedAt : t)
    const main = hud.tools.running.filter(run => !run.agentId)
    const current = main[main.length - 1]
    const agents = hud.agents.filter(a => a.status === 'running').length
    const activity = current
      ? `▸ ${toolLabel(current.tool)} ${truncate(current.detail, 24)}`
      : agents > 0
        ? `▸ ${agents} agent${agents > 1 ? 's' : ''} running`
        : '▸ …'

    const { Box, Text, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Raster key="scene" columns={columns} rows={SCENE_ROWS} cells={renderScene(scene, modeOf(spinnerMode), t, columns)} />
        <Box flexDirection="column" marginLeft={1}>
          <Text color={SCENES[scene].accent} bold wrap="truncate">
            {e.props.message ?? e.props.word}
            {e.props.suffix}
          </Text>
          <Text dimColor wrap="truncate">
            {elapsed} · {hud.effort ?? 'default'} · {modeLabel(spinnerMode)}
          </Text>
          <Text color="suggestion" wrap="truncate">
            {activity}
          </Text>
          <Text dimColor wrap="truncate">
            {turnFacts(hud, toolsAtStart)}
          </Text>
        </Box>
      </Box>
    )
  })
}

function statusText(runtime: Runtime, hud: Hud): string {
  const { config } = runtime
  const onOff = (flag: boolean) => (flag ? 'on' : 'off')
  const lines = [
    'hudcade status',
    `modules: hud ${onOff(config.hud)} · status line ${onOff(config.statusLine)} · spinner ${onOff(config.spinner)} (${config.spinnerScene}) · recap ${onOff(config.recap)} (${config.recapModel}) · notify ${onOff(config.notify)}`,
    `context thresholds: warn ${config.ctxWarnPercent}% · critical ${config.ctxCriticalPercent}%`,
    `config sources: ${runtime.sources.join(', ')}`,
    `telegram: ${runtime.telegramSource ? `configured (${runtime.telegramSource})` : 'not configured'} · language ${config.notifyLanguage}`,
    `hud data: project=${hud.project || '—'} · model=${hud.model ?? '—'} · effort=${hud.effort ?? '—'} · turn=${hud.turn.count} (${hud.turn.status})`,
    `          ctx=${hud.ctx ? `${hud.ctx.percent ?? '?'}% of ${hud.ctx.window}` : '— (no reading yet)'} · rate limits=${hud.rates.length} · cost=${hud.costUsd !== undefined ? usd(hud.costUsd) : '—'}`,
    `          git=${hud.git ? hud.git.branch : `— (${gitNote})`} · tools=${hud.tools.total} · agents=${hud.agents.length} · tasks=${hud.tasks.length}`,
  ]
  if (runtime.warnings.length > 0) lines.push('warnings:', ...runtime.warnings.map(w => `  - ${w}`))
  return lines.join('\n')
}
