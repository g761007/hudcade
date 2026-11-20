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
      sent.push({ url: e.url, body: String(e.init?.body ?? '') })
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
      sent.push(String(e.init?.body ?? ''))
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

describe('turn replay', () => {
  // A docked pane: tall and narrow.
  const PANE_PROPS = { title: 'hudcade · replay', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} }
  const DONE = { answer: 'ok', durationMs: 5_000, isAborted: false } as const
  const SPAWN = { prompt: 'p', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', fork: false }

  function mountReplay($: Engine, surface: 'terminal' | 'desktop' = 'terminal', props: object = {}) {
    return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'hudcade-replay', props: { ...PANE_PROPS, ...props } } as never)
  }

  async function replayText($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string> {
    const ui = await mountReplay($, surface)
    const texts = await ui.findAll({ type: 'Text' })
    await ui.unmount()
    return texts.map(t => t.text).join('')
  }

  async function press($: Engine, key: string): Promise<void> {
    const ui = await mountReplay($)
    await ui.press({ key })
    await ui.unmount()
  }

  async function buttons($: Engine): Promise<string[]> {
    const ui = await mountReplay($)
    const found = await ui.findAll({ type: 'Button' })
    await ui.unmount()
    return found.map(b => b.key ?? '').filter(key => !key.startsWith('step-'))
  }

  // What the diff view draws, when it is open.
  async function diffShown($: Engine): Promise<string | undefined> {
    const ui = await mountReplay($)
    const code = await ui.find({ type: 'Code' })
    await ui.unmount()
    return code?.props.source as string | undefined
  }

  // The engine beneath: files as they stand, tool calls (an Edit of a path
  // with "refused" in it is refused), panes and frames.
  function engine(on: On, files: Record<string, string> = {}, call?: (tool: string) => unknown): { opened: string[]; opens: unknown[] } {
    const seen = { opened: [] as string[], opens: [] as unknown[] }
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
    on('fs.exists', (_$, e) => ({ value: (e as { path: string }).path in files }) as never)
    on('fs.read', (_$, e) => ({ value: files[(e as { path: string }).path] ?? '' }) as never)
    on('tool.call', (_$, e) => {
      const input = e as unknown as Record<string, unknown>
      const answer = call?.(e.tool)
      if (answer !== undefined) return answer as never
      if (String(input.file_path ?? '').includes('refused')) return { deny: 'The person refused it.' } as never
      return { result: { stdout: '', stderr: '' }, text: '' } as never
    })
    on('ui.open', (_$, e) => {
      seen.opened.push(e.id)
      seen.opens.push(e)
      return { value: { isPlaced: true } } as never
    })
    on('ui.close', () => ({ value: undefined }) as never)
    return seen
  }

  test('opens on the first step and stays there: the person moves, by key or by pressing a step', async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    const seen = engine(on)

    await $.turn.start({ text: 'rename greet to welcome', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/w/src/a.ts' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'greet' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run tests' } as never)
    await $.turn.complete({ ...DONE, turnId: 't1' } as never)

    expect(await bandText($)).toContain('▶ /hud replay (3 steps)')
    expect(await $.command.run({ command: 'hud', args: 'replay' } as never)).toMatchObject({ text: 'Replay of turn 1: 3 steps.' })
    expect(seen.opened).toEqual(['hudcade-replay'])
    expect(await replayText($)).toContain('▶ step 1 / 3')

    // Time alone moves nothing.
    await clock.advance(10_000)
    expect(await replayText($)).toContain('▶ step 1 / 3')

    await press($, 'next')
    expect(await replayText($)).toContain('Grep greet ✓')
    await press($, 'step-2')
    expect(await replayText($)).toContain('▶ step 3 / 3')
    await press($, 'next')
    expect(await replayText($)).toContain('■ done · turn 1')
    await press($, 'prev')
    expect(await replayText($)).toContain('▶ step 3 / 3')
  })

  test('an edit shows its lines; its diff, read before it ran, opens on d, refused ones too, and n goes to the next one with a diff', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    engine(on, { '/w/a.ts': 'one\ntwo\nthree\n', '/w/refused.ts': 'x\n' })

    await $.turn.start({ text: 'fix it', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'two', new_string: 'TWO\nmore' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/w/refused.ts', old_string: 'x', new_string: 'y' } as never)
    await $.turn.complete({ ...DONE, turnId: 't1' } as never)
    await $.command.run({ command: 'hud', args: 'replay' } as never)

    expect(await replayText($)).toContain('Edit a.ts +2 −1 ✓')
    expect(await diffShown($)).toBeUndefined()
    expect(await buttons($)).toEqual(['prev', 'next', 'diff', 'close'])

    await press($, 'diff')
    expect(await diffShown($)).toBe(['@@ -1,3 +1,4 @@', ' one', '-two', '+TWO', '+more', ' three'].join('\n'))
    expect(await buttons($)).toEqual(['prev', 'next', 'back', 'close'])
    // The next step with a diff, past the Grep: the refused Edit, as it was asked.
    await press($, 'next')
    expect(await diffShown($)).toBe(['@@ -1,1 +1,1 @@', '-x', '+y'].join('\n'))
    expect(await replayText($)).toContain('Edit refused.ts +1 −1 ✗')
    await press($, 'back')
    expect(await diffShown($)).toBeUndefined()
    expect(await replayText($)).toContain('▶ step 3 / 3')
    // The summary counts the lines of the edit that went through.
    await press($, 'next')
    expect(await replayText($)).toContain('3 steps · 1 failed +2 −1')
  })

  test('a subagent’s calls make a track of its own, entered from its Agent call’s step and left with back', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    // A foreground Agent call runs until its agent is done.
    let reached = () => {}
    const isAgentRunning = new Promise<void>(resolve => (reached = resolve))
    let release = () => {}
    const isAgentDone = new Promise<void>(resolve => (release = resolve))
    engine(on, {}, tool => {
      if (tool !== 'Agent') return undefined
      reached()
      return isAgentDone.then(() => ({ result: { status: 'completed', agentId: 'ag1' }, text: '' }))
    })
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }) as never)

    await $.turn.start({ text: 'where is greet used', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' } as never)
    // The Agent call is noted before it runs; the spawn, as it runs, links it to its agent.
    const agentCall = $.tool.call({ tool: 'Agent', tool_use_id: 'tuA', description: 'find usages', subagent_type: 'Explore', prompt: 'p' } as never)
    await isAgentRunning
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tuA', description: 'find usages', subagentType: 'Explore', background: false } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'greet', agentId: 'ag1', tool_use_id: 'g1' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/w/b.ts', agentId: 'ag1', tool_use_id: 'r1' } as never)
    release()
    await agentCall
    await $.turn.complete({ ...DONE, turnId: 't1' } as never)

    // Its calls are not the main line's.
    expect(await $.command.run({ command: 'hud', args: 'replay' } as never)).toMatchObject({ text: 'Replay of turn 1: 2 steps.' })
    await press($, 'next')
    expect(await replayText($)).toContain('find usages ⤷ 2')
    expect(await buttons($)).toEqual(['prev', 'next', 'agent', 'close'])

    await press($, 'agent')
    let shown = await replayText($)
    expect(shown).toContain('▶ step 1 / 2 · Explore')
    expect(shown).toContain('Grep greet ✓')
    expect(shown).toContain('“find usages”')
    await press($, 'next')
    expect(await replayText($)).toContain('Read b.ts ✓')

    await press($, 'back')
    shown = await replayText($)
    expect(shown).toContain('▶ step 2 / 2 · turn 1')
    expect(shown).toContain('Agent find usages')
  })

  test('a background agent’s calls after its turn ended join its track; a call cut off by the turn’s end is unfinished', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    // A background Agent call answers at once; the Bash call never ends.
    let reached = () => {}
    const isBashRunning = new Promise<void>(resolve => (reached = resolve))
    engine(on, {}, tool => {
      if (tool === 'Agent') return { result: { status: 'async_launched', agentId: 'ag2' }, text: '' }
      if (tool !== 'Bash') return undefined
      reached()
      return new Promise(() => {})
    })
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag2' }) as never)

    await $.turn.start({ text: 'look around', turnId: 't1' })
    const agentCall = $.tool.call({ tool: 'Agent', tool_use_id: 'tuB', description: 'scan the repo', subagent_type: 'Explore', prompt: 'p', run_in_background: true } as never)
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'tuB', description: 'scan the repo', subagentType: 'Explore', background: true } as never)
    await agentCall
    // Interrupted while this runs.
    void $.tool.call({ tool: 'Bash', command: 'sleep 99', description: 'Wait' } as never)
    await isBashRunning
    await $.turn.complete({ ...DONE, isAborted: true, reason: 'aborted', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'todo', agentId: 'ag2', tool_use_id: 'g9' } as never)

    await $.command.run({ command: 'hud', args: 'replay' } as never)
    await press($, 'next')
    expect(await replayText($)).toContain('Bash Wait ⏹')
    await press($, 'next')
    expect(await replayText($)).toContain('2 steps · 1 unfinished · 1 agent')
    await press($, 'step-0')
    await press($, 'agent')
    expect(await replayText($)).toContain('Grep todo ✓')
  })

  test('a step shows its arguments and what it answered; a refused one, why; the pane lists as many steps as fit', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    const seen = engine(on, {}, tool =>
      tool === 'Bash' ? { result: { stdout: 'ok', stderr: '' }, text: 'tests/core.test.ts:\n 132 pass\n 0 fail' } : undefined,
    )
    session(on)

    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'claude plugin test plugin', description: 'Run tests' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/work/claude-mods/plugin/src/core/band.ts' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/work/claude-mods/refused.ts', old_string: 'a', new_string: 'b' } as never)
    for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Grep', pattern: `p${i}` } as never)
    await $.turn.complete({ ...DONE, turnId: 't1' } as never)
    await $.command.run({ command: 'hud', args: 'replay' } as never)
    expect(seen.opens.at(-1)).toMatchObject({ rows: 48, columns: 512 })

    let shown = await replayText($)
    expect(shown).toContain('command      claude plugin test plugin')
    expect(shown).toContain('│  132 pass')
    // Every step listed, docked.
    expect(shown).toContain('  8 ✓ Grep')
    await press($, 'next')
    // A path inside the project, from its root.
    expect(await replayText($)).toContain('file path  plugin/src/core/band.ts')
    await press($, 'next')
    expect(await replayText($)).toContain('│ The person refused it.')

    // A third of a screen: the step, why it was refused, and the steps that fit.
    const ui = await mountReplay($, 'terminal', { bodyColumns: 103, placement: 'inline', scroll: { offset: 0, bodyRows: 11 } })
    shown = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
    expect(shown).toContain('▶ step 3 / 8')
    expect(shown).toContain('│ The person refused it.')
    expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('step-'))).toHaveLength(5)
    await ui.unmount()
  })

  test('the last replay is kept per project, and restored, marked as such, in a session that has none', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    engine(on)
    session(on)
    const kept: Record<string, unknown> = {}
    on('store.set', (_$, e) => {
      kept[e.key] = e.value
      return { value: undefined } as never
    })

    await $.turn.start({ text: 'look', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' } as never)
    await $.turn.complete({ ...DONE, turnId: 't1' } as never)
    expect(kept['replay:/work/claude-mods']).toMatchObject({ sessionId: '11fa1a35-c235-406a', turn: 1, steps: [{ tool: 'Read', detail: 'a.ts' }] })
  })

  test('a session with no replay of its own opens the project’s last one, from an earlier session', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    engine(on)
    session(on)
    const earlier = {
      sessionId: 'an-earlier-session',
      turn: 3,
      task: 'fix the band',
      scene: 'cat',
      startedAt: 0,
      endedAt: 9_000,
      outcome: 'answer',
      steps: [{ callId: 'c1', tool: 'Edit', detail: 'band.ts', startedAt: 1_000, endedAt: 2_000, isError: false, added: 4, removed: 1 }],
      agents: {},
    }
    on('store.get', (_$, e) => ({ value: e.key === 'replay:/work/claude-mods' ? earlier : undefined }) as never)

    expect(await $.command.run({ command: 'hud', args: 'replay' } as never)).toMatchObject({ text: 'Replay of turn 3 from an earlier session: 1 step.' })
    expect(await replayText($)).toContain('Edit band.ts +4 −1 ✓')
  })

  test('past the store’s room, the replay is kept without its diffs', async ($, on) => {
    const clock = mock.clock(on)
    engineDraws(on)
    engine(on, { '/w/a.ts': 'one\ntwo\n' })
    session(on)
    let kept: unknown
    on('store.set', (_$, e) => {
      if (JSON.stringify(e.value).includes('"diff"')) return { deny: 'The store is over 4 MiB.' } as never
      kept = e.value
      return { value: undefined } as never
    })

    await $.turn.start({ text: 'fix it', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/w/a.ts', old_string: 'two', new_string: 'TWO' } as never)
    await $.turn.complete({ ...DONE, turnId: 't1' } as never)
    // The refused write and the one that follows it run after the turn's end.
    await clock.advance(1)
    expect(kept).toMatchObject({ steps: [{ tool: 'Edit', added: 1, removed: 1 }] })
    expect(JSON.stringify(kept)).not.toContain('"diff"')
  })

  test('a turn that calls no tool keeps the last replay; before any, there is nothing to replay; the desktop shows the same', async ($, on) => {
    mock.clock(on)
    engineDraws(on)
    engine(on)

    expect(await $.command.run({ command: 'hud', args: 'replay' } as never)).toMatchObject({
      text: 'Nothing to replay yet: a turn that calls tools can be replayed once it ends.',
    })
    await $.turn.start({ text: 'look', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/w/a.ts' } as never)
    await $.turn.complete({ ...DONE, turnId: 't1' } as never)
    await $.turn.start({ text: 'thanks', turnId: 't2' })
    await $.turn.complete({ ...DONE, turnId: 't2' } as never)

    // The hint is for the turn just ended; the command still finds turn 1.
    expect(await bandText($)).not.toContain('replay')
    expect(await $.command.run({ command: 'hud', args: 'replay' } as never)).toMatchObject({ text: 'Replay of turn 1: 1 step.' })
    expect(await replayText($, 'desktop')).toContain('▶ step 1 / 1')
  })
})
