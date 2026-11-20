import { describe, expect, test } from 'claude-code/testing'

import type { Hud } from '../types'
import { agentSummary, buildBand, displayWidth, paneRows, rowText, statusLine } from '../src/core/band'
import { parseEnvFile, resolveConfig } from '../src/core/config'
import { bar, clock, compactDuration, modelLabel, msUntil, parseTzOffset, preciseDuration, sanitize, sparkline, tokens, toolDetail, wallClock } from '../src/core/format'
import { cleanRecap, recapRequest } from '../src/core/recap'
import { SCENE_NAMES, SCENE_ROWS, pickScene, renderScene } from '../src/core/scenes'
import { base64 } from '../src/core/scenes/canvas'
import { turnFacts } from '../src/core/spinner'
import {
  addDiff,
  addRequestUsage,
  agentResult,
  agentTurnEnded,
  agentWorkedMs,
  applyResume,
  applyUsage,
  cacheHitPercent,
  cacheRemainingMs,
  isAgentShown,
  noteCompaction,
  reportAgent,
  setRecap,
  patchCounts,
  setCtxTop,
  setTeammates,
  setWorkers,
  completeTurn,
  emptyHud,
  endTool,
  finishAgent,
  launchAgent,
  linkAgent,
  parseGitStatus,
  pauseAgent,
  pruneAgents,
  reconcileAgents,
  resumeAgent,
  spawnAgent,
  startTool,
  startTurn,
  taskCreated,
  taskUpdated,
} from '../src/core/hud-model'
import { buildMessage, resolveLanguage, summarize, type NotifyFacts } from '../src/core/telegram'

describe('format', () => {
  test('durations read the way the band and messages show them', () => {
    expect(clock(42_000)).toBe('0:42')
    expect(clock(3_723_000)).toBe('1:02:03')
    expect(compactDuration(12 * 60_000)).toBe('12m')
    expect(compactDuration(65 * 60_000)).toBe('1h05m')
    expect(compactDuration(2 * 86_400_000 + 3 * 3_600_000)).toBe('2d3h')
    expect(preciseDuration(134_000)).toBe('2m14s')
  })

  test('token counts and bars', () => {
    expect(tokens(913_000)).toBe('913k')
    expect(tokens(1_250_000)).toBe('1.3M')
    expect(tokens(850)).toBe('850')
    expect(bar(45, 10)).toBe('████▌░░░░░')
    expect(bar(150, 4)).toBe('████')
  })

  test('model ids become short labels', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(modelLabel('gpt-x')).toBe('gpt-x')
  })

  test('wall-clock times use the machine zone offset from `date +%z`', () => {
    expect(parseTzOffset('+0800\n')).toBe(480)
    expect(parseTzOffset('-0330')).toBe(-210)
    expect(parseTzOffset('CST')).toBeUndefined()
    const at = Date.UTC(2026, 9, 8, 6, 32, 5)
    expect(wallClock(at, 480)).toBe('14:32:05')
    expect(wallClock(at, -210)).toBe('03:02:05')
  })

  test('reset times accept Unix seconds and ISO strings', () => {
    expect(msUntil('100', 40_000)).toBe(60_000)
    expect(msUntil('1970-01-01T00:01:40Z', 40_000)).toBe(60_000)
    expect(msUntil(undefined, 0)).toBeUndefined()
  })

  test('outside text loses escape sequences and control characters', () => {
    expect(sanitize('\u001b[31mred\u001b[0m\nline')).toBe('red line')
  })

  test('tool details name what the call works on', () => {
    expect(toolDetail('Edit', { file_path: '/a/b/auth.ts' })).toBe('auth.ts')
    expect(toolDetail('Bash', { command: 'npm test', description: 'Run tests' })).toBe('Run tests')
    expect(toolDetail('WebFetch', { url: 'https://example.com/x' })).toBe('example.com')
  })
})

describe('config', () => {
  test('out of the box nothing is blocklisted and the message language follows Claude Code', () => {
    const { config } = resolveConfig({}, [])
    expect(config.notifyBlocklist).toEqual([])
    expect(config.notifyLanguage).toBe('auto')
    const bad = resolveConfig({ notifyLanguage: 'fr' }, [])
    expect(bad.config.notifyLanguage).toBe('auto')
    expect(bad.warnings).toHaveLength(1)
  })

  test('defaults, then userConfig, then project files', () => {
    const { config, warnings } = resolveConfig({ spinnerScene: 'rocket', notifyMinTurnSeconds: 10 }, [
      { source: '.claude/claude-mods.json', values: { notify: false, notifyBlocklist: 'a b' } },
    ])
    expect(config.spinnerScene).toBe('rocket')
    expect(config.notifyMinTurnSeconds).toBe(10)
    expect(config.notify).toBe(false)
    expect(config.notifyBlocklist).toEqual(['a', 'b'])
    expect(config.hud).toBe(true)
    expect(warnings).toEqual([])
  })

  test('project files cannot set secrets, and bad values are reported, not applied', () => {
    const { config, warnings } = resolveConfig({}, [
      { source: 'p', values: { telegramBotToken: 'x', spinnerScene: 'tetris', ctxWarnPercent: -1, typo: 1 } },
    ])
    expect(config.telegramBotToken).toBeUndefined()
    expect(config.spinnerScene).toBe('random')
    expect(config.ctxWarnPercent).toBe(60)
    expect(warnings).toHaveLength(4)
  })

  test('the legacy env file parses quoted values', () => {
    const env = parseEnvFile('# c\nTELEGRAM_BOT_TOKEN="1:abc"\nexport TELEGRAM_CHAT_ID=42\n')
    expect(env).toEqual({ TELEGRAM_BOT_TOKEN: '1:abc', TELEGRAM_CHAT_ID: '42' })
  })
})

