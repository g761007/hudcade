import type { On } from 'claude-code'
import { describe, expect, mock, test, type Engine } from 'claude-code/testing'

const PLUGIN = 'hudcade'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 8,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 8 },
  view: {},
} as never

const SPINNER_PROPS = { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' } as never

// Stands in for the engine's own drawing beneath the plugin.
function engineDraws(on: On): void {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
}

// The session facts a Telegram message reads, answered as the engine would.
function session(on: On): void {
  on('session.root', () => ({ value: '/work/claude-mods' }))
  on('session.id', () => ({ value: '11fa1a35-c235-406a' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 90_000, window: 1_000_000, percent: 9 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 13 }],
      cost: { usd: 0.43 },
    },
  }))
}

// The whole band as one string: every Text segment of every row, in order.
async function bandText($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string> {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map(t => t.text).join('')
}

// The `/hud agents` pane: the agent rows live there, not on the band.
function mountPane($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: 'hudcade-agents',
    props: { title: 'hudcade · agents', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
}

async function paneText($: Engine): Promise<string> {
  const ui = await mountPane($)
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map(t => t.text).join('')
}

describe('band', () => {
  test('draws model, cost and progress on terminal and desktop', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* () {
      return undefined
    })
    on('tool.call', () => ({ result: { stdout: '', stderr: '' }, text: '' }) as never)

    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests' } as never)

    // The terminal's pixel spinner shows the turn's clock and tool calls; the desktop has none.
    expect(await bandText($, 'desktop')).toMatch(/working \d+:\d\d.*tools 1/)
    const terminal = await bandText($, 'terminal')
    expect(terminal).toContain('working · turn 1')
    expect(terminal).not.toContain('tools 1')
  })

  test('with the spinner off, the terminal band keeps the turn’s clock and tool calls', { options: { spinner: false } }, async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('tool.call', () => ({ result: { stdout: '', stderr: '' }, text: '' }) as never)

    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests' } as never)
    expect(await bandText($, 'terminal')).toMatch(/working \d+:\d\d.*tools 1/)
  })

  // classic.SessionStart is passed over under a managed seat; the test raises none.
  test('a /clear drops the prompt cache figures', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2_990, cache_creation_input_tokens: 0 }
    on('turn.step', async function* (_$, e) {
      yield { kind: 'stop', stopReason: 'end_turn', usage } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
    })
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    const bandShowsCache = async () => {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
      const found = await ui.find({ type: 'Text', text: 'cache ' })
      await ui.unmount()
      return found !== undefined
    }

    for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
      // The request's one chunk carries its usage.
    }
    expect(await bandShowsCache()).toBe(true)

    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(await bandShowsCache()).toBe(false)
  })

  test('stays out of the way when the hud module is off', { options: { hud: false } }, async ($, on) => {
    engineDraws(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: /idle|working/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
    await ui.unmount()
  })
})

