import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

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

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await ui.find({ type: 'Text', text: /working/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /tools 1/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('stays out of the way when the hud module is off', { options: { hud: false } }, async ($, on) => {
    engineDraws(on)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await ui.find({ type: 'Text', text: /idle|working/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
    await ui.unmount()
  })
})

describe('status line', () => {
  test('pins model, context, cost and 5h/7d usage under the prompt when usage moves', async ($, on) => {
    const shown: (string | undefined)[] = []
    on('ui.status', (_$, e) => {
      shown.push(e.text)
      return { value: undefined } as never
    })
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.session.measure({
      context: { tokens: 90_000, window: 1_000_000, percent: 9 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 13 },
        { kind: 'seven_day', percentUsed: 38 },
      ],
      cost: { usd: 0.43 },
      changed: ['context', 'rateLimits', 'cost'],
    } as never)
    expect(shown[shown.length - 1]).toBe('Claude │ ctx 9% │ $0.43 │ 5h 13% │ 7d 38%')
  })

  test('stays empty when switched off', { options: { statusLine: false } }, async ($, on) => {
    const shown: (string | undefined)[] = []
    on('ui.status', (_$, e) => {
      shown.push(e.text)
      return { value: undefined } as never
    })
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.session.measure({ context: { window: 1_000_000, percent: 9 }, rateLimits: [], changed: ['context'] } as never)
    expect(shown.filter(Boolean)).toEqual([])
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
  const OPTIONS = { options: { telegramBotToken: 'BOT-TOKEN', telegramChatId: '42' } }

  // The session facts a message reads, answered as the engine would.
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