describe('hud model', () => {
  test('a zero context reading keeps the last good one', () => {
    let h = applyUsage(emptyHud('p'), { context: { tokens: 90_000, window: 1_000_000, percent: 9 } })
    h = applyUsage(h, { context: { tokens: 0, window: 1_000_000, percent: 0 } })
    expect(h.ctx?.percent).toBe(9)
  })

  test('a turn counts its tools and failures and ends idle', () => {
    let h = startTurn(emptyHud('p'), 1_000)
    h = startTool(h, { id: 't1', tool: 'Bash', detail: 'ls', startedAt: 1_100 })
    h = startTool(h, { id: 't2', tool: 'Read', detail: 'a.ts', startedAt: 1_200 })
    h = endTool(h, 't1', true)
    expect(h.tools).toMatchObject({ total: 2, failed: 1 })
    expect(h.tools.running.map(t => t.id)).toEqual(['t2'])
    h = completeTurn(h, 5_000, 6_000)
    expect(h.turn).toMatchObject({ status: 'idle', count: 1, lastDurationMs: 5_000 })
    expect(h.tools.running).toEqual([])
  })

  test('a foreground agent is linked by SubagentStart, counts its tools and finishes with its result', () => {
    let h = launchAgent(emptyHud('p'), { toolUseId: 'tu1', type: 'Explore', description: 'find', isBackground: false, now: 0 })
    h = linkAgent(h, 'ag1', 'Explore', 10)
    h = startTool(h, { id: 'x', tool: 'Grep', detail: '', startedAt: 20, agentId: 'ag1' })
    expect(h.agents[0]).toMatchObject({ agentId: 'ag1', tools: 1, currentTool: 'Grep', status: 'running' })
    h = endTool(h, 'x', false)
    h = agentResult(h, 'tu1', { agentId: 'ag1', model: 'claude-haiku-5-5', isLaunchOnly: false, isError: false }, 99)
    expect(h.agents[0]).toMatchObject({ status: 'done', endedAt: 99, model: 'claude-haiku-5-5' })
  })

  test('agent.spawn links the Agent call it names, not the oldest launch of that type', () => {
    let h = launchAgent(emptyHud('p'), { toolUseId: 'tu1', type: 'Explore', description: 'a', isBackground: false, now: 0 })
    h = launchAgent(h, { toolUseId: 'tu2', type: 'Explore', description: 'b', isBackground: false, now: 1 })
    h = spawnAgent(h, { toolUseId: 'tu2', agentId: 'ag2', type: 'Explore', now: 5 })
    expect(h.agents.map(a => a.agentId)).toEqual([undefined, 'ag2'])
    // A SubagentStart that already linked the id, or a repeat, changes nothing.
    expect(spawnAgent(h, { toolUseId: 'tu1', agentId: 'ag2', type: 'Explore', now: 6 })).toBe(h)
  })

  test('a background agent keeps running after its launch result until SubagentStop', () => {
    let h = launchAgent(emptyHud('p'), { toolUseId: 'tu1', type: 'Plan', description: '', isBackground: true, now: 0 })
    h = agentResult(h, 'tu1', { agentId: 'ag9', isLaunchOnly: true, isError: false }, 5)
    expect(h.agents[0]?.status).toBe('running')
    h = finishAgent(h, 'ag9', 50)
    expect(h.agents[0]?.status).toBe('done')
  })

  // A background agent launched at 0 that only reported its id, busy in Bash.
  function launchedInBackground(): Hud {
    let h = launchAgent(emptyHud('p'), { toolUseId: 'tu1', type: 'general-purpose', description: '', isBackground: true, now: 0 })
    h = agentResult(h, 'tu1', { agentId: 'ag1', isLaunchOnly: true, isError: false }, 5)
    return startTool(h, { id: 'b1', tool: 'Bash', detail: 'ls', startedAt: 10, agentId: 'ag1' })
  }

  test('a background agent whose SubagentStop never came ends when the roster says completed, and goes a minute later', () => {
    const h = reconcileAgents(launchedInBackground(), [{ id: 'ag1', status: 'completed' }], 700_000)
    expect(h.agents[0]).toMatchObject({ status: 'done', endedAt: 700_000 })
    expect(h.agents[0]?.currentTool).toBeUndefined()
    expect(h.tools.running).toEqual([])
    expect(pruneAgents(h.agents, 759_999)).toHaveLength(1)
    expect(pruneAgents(h.agents, 760_000)).toEqual([])
  })

  test('an agent the roster calls failed or killed is marked failed', () => {
    for (const status of ['failed', 'killed']) {
      const h = reconcileAgents(launchedInBackground(), [{ id: 'ag1', status }], 20_000)
      expect(h.agents[0]).toMatchObject({ status: 'failed', endedAt: 20_000 })
    }
  })

  test('a launched agent the roster no longer lists ends once past the launch grace', () => {
    const h = launchedInBackground()
    expect(reconcileAgents(h, [], 9_999).agents[0]?.status).toBe('running')
    expect(reconcileAgents(h, [], 10_000).agents[0]).toMatchObject({ status: 'done', endedAt: 10_000 })
    // A workflow's agents are never listed: a row no Agent call launched keeps running.
    const workflow = spawnAgent(emptyHud('p'), { toolUseId: 'wf-call', agentId: 'wf1', type: 'general-purpose', isWorkflow: true, now: 0 })
    expect(reconcileAgents(workflow, [], 600_000).agents[0]?.status).toBe('running')
  })

  test('an agent the roster still counts as live keeps running', () => {
    const h = launchedInBackground()
    for (const status of ['pending', 'running', 'waiting', 'idle']) {
      expect(reconcileAgents(h, [{ id: 'ag1', status }], 600_000)).toEqual(h)
    }
  })

  test('rows without an id, and rows already ended, are left as they were', () => {
    let h = finishAgent(launchedInBackground(), 'ag1', 50)
    h = launchAgent(h, { toolUseId: 'tu2', type: 'Explore', description: '', isBackground: true, now: 60 })
    const after = reconcileAgents(h, [{ id: 'ag1', status: 'failed' }], 600_000)
    expect(after.agents).toEqual(h.agents)
    expect(after.agents[0]).toMatchObject({ status: 'done', endedAt: 50 })
  })

  test('an agent’s clock counts its work: it stops between runs and picks up where it left off', () => {
    let h = launchedInBackground()
    expect(agentWorkedMs(h.agents[0]!, 4_000)).toBe(4_000)
    h = pauseAgent(h, 'ag1', 10_000)
    // An hour idle adds nothing.
    expect(agentWorkedMs(h.agents[0]!, 3_610_000)).toBe(10_000)
    h = resumeAgent(h, 'ag1', 3_610_000)
    expect(agentWorkedMs(h.agents[0]!, 3_615_000)).toBe(15_000)
    // A second request of the same run leaves the clock as it was.
    expect(resumeAgent(h, 'ag1', 3_614_000).agents[0]?.workingSince).toBe(3_610_000)
    h = finishAgent(h, 'ag1', 3_620_000)
    expect(agentWorkedMs(h.agents[0]!, 3_650_000)).toBe(20_000)
  })

  test('a finished agent’s clock stays stopped, and other agents keep theirs', () => {
    let h = launchedInBackground()
    h = launchAgent(h, { toolUseId: 'tu2', type: 'Explore', description: '', isBackground: false, now: 1_000 })
    h = agentResult(h, 'tu2', { agentId: 'ag2', isLaunchOnly: false, isError: true }, 3_000)
    h = pauseAgent(h, 'ag1', 8_000)
    h = resumeAgent(h, 'ag2', 9_000)
    expect(h.agents.map(a => agentWorkedMs(a, 60_000))).toEqual([8_000, 2_000])
  })

  test('tasks are matched by id, or by position before the id was known', () => {
    let h = taskCreated(emptyHud('p'), 'one', undefined)
    h = taskCreated(h, 'two', '7')
    h = taskUpdated(h, '1', { status: 'completed' })
    h = taskUpdated(h, '7', { status: 'in_progress' })
    expect(h.tasks.map(t => t.status)).toEqual(['completed', 'in_progress'])
    h = taskUpdated(h, '7', { status: 'deleted' })
    expect(h.tasks).toHaveLength(1)
  })

  test('git porcelain v2 headers', () => {
    const out = ['# branch.oid abc', '# branch.head main', '# branch.ab +2 -1', '1 .M N... 100644 100644 100644 a b f.ts', ''].join('\0')
    expect(parseGitStatus(out)).toEqual({ branch: 'main', isDirty: true, ahead: 2, behind: 1 })
    expect(parseGitStatus('# branch.oid 1234567890\0# branch.head (detached)\0')?.branch).toBe('1234567')
  })
})