describe('agents', () => {
  const BACKGROUND_AGENT = { tool: 'Agent', description: 'probe', prompt: 'p', subagent_type: 'general-purpose', run_in_background: true } as never

  // A background Agent call answers with its id alone; no SubagentStop follows.
  function launchesInBackground(on: On, roster: () => string): void {
    on('tool.call', () => ({ result: { status: 'async_launched', agentId: 'ag1' }, text: '' }) as never)
    on('agent.list', () => ({ value: [{ id: 'ag1', type: 'general-purpose', description: 'probe', status: roster() }] }) as never)
  }

  async function paneShowsDone($: Engine, surface: 'terminal' | 'desktop'): Promise<boolean> {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: 'general-purpose' })).toBeDefined()
    const isDone = (await ui.find({ type: 'Text', text: '✓ ' })) !== undefined
    await ui.unmount()
    return isDone
  }

  test('a background agent the roster calls completed shows ✓ once the main turn ends', async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    launchesInBackground(on, () => 'completed')
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)

    await $.tool.call(BACKGROUND_AGENT)
    for (const surface of ['terminal', 'desktop'] as const) expect(await paneShowsDone($, surface)).toBe(false)

    await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.settle()
    for (const surface of ['terminal', 'desktop'] as const) expect(await paneShowsDone($, surface)).toBe(true)
  })

  // Telegram messages sent, and a background agent left running when the turn ends.
  async function agentOutlivesTurn($: Engine, on: On): Promise<{ sent: string[] }> {
    session(on)
    const sent: string[] = []
    on('http.fetch', (_$, e) => {
      sent.push((JSON.parse(String(e.init?.body ?? '{}')) as { text: string }).text)
      return { value: { status: 200, ok: true, headers: {}, text: '' } }
    })
    on('process.run', () => ({ value: { exitCode: 0, stdout: '2026-11-20 18:00:00 CST\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
    on('agent.report', (_$, e) => ({ text: e.text }) as never)
    launchesInBackground(on, () => 'running')

    await $.turn.start({ text: 'audit the skills', turnId: 't1' })
    await $.tool.call(BACKGROUND_AGENT)
    await $.turn.complete({ answer: 'Started an agent.', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    return { sent }
  }

  const NOTIFY = { options: { telegramBotToken: 'T', telegramChatId: '1', notifyLanguage: 'en' } }
  const REPORT = { agentId: 'ag1', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, text: 'done' }

  test('once the background agents a turn left running have all ended, Telegram hears once', NOTIFY, async ($, on) => {
    const clock = mock.clock(on)
    const { sent } = await agentOutlivesTurn($, on)
    const agentNotices = () => sent.filter(text => text.includes('background agents are done'))

    await $.agent.report({ ...REPORT, status: 'completed' } as never)
    await clock.advance(9_000)
    expect(agentNotices()).toHaveLength(0)
    await clock.advance(1_000)
    for (let i = 0; i < 20 && agentNotices().length === 0; i++) await clock.advance(10)
    expect(agentNotices()).toHaveLength(1)
    expect(agentNotices()[0]).toContain('✓ general-purpose · probe')

    await $.agent.report({ ...REPORT, status: 'completed' } as never)
    await clock.advance(30_000)
    expect(agentNotices()).toHaveLength(1)
  })

  test('a turn started before the background agents end sends no agents notice', NOTIFY, async ($, on) => {
    const clock = mock.clock(on)
    const { sent } = await agentOutlivesTurn($, on)

    await $.turn.start({ text: 'next', turnId: 't2' })
    await $.agent.report({ ...REPORT, status: 'failed' } as never)
    await clock.advance(30_000)
    expect(sent.some(text => text.includes('background agents are done'))).toBe(false)
  })

  test('while a turn runs, the roster is read every 15 seconds', async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    let status = 'running'
    launchesInBackground(on, () => status)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))

    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.tool.call(BACKGROUND_AGENT)
    await clock.advance(15_000)
    expect(await paneShowsDone($, 'terminal')).toBe(false)

    status = 'completed'
    await clock.advance(14_000)
    expect(await paneShowsDone($, 'terminal')).toBe(false)
    await clock.advance(1_000)
    expect(await paneShowsDone($, 'terminal')).toBe(true)
  })

  // classic.SubagentStart is passed over under a managed seat; the test raises none.
  test('a foreground agent is linked as it spawns, so its row shows its model while it runs', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    let reached = () => {}
    const isReached = new Promise<void>(resolve => (reached = resolve))
    let release = () => {}
    const isReleased = new Promise<void>(resolve => (release = resolve))
    on('tool.call', async () => {
      reached()
      await isReleased
      return { result: { status: 'completed', agentId: 'ag1' }, text: '' } as never
    })
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
    })

    const call = $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: 'probe', prompt: 'p', subagent_type: 'Explore' } as never)
    await isReached
    await $.agent.spawn({
      tool_use_id: 'tu1',
      prompt: 'p',
      description: 'probe',
      subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    } as never)
    for await (const _chunk of $.turn.step({ turnId: 'r1', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'ag1' })) {
      // The request streams nothing.
    }

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: ' · Haiku 5.5' })).toBeDefined()
    await ui.unmount()
    release()
    await call
  })

  test('an agent’s clock stops when its run ends and picks up with its next request', async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    on('tool.call', () => ({ result: { status: 'async_launched', agentId: 'ag1' }, text: '' }) as never)
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
    })
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
    const paneShows = async (worked: string) => {
      const ui = await mountPane($)
      const found = await ui.find({ type: 'Text', text: ` · ${worked} · 0 tools` })
      await ui.unmount()
      return found !== undefined
    }

    await $.tool.call(BACKGROUND_AGENT)
    await clock.advance(10_000)
    await $.turn.complete({ answer: 'ok', durationMs: 10_000, isAborted: false, turnId: 'r1', reason: 'answer', agentId: 'ag1' } as never)
    await clock.advance(60_000)
    expect(await paneShows('0:10')).toBe(true)

    for await (const _chunk of $.turn.step({ turnId: 'r2', index: 0, model: 'claude-haiku-5-5', messageCount: 3, agentId: 'ag1' })) {
      // The request streams nothing.
    }
    await clock.advance(5_000)
    expect(await paneShows('0:15')).toBe(true)
  })
})

describe('spinner', () => {
  test('plays a pixel scene in the terminal', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    await $.turn.start({ text: 'hi', turnId: 't1' })

    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'Spinner',
      props: SPINNER_PROPS,
      viewport: { columns: 100, rows: 30 },
    })
    expect(await ui.find({ type: 'Raster', key: 'scene' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^0 tools$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sauteing…/ })).toBeDefined()
    await ui.unmount()
  })

  test('leaves the desktop spinner to the engine', async ($, on) => {
    engineDraws(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Spinner', props: SPINNER_PROPS })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
    await ui.unmount()
  })
})

describe('notify', () => {
  const OPTIONS = { options: { telegramBotToken: 'BOT-TOKEN', telegramChatId: '42', notifyLanguage: 'zh-TW' } }

  test('a completed turn sends one Telegram message with the old fields', OPTIONS, async ($, on) => {
    const clock = mock.clock(on)
    session(on)
    const sent: { url: string; body: string }[] = []
    on('http.fetch', (_$, e) => {
      sent.push({ url: e.url, body: e.init?.body ?? '' })
      return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }
    })
    on('process.run', () => ({
      value: { exitCode: 0, stdout: '2026-10-08 18:00:00 CST\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)

    await $.turn.complete({ answer: '**Done.** All tests pass.', durationMs: 134_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    for (let i = 0; i < 20 && sent.length === 0; i++) await clock.advance(10)

    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe('https://api.telegram.org/botBOT-TOKEN/sendMessage')
    const body = JSON.parse(sent[0]!.body) as { chat_id: string; text: string; parse_mode: string }
    expect(body.chat_id).toBe('42')
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toContain('✅ Claude Code 完成回覆')
    expect(body.text).toContain('耗時 2m14s')
    expect(body.text).toContain('摘要：Done. All tests pass.')
    expect(body.text).toContain('專案：<code>claude-mods</code>')
    expect(body.text).toContain('5h:13% ctx:9%')
    expect(body.text).toContain('時間：2026-10-08 18:00:00 CST')
  })

  test('on auto, the message follows Claude Code’s language setting', { options: { telegramBotToken: 'T', telegramChatId: '1' } }, async ($, on) => {
    const clock = mock.clock(on)
    session(on)
    on('settings.read', () => ({ value: { language: 'English' } }) as never)
    const sent: string[] = []
    on('http.fetch', (_$, e) => {
      sent.push(e.init?.body ?? '')
      return { value: { status: 200, ok: true, headers: {}, text: '' } }
    })
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)

    await $.turn.complete({ answer: 'Done.', durationMs: 5_000, isAborted: false, turnId: 't', reason: 'answer' } as never)
    for (let i = 0; i < 20 && sent.length === 0; i++) await clock.advance(10)
    const text = (JSON.parse(sent[0]!) as { text: string }).text
    expect(text).toContain('✅ Claude Code is done')
    expect(text).toContain('Summary: Done.')
  })

  test('subagent turns and aborted turns stay quiet', OPTIONS, async ($, on) => {
    const clock = mock.clock(on)
    session(on)
    let calls = 0
    on('http.fetch', () => {
      calls += 1
      return { value: { status: 200, ok: true, headers: {}, text: '' } }
    })
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)

    await $.turn.complete({ answer: 'x', durationMs: 90_000, isAborted: false, turnId: 'a', reason: 'answer', agentId: 'ag1' } as never)
    await $.turn.complete({ answer: 'x', durationMs: 90_000, isAborted: true, turnId: 'b', reason: 'aborted' } as never)
    for (let i = 0; i < 5; i++) await clock.advance(10)
    expect(calls).toBe(0)
  })
})

// Where a managed plugin passes every classic.* hook over, the native events
// below are all the mod hears; the tests raise no classic agent event.
describe('agents without classic hooks', () => {
  const SPAWN = { prompt: 'p', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', fork: false }

  // An Agent call held open, as a foreground agent's call is while it runs.
  function holdsAgentCall(on: On, agentId: string): { isReached: Promise<void>; release: () => void } {
    let reached = () => {}
    let release = () => {}
    const isReached = new Promise<void>(resolve => (reached = resolve))
    const isReleased = new Promise<void>(resolve => (release = resolve))
    on('tool.call', async () => {
      reached()
      await isReleased
      return { result: { status: 'completed', agentId }, text: '' } as never
    })
    return { isReached, release }
  }

  test('a subagent’s turn.start starts no turn of the band', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))

    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.turn.start({ text: 'p', turnId: 'r1', agentId: 'ag1' })
    const band = await bandText($)
    expect(band).toContain('turn 1')
    expect(band).not.toContain('turn 2')
  })

  test('a workflow’s agent gets a row of its own and ends at its turn.complete', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: 'workflow' in e && e.workflow ? 'wf1' : 'ex1' }) as never)
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
    const call = holdsAgentCall(on, 'ex1')

    const running = $.tool.call({ tool: 'Agent', tool_use_id: 'tuA', description: 'explore auth', prompt: 'p', subagent_type: 'Explore' } as never)
    await call.isReached
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'wf-call', description: 'review step', subagentType: 'general-purpose', background: true, workflow: { runId: 'wf_1', agentIndex: 1 } } as never)
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tuA', description: 'explore auth', subagentType: 'Explore', background: false } as never)
    await $.turn.complete({ answer: '', durationMs: 5_000, isAborted: false, turnId: 'w', reason: 'answer', agentId: 'wf1' } as never)

    const pane = await paneText($)
    expect(pane).toContain('✓ general-purpose')
    expect(pane).toContain('review step')
    expect(pane).toMatch(/[◐◓◑◒] Explore/)
    expect(pane).toContain('explore auth')
    expect(await bandText($)).not.toContain('Explore')
    call.release()
    await running
  })

  test('an agent’s report says how its run ended, and passes on untouched', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'bg1' }) as never)
    on('agent.report', (_$, e) => ({ text: e.text }) as never)

    await $.agent.spawn({ ...SPAWN, tool_use_id: '', description: 'scan', subagentType: 'Plan', background: true } as never)
    const reported = await $.agent.report({ agentId: 'bg1', subagentType: 'Plan', provider: SPAWN.provider, status: 'stopped', text: 'partial' } as never)
    expect(reported.text).toBe('partial')
    expect(await paneText($)).toContain('⏹ Plan')
  })

  test('a running agent’s call row gets a line of its live state; other rows are left alone', async ($, on) => {
    mock.clock(on)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>ROW</Text>
    })
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ex1' }) as never)
    const call = holdsAgentCall(on, 'ex1')
    const row = (tool: string) =>
      $.ui.mount({
        plugin: PLUGIN,
        surface: 'terminal',
        component: 'ToolUse',
        requestId: 'tuA',
        props: { tool_use_id: 'tuA', tool, input: {}, isRunning: true, isErrored: false, isInterrupted: false },
      } as never)

    const running = $.tool.call({ tool: 'Agent', tool_use_id: 'tuA', description: 'explore auth', prompt: 'p', subagent_type: 'Explore' } as never)
    await call.isReached
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tuA', description: 'explore auth', subagentType: 'Explore', background: false } as never)

    const agentRow = await row('Agent')
    expect(await agentRow.find({ type: 'Text', text: 'ROW' })).toBeDefined()
    expect((await agentRow.find({ type: 'Text', text: /↳/ }))?.text).toMatch(/^ {2}↳ [◐◓◑◒] Explore · 0:00 · 0 tools$/)
    await agentRow.unmount()
    const bashRow = await row('Bash')
    expect((await bashRow.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['ROW'])
    await bashRow.unmount()
    call.release()
    await running
  })

  test('/hud agents opens the agents pane, which lists each agent with its task', async ($, on) => {
    mock.clock(on)
    const opened: string[] = []
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } } as never
    })
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }) as never)

    await $.agent.spawn({ ...SPAWN, tool_use_id: '', description: 'scan the repo', subagentType: 'Explore', background: true } as never)
    const answer = await $.command.run({ command: 'hud', args: 'agents' } as never)
    expect(answer).toMatchObject({ text: 'Agents pane opened.' })
    expect(opened).toEqual(['hudcade-agents'])
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'Pane',
      requestId: 'hudcade-agents',
      props: { title: 'hudcade · agents', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    } as never)
    expect(await ui.find({ type: 'Text', text: '   scan the repo' })).toBeDefined()
    await ui.unmount()
  })
})