describe('band', () => {
  const OPTIONS = { warnPercent: 60, criticalPercent: 80 }
  const texts = (h: Hud, columns = 200, now = 60_000) => buildBand(h, now, columns, OPTIONS).map(rowText)

  function busyHud(): Hud {
    let h = applyUsage(emptyHud('claude-mods'), {
      context: { tokens: 87_000, window: 1_000_000, percent: 9 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 13 },
        { kind: 'seven_day', percentUsed: 38 },
      ],
      cost: { usd: 0.43 },
      startedAt: 0,
    })
    h = { ...h, model: 'claude-opus-5-5', effort: 'xhigh', git: { branch: 'main', isDirty: true, ahead: 2, behind: 0 } }
    h = startTurn(h, 1_000)
    h = startTool(h, { id: 't', tool: 'Bash', detail: '跑測試 npm test', startedAt: 2_000 })
    h = launchAgent(h, { toolUseId: 'a', type: 'Explore', description: 'find auth usages', isBackground: false, now: 1_500 })
    return h
  }

  test('rows: identity, capacity, activity, then workers', () => {
    const [identity, capacity, activity, agent] = texts(busyHud())
    expect(identity).toContain('Opus 5.5 · xhigh')
    expect(identity).toContain('main* ↑2')
    expect(identity).toContain('$0.43')
    expect(capacity).toContain('9%')
    expect(capacity).toContain('913k left')
    expect(capacity).toContain('5h')
    expect(capacity).toContain('7d')
    expect(activity).toContain('working 0:59')
    expect(activity).toContain('Bash')
    expect(agent).toContain('agent')
    expect(agent).toContain('Explore')
  })

  test('a running turn shows when it started; a finished one its start, end and length', () => {
    const t0 = Date.UTC(2026, 9, 8, 6, 32, 5)
    let h: Hud = { ...emptyHud('p'), tzOffsetMinutes: 480 }
    h = startTurn(h, t0)
    expect(texts(h, 200, t0 + 42_000)[2]).toContain('working 0:42 · turn 1   since 14:32:05')
    h = completeTurn(h, 134_000, t0 + 134_000)
    expect(texts(h, 200, t0 + 200_000)[2]).toContain('idle · turn 1   14:32:05–14:34:19 (2:14)')
    expect(startTurn(h, t0 + 300_000).turn.endedAt).toBeUndefined()
  })

  test('money and limits sit on the right side of their rows', () => {
    const [identity, capacity] = buildBand(busyHud(), 60_000, 200, OPTIONS)
    expect(identity!.right.map(s => s.text).join('')).toContain('$0.43')
    expect(capacity!.right.map(s => s.text).join('')).toContain('13%')
  })

  test('every row fits the width, dropping the least important parts first', () => {
    for (const columns of [24, 40, 60, 100, 160]) {
      const rows = buildBand(busyHud(), 60_000, columns, OPTIONS)
      for (const row of rows) {
        const left = displayWidth(row.left.map(s => s.text).join(''))
        const right = displayWidth(row.right.map(s => s.text).join(''))
        expect(left + right + (left && right ? 2 : 0)).toBeLessThanOrEqual(columns)
      }
      expect(rowText(rows[0]!)).toContain('Opus 5.5')
    }
  })

  test('before the first reply the context row says so instead of vanishing', () => {
    const fresh = applyUsage(emptyHud('p'), { context: { window: 1_000_000 } })
    expect(texts(fresh)[1]).toContain('1M window')
    expect(texts(fresh)[1]).toContain('waiting for first reply')
  })

  test('cache hit ratio accumulates over requests and flags a miss on the last one', () => {
    let h = addRequestUsage(emptyHud('p'), { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 990 })
    h = addRequestUsage(h, { input_tokens: 10, cache_read_input_tokens: 2_990, cache_creation_input_tokens: 0 })
    expect(Math.round(cacheHitPercent(h.cache)!)).toBe(75)
    expect(texts(h)[1]).toContain('cache 75%')
    h = addRequestUsage(h, { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 4_000 })
    expect(texts(h)[1]).toContain('cache 37%')
    expect(texts(h)[1]).toContain('last 0%')
  })

  test('a resumed session shows its context and a cold cache with its rebuild cost', () => {
    let h = applyResume(emptyHud('p'), { contextTokens: 250_000, isCacheCold: true, rebuildUsd: 0.85 })
    h = applyUsage(h, { context: { window: 1_000_000 } })
    expect(texts(h)[1]).toContain('25%')
    expect(texts(h)[1]).toContain('750k left')
    expect(texts(h)[1]).toContain('cache cold ~$0.85')
  })

  test('turn tokens and output speed come from the turn requests', () => {
    let h = startTurn(emptyHud('p'), 0)
    h = addRequestUsage(h, { input_tokens: 2_000, output_tokens: 600, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0 }, 10_000)
    h = addRequestUsage(h, { input_tokens: 0, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 8_000)
    expect(texts(h)[2]).toContain('↑12k ↓1k')
    expect(texts(h)[2]).toContain('50 tok/s')
    expect(startTurn(h, 1).turnTokens).toEqual({ input: 0, output: 0 })
  })

  test('edits add up to lines and files; compactions are counted', () => {
    let h = addDiff(emptyHud('p'), '/a.ts', patchCounts({ structuredPatch: [{ lines: [' x', '-old', '+new', '+more'] }] })!)
    h = addDiff(h, '/b.ts', patchCounts({ type: 'create', content: 'one\ntwo\n', structuredPatch: [] })!)
    h = addDiff(h, '/a.ts', { added: 1, removed: 0 })
    expect(h.diff).toEqual({ added: 5, removed: 1, files: ['/a.ts', '/b.ts'] })
    expect(texts(h)[0]).toContain('+5 −1 · 2 files')
    expect(texts(noteCompaction(h))[1]).toContain('⟲1')
  })

  test('teammates, background tasks and loops get their own worker rows', () => {
    let h = setTeammates(emptyHud('p'), [
      { id: 'a1', teammateId: 'alice@team', name: 'alice', status: 'running', description: 'review PR' },
      { id: 'a2', status: 'running', description: 'plain subagent' },
    ])
    h = setWorkers(h, [{ id: 'b', type: 'bash', status: 'running', description: 'npm run dev' }], [
      { id: 'c', schedule: 'every 5m', isRecurring: true, prompt: 'check deploy' },
    ])
    const rows = texts(h)
    expect(rows.some(r => r.includes('mate') && r.includes('alice') && r.includes('review PR'))).toBe(true)
    expect(rows.some(r => r.includes('plain subagent'))).toBe(false)
    expect(rows.some(r => r.includes('bg') && r.includes('npm run dev'))).toBe(true)
    expect(rows.some(r => r.includes('loop') && r.includes('every 5m') && r.includes('check deploy'))).toBe(true)
  })

  test('worker rows are capped with a count of the rest', () => {
    let h = emptyHud('p')
    for (let i = 0; i < 6; i++) h = launchAgent(h, { toolUseId: `t${i}`, type: `A${i}`, description: '', isBackground: false, now: i })
    const rows = texts(h)
    expect(rows.filter(r => r.includes('agent')).length).toBe(3)
    expect(rows.some(r => r.includes('+3 more'))).toBe(true)
  })

  test('the context breakdown row appears only past the warning threshold', () => {
    const parts = [
      { name: 'Messages', tokens: 500_000, kind: 'used' },
      { name: 'System tools', tokens: 150_000, kind: 'used' },
      { name: 'Free space', tokens: 300_000, kind: 'free' },
    ]
    const low = setCtxTop(applyUsage(emptyHud('p'), { context: { tokens: 300_000, window: 1_000_000, percent: 30 } }), parts)
    expect(texts(low).some(r => r.includes('↳'))).toBe(false)
    const high = setCtxTop(applyUsage(emptyHud('p'), { context: { tokens: 650_000, window: 1_000_000, percent: 65 } }), parts)
    const row = texts(high).find(r => r.includes('↳'))
    expect(row).toContain('messages 77%')
    expect(row).toContain('system tools 23%')
    expect(row).not.toContain('free')
  })

  test('a state from an older version of the mod still draws', () => {
    const old = { project: 'p', rates: [], turn: { count: 1, status: 'idle' }, tools: { total: 0, failed: 0, running: [] }, agents: [], tasks: [] }
    expect(texts(old as unknown as Hud)[0]).toContain('Claude')
  })

  test('an agent row shows the time the agent worked, not how long it has been listed', () => {
    let h = launchAgent(emptyHud('p'), { toolUseId: 'tu1', type: 'Plan', description: '', isBackground: true, now: 0 })
    h = agentResult(h, 'tu1', { agentId: 'ag1', isLaunchOnly: true, isError: false }, 1_000)
    h = pauseAgent(h, 'ag1', 12_000)
    const row = texts(h, 200, 64 * 3_600_000).find(r => r.includes('Plan'))
    expect(row).toContain('· 0:12 ·')
    // A row an older version of the mod wrote has no work time yet.
    const legacy = { key: 'tu:t', toolUseId: 't', type: 'Old', description: '', isBackground: false, startedAt: 0, tools: 1, status: 'running' }
    const old = texts({ ...emptyHud('p'), agents: [legacy] } as unknown as Hud, 200, 64 * 3_600_000)
    expect(old.find(r => r.includes('Old'))).toContain('· 0:00 ·')
  })

  test('the line under the prompt carries model, effort, context, cost and 5h/7d usage', () => {
    expect(statusLine(busyHud())).toBe('Opus 5.5 · xhigh │ ctx 9% │ $0.43 │ 5h 13% │ 7d 38%')
    expect(statusLine(emptyHud('p'))).toBe('Claude │ ctx —')
  })

  test('context color follows the thresholds', () => {
    const h = applyUsage(emptyHud('p'), { context: { tokens: 850_000, window: 1_000_000, percent: 85 } })
    const ctx = buildBand(h, 0, 120, OPTIONS)[1]?.left.find(s => s.text.includes('%'))
    expect(ctx?.color).toBe('error')
  })
})