describe('waiting for the person without classic hooks', () => {
  const OPTIONS = { options: { telegramBotToken: 'T', telegramChatId: '1', notifyLanguage: 'en' } }
  const CHECK = { tool: 'Bash', input: { command: 'git push', description: 'Push the branch' }, tool_use_id: 'tu1', approver: 'person' }

  function telegram(on: On): string[] {
    const sent: string[] = []
    on('http.fetch', (_$, e) => {
      sent.push((JSON.parse(String(e.init?.body ?? '{}')) as { text: string }).text)
      return { value: { status: 200, ok: true, headers: {}, text: '' } }
    })
    on('process.run', () => ({ value: { exitCode: 0, stdout: 'now\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
    return sent
  }

  test('an ask the mode puts to the person shows as waiting and notifies once, though Notification follows', OPTIONS, async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    session(on)
    const sent = telegram(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('tool.check', () => ({ decision: 'ask' }) as never)
    on('tool.run', () => ({ result: { stdout: '', stderr: '' } }) as never)
    on('classic.Notification', () => ({}) as never)

    await $.turn.start({ text: 'push it', turnId: 't1' })
    await $.tool.check(CHECK as never)
    await clock.advance(1_000)
    expect(await bandText($)).not.toContain('waiting for you')
    await clock.advance(600)
    expect(await bandText($)).toContain('waiting for you')
    for (let i = 0; i < 20 && sent.length === 0; i++) await clock.advance(10)
    await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' } as never)
    for (let i = 0; i < 20; i++) await clock.advance(10)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('needs your approval')
    expect(sent[0]).toContain('Bash: Push the branch')

    await $.tool.run({ tool: 'Bash', command: 'git push', tool_use_id: 'tu1' } as never)
    const band = await bandText($)
    expect(band).toContain('working')
    expect(band).not.toContain('waiting for you')
  })

  test('in auto mode, a call the classifier settles reaches nobody', OPTIONS, async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    session(on)
    const sent = telegram(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('tool.check', () => ({ decision: 'ask' }) as never)
    on('tool.judge', () => ({ decision: 'allow' }) as never)

    await $.turn.start({ text: 'push it', turnId: 't1' })
    await $.tool.check(CHECK as never)
    await $.tool.judge(CHECK as never)
    await clock.advance(3_000)
    expect(await bandText($)).not.toContain('waiting for you')
    expect(sent).toEqual([])
  })
})

describe('compactions without classic hooks', () => {
  test('a compaction counts once, heard natively and classically; a skipped one counts none', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    let isSkipped = true
    const summary = { role: 'user', text: 'Summary of the conversation so far.', toolUses: [] }
    on('session.compact', () => (isSkipped ? { skip: 'not now' } : { messages: [summary] }) as never)
    on('classic.PostCompact', () => ({}) as never)

    await $.session.compact({ messages: [summary] } as never)
    expect(await bandText($)).not.toContain('⟲')
    isSkipped = false
    await $.session.compact({ messages: [summary] } as never)
    await $.classic.PostCompact({ trigger: 'auto', compact_summary: 's' } as never)
    expect(await bandText($)).toContain('⟲1')
  })
})

describe('prompt cache countdown', () => {
  test('after a turn, the band counts down the cache lifetime the last request renewed', async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 100, ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 }
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* (_$, e) {
      yield { kind: 'stop', stopReason: 'end_turn', usage } as never
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
    })
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)

    await $.turn.start({ text: 'hi', turnId: 't1' })
    for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
      // The request's one chunk carries its usage.
    }
    await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    expect(await bandText($)).toContain('⏳')
    await clock.advance(300_000)
    expect(await bandText($)).toContain('cache cold')
  })
})

describe('step recap', () => {
  function model(on: On, reply: string): { prompt: string; model: string }[] {
    const calls: { prompt: string; model: string }[] = []
    on('model.complete', (_$, e) => {
      calls.push({ prompt: e.prompt, model: e.model })
      return { value: { isAnswered: true, text: reply, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
    })
    return calls
  }

  function works(on: On): void {
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('tool.call', () => ({ result: { stdout: '', stderr: '' }, text: '' }) as never)
  }

  test('after a step, a small model sums up the turn in the band, at most once per ten seconds', { options: { recap: true } }, async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    works(on)
    const calls = model(on, '進度：正在跑測試')

    await $.turn.start({ text: '修好 agent 列', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests' } as never)
    for (let i = 0; i < 10; i++) await clock.advance(10)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toBe('haiku')
    expect(calls[0]!.prompt).toContain('Task: 修好 agent 列')
    expect(calls[0]!.prompt).toContain('1. Bash: Run tests')
    expect(await bandText($)).toContain('↳ 正在跑測試')

    await $.tool.call({ tool: 'Read', file_path: '/work/band.ts' } as never)
    await clock.advance(5_000)
    expect(calls).toHaveLength(1)
    await clock.advance(5_200)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.prompt).toContain('2. Read: band.ts')
  })

  test('off by default: no model is called', async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    works(on)
    const calls = model(on, 'x')

    await $.turn.start({ text: 'hi', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    await clock.advance(20_000)
    expect(calls).toEqual([])
  })
})