describe('telegram', () => {
  const FACTS: NotifyFacts = {
    kind: 'done',
    language: 'en',
    project: 'a<b>',
    branch: 'main',
    time: '2026-10-08 12:00:00 CST',
    now: 0,
    durationMs: 134_000,
    model: 'claude-opus-5-5',
    effort: 'xhigh',
    costUsd: 0.43,
    ctxPercent: 9,
    rates: [{ kind: 'five_hour', percent: 13, resetsAt: '8100' }, { kind: 'seven_day', percent: 38 }],
    summary: 'done & dusted',
    sessionId: '11fa1a35-c235',
  }

  test('English messages carry every field and escape HTML', () => {
    const text = buildMessage(FACTS)
    expect(text).toContain('<b>✅ Claude Code is done</b>')
    expect(text).toContain('Project: <code>a&lt;b&gt;</code> (main)')
    expect(text).toContain('Time: 2026-10-08 12:00:00 CST')
    expect(text).toContain('Took 2m14s · Opus 5.5 · xhigh · $0.43')
    expect(text).toContain('5h:13%(2h15m) wk:38% ctx:9%(opus)')
    expect(text).toContain('Summary: done &amp; dusted')
    expect(text).toContain('Session: <code>11fa1a35</code>')
    expect(buildMessage({ ...FACTS, kind: 'failure', summary: undefined, detail: 'rate_limit' })).toContain('Error: rate_limit')
  })

  test('auto follows Claude Code’s language setting', () => {
    expect(resolveLanguage('auto', '繁體中文')).toBe('zh-TW')
    expect(resolveLanguage('auto', 'Traditional Chinese')).toBe('zh-TW')
    expect(resolveLanguage('auto', 'zh-TW')).toBe('zh-TW')
    expect(resolveLanguage('auto', 'English')).toBe('en')
    expect(resolveLanguage('auto', undefined)).toBe('en')
    expect(resolveLanguage('en', '繁體中文')).toBe('en')
  })

  test('Traditional Chinese messages keep the old hook’s fields', () => {
    const text = buildMessage({
      kind: 'done',
      language: 'zh-TW',
      project: 'a<b>',
      branch: 'main',
      time: '2026-10-08 12:00:00 CST',
      now: 0,
      durationMs: 134_000,
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      costUsd: 0.43,
      ctxPercent: 9,
      rates: [{ kind: 'five_hour', percent: 13, resetsAt: '8100' }, { kind: 'seven_day', percent: 38 }],
      summary: 'done & dusted',
      sessionId: '11fa1a35-c235',
    })
    expect(text).toContain('<b>✅ Claude Code 完成回覆</b>')
    expect(text).toContain('專案：<code>a&lt;b&gt;</code> (main)')
    expect(text).toContain('耗時 2m14s · Opus 5.5 · xhigh · $0.43')
    expect(text).toContain('5h:13%(2h15m) wk:38% ctx:9%(opus)')
    expect(text).toContain('摘要：done &amp; dusted')
    expect(text).toContain('Session：<code>11fa1a35</code>')
  })

  test('summaries drop code blocks and markdown and stay short', () => {
    expect(summarize('**Done.** Ran:\n```sh\nnpm test\n```\nAll `green`.')).toBe('Done. Ran: All green.')
    expect(summarize('x'.repeat(300)).length).toBeLessThanOrEqual(121)
  })
})

describe('scenes', () => {
  const MOODS = ['think', 'tool', 'reply'] as const

  test('there are ten, and every one draws a valid Raster in every mood at every width', () => {
    expect(SCENE_NAMES).toHaveLength(10)
    for (const columns of [16, 32, 56]) {
      const bytes = columns * SCENE_ROWS * 12
      for (const name of SCENE_NAMES) {
        for (const mode of MOODS) {
          const cells = renderScene(name, mode, 1_234, columns)
          expect(cells.length).toBe(4 * Math.ceil(bytes / 3))
          expect(cells).toBe(renderScene(name, mode, 1_234, columns))
        }
      }
    }
  })

  test('every scene moves over time in every mood', () => {
    for (const name of SCENE_NAMES) {
      for (const mode of MOODS) {
        const frames = new Set([0, 700, 1_400, 2_100, 2_800].map(t => renderScene(name, mode, t, 48)))
        expect(frames.size).toBeGreaterThan(1)
      }
    }
  })

  test('the three moods look different in every scene', () => {
    for (const name of SCENE_NAMES) {
      for (const [a, b] of [['think', 'tool'], ['think', 'reply'], ['tool', 'reply']] as const) {
        const differs = [300, 1_100, 1_900, 2_700].some(t => renderScene(name, a, t, 48) !== renderScene(name, b, t, 48))
        expect(differs).toBe(true)
      }
    }
  })

  test('random never repeats the last scene; a fixed choice always wins', () => {
    for (let roll = 0; roll < 1; roll += 0.05) expect(pickScene('random', 'robot', roll)).not.toBe('robot')
    const seen = new Set(Array.from({ length: 40 }, (_, i) => pickScene('random', undefined, i / 40)))
    expect(seen.size).toBe(10)
    expect(pickScene('campfire', 'campfire', 0.5)).toBe('campfire')
  })

  test("the facts beside the scene sum up the turn: tools, output, speed and cost", () => {
    let h = startTurn({ ...emptyHud('p'), costUsd: 2.79 }, 0)
    expect(turnFacts(h, 0)).toBe('0 tools')
    h = startTool(h, { id: 'a', tool: 'Bash', detail: '', startedAt: 1 })
    h = addRequestUsage(h, { input_tokens: 10, output_tokens: 1_200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 25_000)
    h = { ...h, costUsd: 3.21 }
    expect(turnFacts(h, 0)).toBe('1 tool · ↓1k · 48 tok/s · +$0.42')
  })

  test('base64 matches the standard alphabet and padding', () => {
    expect(base64(Uint32Array.of(0x2588))).toBe('iCUAAA==')
  })
})

// Where a managed plugin passes every classic.* hook over, agent rows come from
// agent.spawn, agent.report and turn.complete alone; elsewhere SubagentStart
// and SubagentStop arrive too, in either order. Both must end in one row per
// agent, on the Agent call that started it.
describe('agent rows, native and classic', () => {
  const EXPLORE = { type: 'Explore', isBackground: true }
  const launch = (h: Hud, toolUseId: string, description: string, type = 'Explore') =>
    launchAgent(h, { toolUseId, type, description, isBackground: true, now: 0 })
  const links = (h: Hud) => h.agents.map(a => [a.description, a.agentId ?? null, a.status])

  test('a workflow agent gets a row of its own and leaves a pending Agent launch alone', () => {
    let h = launch(emptyHud('p'), 'tuA', 'explore auth')
    h = spawnAgent(h, { toolUseId: 'wf-call', agentId: 'wf1', type: 'general-purpose', description: 'workflow agent 1', isWorkflow: true, now: 1 })
    h = spawnAgent(h, { toolUseId: 'tuA', agentId: 'ex1', ...EXPLORE, now: 2 })
    expect(links(h)).toEqual([
      ['explore auth', 'ex1', 'running'],
      ['workflow agent 1', 'wf1', 'running'],
    ])
  })

  test('a fork no tool call starts never takes a launch row', () => {
    let h = launch(emptyHud('p'), 'tuA', 'explore', 'fork')
    h = spawnAgent(h, { toolUseId: '', agentId: 'fk1', type: 'fork', isWorkflow: true, now: 1 })
    expect(links(h)).toEqual([
      ['explore', null, 'running'],
      ['', 'fk1', 'running'],
    ])
  })

  test('a workflow agent’s run ends at its own turn.complete; another agent’s only pauses', () => {
    let h = spawnAgent(emptyHud('p'), { toolUseId: 'wf-call', agentId: 'wf1', type: 'general-purpose', isWorkflow: true, now: 0 })
    h = spawnAgent(h, { toolUseId: 'tuB', agentId: 'bg1', type: 'Plan', now: 0 })
    h = agentTurnEnded(h, 'wf1', 30_000)
    h = agentTurnEnded(h, 'bg1', 30_000)
    expect(h.agents.map(a => [a.agentId, a.status, a.workingSince])).toEqual([
      ['wf1', 'done', undefined],
      ['bg1', 'running', undefined],
    ])
  })

  test('classic first: a SubagentStart guess on the wrong launch gives way to the exact spawn', () => {
    let h = launch(launch(emptyHud('p'), 'tuA', 'a'), 'tuB', 'b')
    h = linkAgent(h, 'exB', 'Explore', 1) // guesses the oldest Explore launch: tuA
    h = startTool(h, { id: 'g', tool: 'Grep', detail: '', startedAt: 2, agentId: 'exB' })
    h = spawnAgent(h, { toolUseId: 'tuB', agentId: 'exB', ...EXPLORE, now: 3 })
    h = spawnAgent(h, { toolUseId: 'tuA', agentId: 'exA', ...EXPLORE, now: 4 })
    expect(links(h)).toEqual([
      ['a', 'exA', 'running'],
      ['b', 'exB', 'running'],
    ])
    expect(h.agents.map(a => [a.tools, a.link])).toEqual([
      [0, 'exact'],
      [1, 'exact'],
    ])
  })

  test('native first: a later SubagentStart changes nothing', () => {
    let h = launch(launch(emptyHud('p'), 'tuA', 'a'), 'tuB', 'b')
    h = spawnAgent(h, { toolUseId: 'tuB', agentId: 'exB', ...EXPLORE, now: 1 })
    expect(linkAgent(h, 'exB', 'Explore', 2)).toBe(h)
  })

  test('classic first with a workflow agent: the launch it borrowed is freed for its own spawn', () => {
    let h = launch(emptyHud('p'), 'tuA', 'review', 'general-purpose')
    h = linkAgent(h, 'wf1', 'general-purpose', 1)
    h = spawnAgent(h, { toolUseId: 'wf-call', agentId: 'wf1', type: 'general-purpose', description: 'workflow agent 1', isWorkflow: true, now: 2 })
    h = spawnAgent(h, { toolUseId: 'tuA', agentId: 'gp1', type: 'general-purpose', now: 3 })
    expect(links(h)).toEqual([
      ['review', 'gp1', 'running'],
      ['workflow agent 1', 'wf1', 'running'],
    ])
  })

  test('a SubagentStart of another type lists the agent alone; the Agent result folds that row in', () => {
    let h = launch(emptyHud('p'), 'tuA', 'a', 'lab:runner')
    h = linkAgent(h, 'ag1', 'runner', 1)
    h = startTool(h, { id: 'x', tool: 'Bash', detail: '', startedAt: 2, agentId: 'ag1' })
    h = agentResult(h, 'tuA', { agentId: 'ag1', isLaunchOnly: false, isError: false }, 9)
    expect(links(h)).toEqual([['a', 'ag1', 'done']])
    expect(h.agents[0]?.tools).toBe(1)
  })

  test('agent.report ends a run with its status, and corrects one the roster ended first', () => {
    const running = () => spawnAgent(emptyHud('p'), { toolUseId: 'tu', agentId: 'ag1', type: 'Explore', now: 0 })
    expect(reportAgent(running(), 'ag1', 'completed', 5).agents[0]).toMatchObject({ status: 'done', endedAt: 5 })
    expect(reportAgent(running(), 'ag1', 'stopped', 5).agents[0]).toMatchObject({ status: 'stopped', endedAt: 5 })
    const byRoster = reconcileAgents(running(), [{ id: 'ag1', status: 'completed' }], 4)
    expect(reportAgent(byRoster, 'ag1', 'failed', 5).agents[0]).toMatchObject({ status: 'failed', endedAt: 4 })
    expect(reportAgent(byRoster, 'ag1', 'completed', 5)).toBe(byRoster)
  })

  test('an agent resumed under its id runs again', () => {
    let h = spawnAgent(emptyHud('p'), { toolUseId: 'tu', agentId: 'ag1', type: 'Explore', now: 0 })
    h = reportAgent(h, 'ag1', 'completed', 10)
    h = spawnAgent(h, { toolUseId: 'send', agentId: 'ag1', type: 'Explore', isResume: true, now: 20 })
    expect(h.agents).toHaveLength(1)
    expect(h.agents[0]).toMatchObject({ status: 'running', workingSince: 20, endedAt: undefined })
  })

  test('a teammate’s calls make no agent row, and a row a guess made for one goes', () => {
    let h = startTool(emptyHud('p'), { id: 'm', tool: 'Read', detail: '', startedAt: 0, agentId: 'mate1' })
    expect(h.agents).toEqual([])
    h = linkAgent(h, 'mate1', 'reviewer', 1)
    h = reconcileAgents(h, [{ id: 'mate1', status: 'idle', teammateId: 'reviewer@team' }], 2)
    expect(h.agents).toEqual([])
  })

  test('the roster’s token figures give a running row its context share and last readings', () => {
    let h = spawnAgent(emptyHud('p'), { toolUseId: 'tu', agentId: 'ag1', type: 'Explore', now: 0 })
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    h = reconcileAgents(h, [{ id: 'ag1', status: 'running', tokenCount: 50_000, contextWindowSize: 200_000, tokenSamples: samples }], 5)
    expect(h.agents[0]).toMatchObject({ ctxPercent: 25, samples: [3, 4, 5, 6, 7, 8, 9, 10] })
    const same = reconcileAgents(h, [{ id: 'ag1', status: 'running', tokenCount: 50_000, contextWindowSize: 200_000, tokenSamples: samples }], 6)
    expect(same).toBe(h)
  })

  test('an ended row is shown for a minute, whether or not anything prunes it', () => {
    const h = reportAgent(spawnAgent(emptyHud('p'), { toolUseId: 'tu', agentId: 'ag1', type: 'Explore', now: 0 }), 'ag1', 'completed', 1_000)
    expect(isAgentShown(h.agents[0]!, 60_999)).toBe(true)
    expect(isAgentShown(h.agents[0]!, 61_000)).toBe(false)
    const band = (now: number) => buildBand(h, now, 200, { warnPercent: 60, criticalPercent: 80 }).map(rowText).join('\n')
    expect(band(30_000)).toContain('✓ Explore')
    expect(band(61_000)).not.toContain('Explore')
  })
})

describe('prompt cache lifetime', () => {
  const usage = (extra: object) => ({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 100, ...extra })

  test('a request’s writes name the lifetime; a read keeps it and renews it from when it was sent', () => {
    let h = addRequestUsage(emptyHud('p'), usage({ ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100 }), 1_000, 10_000)
    expect(cacheRemainingMs(h.cache, 10_000)).toBe(3_600_000)
    h = addRequestUsage(h, usage({ cache_creation_input_tokens: 0 }), 1_000, 50_000)
    expect(h.cache?.ttl).toBe('1h')
    expect(cacheRemainingMs(h.cache, 50_000)).toBe(3_600_000)
    h = addRequestUsage(h, usage({ ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 }), 1_000, 60_000)
    expect(cacheRemainingMs(h.cache, 60_000 + 300_000)).toBe(0)
  })

  test('no lifetime is shown while none is known', () => {
    const h = addRequestUsage(emptyHud('p'), usage({}), 1_000, 0)
    expect(cacheRemainingMs(h.cache, 0)).toBeUndefined()
  })

  test('the idle band counts down, then says cold', () => {
    let h = startTurn(emptyHud('p'), 0)
    h = addRequestUsage(h, usage({ ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 }), 1_000, 0)
    const working = buildBand(h, 10_000, 200, { warnPercent: 60, criticalPercent: 80 }).map(rowText).join('\n')
    expect(working).not.toContain('⏳')
    h = completeTurn(h, 20_000, 20_000)
    const at = (now: number) => buildBand(h, now, 200, { warnPercent: 60, criticalPercent: 80 }).map(rowText).join('\n')
    expect(at(60_000)).toContain('⏳4m')
    expect(at(260_000)).toContain('⏳40s')
    expect(at(300_000)).toContain('cache cold')
  })
})

describe('turn outcome and step recap', () => {
  const band = (h: Hud) => buildBand(h, 10_000, 200, { warnPercent: 60, criticalPercent: 80 }).map(rowText)

  test('the idle band says how the last turn ended', () => {
    const ended = (outcome: 'answer' | 'aborted' | 'error') => band(completeTurn(startTurn(emptyHud('p'), 0), 5_000, 5_000, outcome))[2]
    expect(ended('answer')).toContain('○ idle · turn 1')
    expect(ended('aborted')).toContain('⏹ interrupted · turn 1')
    expect(ended('error')).toContain('✗ error · turn 1')
  })

  test('a recap shows under the activity row for its own turn only', () => {
    let h = startTurn(emptyHud('p'), 0)
    h = setRecap(h, '正在修正 agent 列連結', 1)
    expect(band(h)[3]).toBe('  ↳ 正在修正 agent 列連結')
    expect(setRecap(h, 'stale', 0)).toBe(h)
    expect(band(startTurn(h, 9_000)).join('\n')).not.toContain('↳ 正在')
  })

  test('the recap request names the language, numbers the steps and keeps the last twelve', () => {
    const steps = Array.from({ length: 14 }, (_, i) => ({ tool: i === 13 ? 'mcp__lab__run' : 'Read', detail: `f${i + 1}.ts`, isError: i === 12 }))
    const { system, prompt } = recapRequest({ language: 'zh-TW', task: 'fix the agent rows', steps, note: 'Tests pass now.', runningAgents: 2 })
    expect(system).toContain('Traditional Chinese as used in Taiwan')
    expect(prompt).toContain('Task: fix the agent rows')
    expect(prompt).toContain('Steps so far (14, the first 2 left out):')
    expect(prompt).not.toContain('f2.ts')
    expect(prompt).toContain('3. Read: f3.ts')
    expect(prompt).toContain('13. Read: f13.ts (failed)')
    expect(prompt).toContain('14. lab:run: f14.ts')
    expect(prompt).toContain("The agent's latest note: Tests pass now.")
    expect(prompt).toContain('Subagents running: 2')
  })

  test('a recap answer is cleaned to one plain line', () => {
    expect(cleanRecap('進度：「正在跑測試」\n第二行')).toBe('正在跑測試')
    expect(cleanRecap('Recap: "Editing band.ts"')).toBe('Editing band.ts')
    expect(cleanRecap('\u001b[31mred\u001b[0m text')).toBe('red text')
    expect(cleanRecap('x'.repeat(200))).toHaveLength(120)
  })

  test('recap is off by default and its model can be set per project', () => {
    expect(resolveConfig({}, []).config).toMatchObject({ recap: false, recapModel: 'haiku' })
    const { config, warnings } = resolveConfig({}, [{ source: 'p', values: { recap: true, recapModel: 'sonnet' } }])
    expect(config).toMatchObject({ recap: true, recapModel: 'sonnet' })
    expect(warnings).toEqual([])
    expect(resolveConfig({ recap: 'yes', recapModel: ' ' }, []).warnings).toHaveLength(2)
  })
})

describe('agent views', () => {
  test('the line under an Agent call: model, time, tools, context and how its tokens grew', () => {
    let h = launchAgent(emptyHud('p'), { toolUseId: 'tu', type: 'Explore', description: 'find', model: 'claude-haiku-5-5', isBackground: false, now: 0 })
    h = spawnAgent(h, { toolUseId: 'tu', agentId: 'ag1', type: 'Explore', now: 0 })
    h = startTool(h, { id: 'g', tool: 'Grep', detail: '', startedAt: 1_000, agentId: 'ag1' })
    h = reconcileAgents(h, [{ id: 'ag1', status: 'running', tokenCount: 68_000, contextWindowSize: 200_000, tokenSamples: [10, 20, 40] }], 2_000)
    expect(agentSummary(h.agents[0]!, 42_000)).toBe('  ↳ ◑ Explore · Haiku 5.5 · 0:42 · 1 tools · ctx 34% ▁▃█ ▸ Grep')
  })

  test('the pane lists every agent with its task, then the other workers', () => {
    let h = spawnAgent(emptyHud('p'), { toolUseId: 'tu', agentId: 'ag1', type: 'Plan', description: 'plan the fix', now: 0 })
    h = reportAgent(h, 'ag1', 'stopped', 5_000)
    h = setTeammates(h, [{ id: 'm1', teammateId: 'rev@t', name: 'rev', status: 'idle', description: 'review' }])
    const rows = paneRows(h, 600_000).map(row => row.map(seg => seg.text).join(''))
    expect(rows[0]).toContain('⏹ Plan')
    expect(rows[1]).toBe('   plan the fix')
    expect(rows[2]).toContain('◇ rev · idle')
    expect(paneRows(emptyHud('p'), 0).map(row => row.map(seg => seg.text).join(''))).toEqual(['No agents in this session yet.'])
  })

  test('a sparkline spans its lowest to highest reading', () => {
    expect(sparkline([0, 2, 14])).toBe('▁▂█')
    expect(sparkline([5, 5])).toBe('▁▁')
    expect(sparkline([])).toBe('')
  })
})
