// Renders the README images from the mod's own code, so they show exactly
// what it draws: assets/hud.svg (a terminal mock-up of a running turn),
// assets/replay.svg (the replay pane), assets/handoff.svg (the idle band
// offering a handoff) and assets/demo.gif (the spinner scenes). Needs Bun,
// ImageMagick (`magick`) and Menlo or another monospace font.
//
//   bun scripts/render-assets.ts

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Replay, ReplayStep } from '../plugin/types'
import { buildBand, displayWidth, type Seg } from '../plugin/src/core/band'
import { editHunks } from '../plugin/src/core/diff'
import * as hud from '../plugin/src/core/hud-model'
import { lineOf, replayView, stepChange } from '../plugin/src/core/replay'
import { SCENE_NAMES, SCENES } from '../plugin/src/core/scenes'
import { Canvas, CLEAR } from '../plugin/src/core/scenes/canvas'
import type { Mode } from '../plugin/src/core/scenes/mode'
import { turnFacts } from '../plugin/src/core/spinner'

const ROOT = new URL('..', import.meta.url).pathname
const FONT = `ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace`
// ImageMagick rasterizes the GIF frames: it resolves no generic family, and
// without an explicit style it may pick an italic face.
const GIF_FONT = `Menlo, 'DejaVu Sans Mono', monospace`
const COLORS: Record<string, string> = {
  bg: '#0d1117',
  chrome: '#161b22',
  text: '#e6edf3',
  dim: '#8b949e',
  claude: '#d97757',
  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
  suggestion: '#58a6ff',
}

const TITLES: Record<string, string> = {
  robot: 'Robot coder',
  coffee: 'Coffee conveyor',
  garden: 'Little garden',
  rocket: 'Rocket voyage',
  cat: 'Cat and yarn',
  fishing: 'Fishing',
  train: 'Steam train',
  campfire: 'Campfire',
  weather: 'Weather',
  equalizer: 'Equalizer',
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

// One canvas as SVG rects, each pixel half a terminal row tall.
function pixels(c: Canvas, x0: number, y0: number, cw: number, ph: number): string {
  let out = ''
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const v = c.get(x, y)
      if (v === CLEAR) continue
      out += `<rect x="${(x0 + x * cw).toFixed(1)}" y="${(y0 + y * ph).toFixed(1)}" width="${(cw + 0.3).toFixed(1)}" height="${(ph + 0.3).toFixed(1)}" fill="${hex(v)}"/>`
    }
  }
  return out
}

// Each segment pinned to its own column, so any renderer lays the row out
// as the terminal does, whatever it does with consecutive tspans.
function tspans(segs: Seg[], x0: number, cw: number): string {
  let x = x0
  return segs
    .map(s => {
      const fill = s.color ? COLORS[s.color] ?? s.color : s.dim ? COLORS.dim : COLORS.text
      const span = `<tspan x="${x.toFixed(1)}" fill="${fill}"${s.bold ? ' font-weight="700"' : ''}>${esc(s.text)}</tspan>`
      x += displayWidth(s.text) * cw
      return span
    })
    .join('')
}

// A terminal window around `body`: its chrome and the title Claude Code runs under.
function windowSvg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="14">
<rect width="${width}" height="${height}" rx="10" fill="${COLORS.bg}"/>
<rect width="${width}" height="32" rx="10" fill="${COLORS.chrome}"/><rect y="22" width="${width}" height="10" fill="${COLORS.chrome}"/>
<circle cx="20" cy="16" r="6" fill="#ff5f57"/><circle cx="40" cy="16" r="6" fill="#febc2e"/><circle cx="60" cy="16" r="6" fill="#28c840"/>
<text x="${width / 2}" y="21" text-anchor="middle" fill="${COLORS.dim}" font-size="12">~/code/my-app — claude</text>
${body}
</svg>
`
}

// ── The terminal mock-up ────────────────────────────────────────────────────

function sampleHud(now: number): hud.Hud {
  const t0 = now - 42_000
  let h: hud.Hud = {
    ...hud.emptyHud('my-app'),
    model: 'claude-opus-5-5',
    effort: 'xhigh',
    git: { branch: 'feat/retry', isDirty: true, ahead: 2, behind: 0 },
    sessionStartedAt: now - 72 * 60_000,
    tzOffsetMinutes: 480,
  }
  h = hud.applyUsage(h, {
    context: { tokens: 652_000, window: 1_000_000, percent: 65 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 13, resetsAt: String(Math.round(now / 1000) + 2 * 3600 + 120) },
      { kind: 'seven_day', percentUsed: 81, resetsAt: String(Math.round(now / 1000) + 5 * 86400 + 16 * 3600) },
    ],
    cost: { usd: 3.21 },
  })
  h = hud.startTurn(h, t0)
  h = { ...h, turn: { ...h.turn, count: 7, costAtStart: 2.79 } }
  h = hud.addRequestUsage(h, { input_tokens: 400, output_tokens: 900, cache_read_input_tokens: 11_000, cache_creation_input_tokens: 600 }, 18_000)
  h = hud.addDiff(h, 'src/http/client.ts', { added: 120, removed: 45 })
  for (const f of ['a', 'b', 'c', 'd', 'e']) h = hud.addDiff(h, f, { added: 0, removed: 0 })
  h = hud.noteCompaction(h)
  h = hud.startTool(h, { id: 't', tool: 'Bash', detail: 'Run the test suite', startedAt: now - 5_000 })
  h = hud.taskCreated(h, 'Add retry policy', '1')
  h = hud.taskCreated(h, 'Cover with tests', '2')
  h = hud.taskCreated(h, 'Update docs', '3')
  h = hud.taskUpdated(h, '1', { status: 'completed' })
  h = hud.taskUpdated(h, '2', { status: 'in_progress' })
  h = hud.setCtxTop(h, [
    { name: 'Messages', tokens: 398_000, kind: 'used' },
    { name: 'System tools', tokens: 117_000, kind: 'used' },
    { name: 'System prompt', tokens: 59_000, kind: 'used' },
    { name: 'Memory files', tokens: 39_000, kind: 'used' },
  ])
  h = hud.launchAgent(h, { toolUseId: 'a', type: 'Explore', description: 'find every caller of fetchJson', model: 'claude-haiku-5-5', isBackground: false, now: now - 40_000 })
  h = hud.linkAgent(h, 'ag', 'Explore', now - 40_000)
  h = hud.startTool(h, { id: 'g', tool: 'Grep', detail: 'fetchJson', startedAt: now - 2_000, agentId: 'ag' })
  h = hud.setWorkers(h, [{ id: 'b', type: 'bash', status: 'running', description: 'npm run dev' }], [
    { id: 'c', schedule: 'every 5m', isRecurring: true, prompt: 'check the deploy status' },
  ])
  return h
}

function renderHudSvg(): string {
  const COLS = 118
  const cw = 8.43
  const lh = 19
  const pad = 22
  const top = 44
  const now = Date.UTC(2026, 9, 8, 6, 33, 0)
  const h = sampleHud(now)
  const rows: string[] = []
  let y = top + 14

  const line = (segs: Seg[], x = pad) => {
    rows.push(`<text y="${y}" xml:space="preserve">${tspans(segs, x, cw)}</text>`)
    y += lh
  }

  line([{ text: '❯ ', color: 'claude' }, { text: 'add retries with backoff to the HTTP client and test them' }])
  y += 6
  line([{ text: '⏺ ', color: 'success' }, { text: "I'll add a retry policy to " }, { text: 'fetchJson', color: 'suggestion' }, { text: ' and cover it with tests.' }])
  line([{ text: '⏺ ', color: 'success' }, { text: 'Update', bold: true }, { text: '(src/http/client.ts)', dim: true }])
  line([{ text: '  ⎿  ', dim: true }, { text: 'Added ' }, { text: '18', bold: true }, { text: ' lines, removed ' }, { text: '4', bold: true }, { text: ' lines' }])
  y += 8

  // The spinner: a game raster and its four lines of text.
  const game = new Canvas(46, 8)
  SCENES.robot.draw(game, 'tool', 2_400)
  const spinnerTop = y - 14
  rows.push(pixels(game, pad, spinnerTop, cw, lh / 2))
  const tx = pad + 48 * cw
  const spin = [
    [{ text: 'Sauteing…', color: SCENES.robot.accent, bold: true }],
    [{ text: '0:42 · xhigh · running tool', dim: true }],
    [{ text: '▸ Bash Run the test suite', color: 'suggestion' }],
    [{ text: turnFacts(h, 0), dim: true }],
  ] as Seg[][]
  for (const segs of spin) line(segs, tx)
  y += 10

  // The band, beside the spinner as the terminal draws it.
  for (const row of buildBand(h, now, COLS, { warnPercent: 60, criticalPercent: 80, hasSpinner: true })) {
    const rightWidth = displayWidth(row.right.map(s => s.text).join(''))
    rows.push(`<text y="${y}" xml:space="preserve">${tspans(row.left, pad, cw)}</text>`)
    if (row.right.length) rows.push(`<text y="${y}" xml:space="preserve">${tspans(row.right, pad + (COLS - rightWidth) * cw, cw)}</text>`)
    y += lh
  }

  // The prompt box.
  y += 4
  const ruleWidth = COLS * cw
  rows.push(`<rect x="${pad}" y="${y - 13}" width="${ruleWidth}" height="1" fill="#30363d"/>`)
  y += 8
  line([{ text: '❯ ', color: 'text' }, { text: '▌', color: 'suggestion' }])
  rows.push(`<rect x="${pad}" y="${y - 13}" width="${ruleWidth}" height="1" fill="#30363d"/>`)

  const width = Math.round(pad * 2 + COLS * cw)
  const height = Math.round(y + 6)
  return windowSvg(width, height, rows.join('\n'))
}

// ── The turn replay ─────────────────────────────────────────────────────────

// The turn the mock-up's session just finished, as /hud replay holds it.
function sampleReplay(t0: number): Replay {
  const at = (s: number, took: number, over: Partial<ReplayStep>): ReplayStep => ({
    callId: `c${s}`,
    tool: 'Read',
    detail: '',
    startedAt: t0 + s * 1000,
    endedAt: t0 + (s + took) * 1000,
    isError: false,
    ...over,
  })
  const client = 'export async function fetchJson(url: string) {\n  const res = await fetch(url)\n  return res.json()\n}\n'
  const retried = client.replace('  const res = await fetch(url)\n', '  const res = await withRetry(() => fetch(url), { tries: 4, backoffMs: 200 })\n')
  const tests = 'Run the test suite'
  return {
    turn: 7,
    task: 'add retries with backoff to the HTTP client and test them',
    scene: 'robot',
    startedAt: t0,
    endedAt: t0 + 135_000,
    outcome: 'answer',
    steps: [
      at(3, 0, { tool: 'Read', detail: 'client.ts', fields: [{ label: 'file path', value: 'src/http/client.ts' }] }),
      at(5, 1, { tool: 'Grep', detail: 'fetchJson', fields: [{ label: 'pattern', value: 'fetchJson' }, { label: 'path', value: 'src' }] }),
      at(8, 41, { tool: 'Agent', detail: 'find every caller of fetchJson', agentId: 'ag' }),
      at(52, 1, { tool: 'Edit', detail: 'client.ts', fields: [{ label: 'file path', value: 'src/http/client.ts' }], ...stepChange(editHunks(client, retried)) }),
      at(58, 1, { tool: 'Write', detail: 'client.test.ts', fields: [{ label: 'file path', value: 'src/http/client.test.ts' }], added: 64, removed: 0 }),
      at(66, 9, { tool: 'Bash', detail: tests, isError: true, output: ' FAIL  src/http/client.test.ts\n  ✕ gives up after 4 tries (7 ms)' }),
      at(80, 1, { tool: 'Edit', detail: 'client.ts', fields: [{ label: 'file path', value: 'src/http/client.ts' }], added: 3, removed: 1 }),
      at(86, 8, {
        tool: 'Bash',
        detail: tests,
        fields: [
          { label: 'description', value: tests },
          { label: 'command', value: 'npm test -- src/http' },
        ],
        output: ' PASS  src/http/client.test.ts\n  ✓ retries a 503 with backoff (12 ms)\n  ✓ gives up after 4 tries (8 ms)\n  ✓ does not retry a 400 (2 ms)\n\nTests:  6 passed, 6 total',
      }),
    ],
    agents: {
      ag: {
        type: 'Explore',
        description: 'find every caller of fetchJson',
        steps: [at(9, 1, { tool: 'Grep', detail: 'fetchJson' }), at(11, 0, { tool: 'Read', detail: 'users.ts' }), at(12, 0, { tool: 'Read', detail: 'orders.ts' })],
      },
    },
  }
}

// The replay pane, docked beside the transcript, on the turn's last step.
function renderReplaySvg(): string {
  const COLS = 66
  const BODY_ROWS = 21
  const cw = 8.43
  const lh = 19
  const pad = 22
  const t0 = Date.UTC(2026, 9, 8, 6, 30, 0)
  const r = sampleReplay(t0)
  const view = replayView(r, lineOf(r, undefined), 7, COLS, BODY_ROWS - 1)
  const rows: string[] = []
  const frameTop = 48
  let y = frameTop + 26
  const x = pad + 12
  const line = (segs: Seg[]) => {
    rows.push(`<text y="${y}" xml:space="preserve">${tspans(segs, x, cw)}</text>`)
    y += lh
  }
  line(view.header)
  view.task.forEach(line)
  line(view.step)
  view.details.forEach(line)
  view.list.forEach(item => line(item.segs))
  if (view.strip) line(view.strip)
  // Plain buttons, as the terminal draws them: the hotkey, a colon, the label.
  const key = (k: string, label: string): Seg[] => [{ text: `${k}: `, color: 'claude' }, { text: `${label}  ` }]
  line([...key('p', '◀ prev'), ...key('n', 'next ▶'), ...key('c', 'close')])

  const frameWidth = COLS * cw + 24
  const frameHeight = y - frameTop - 6
  const width = Math.round(pad * 2 + frameWidth)
  const height = Math.round(frameTop + frameHeight + 18)
  const frame = `<rect x="${pad}" y="${frameTop}" width="${frameWidth.toFixed(1)}" height="${frameHeight}" rx="6" fill="none" stroke="#30363d" stroke-width="1"/>
<text x="${(pad + frameWidth - 16).toFixed(1)}" y="${frameTop + 4}" fill="${COLORS.dim}" font-size="12">✕</text>`
  return windowSvg(width, height, `${frame}\n${rows.join('\n')}`)
}

// ── The idle band and the handoff ───────────────────────────────────────────

// The mock-up's session eighteen minutes after its turn: context at 82%, the
// prompt cache counting down, the turn offered for replay.
function renderHandoffSvg(): string {
  const COLS = 118
  const cw = 8.43
  const lh = 19
  const pad = 22
  const top = 44
  // The turn took 2m15s; its last request went out 20 seconds before it
  // ended, and the band is drawn 18 minutes after that: 42 minutes to go.
  const end = Date.UTC(2026, 9, 8, 6, 35, 15)
  const lastRequest = end - 20_000
  const now = lastRequest + 18 * 60_000
  let h = sampleHud(end)
  h = hud.applyUsage(h, { context: { tokens: 821_000, window: 1_000_000, percent: 82 } })
  h = hud.addRequestUsage(
    h,
    { input_tokens: 200, output_tokens: 300, cache_read_input_tokens: 820_000, cache_creation_input_tokens: 1_000, ephemeral_1h_input_tokens: 1_000 },
    6_000,
    lastRequest,
  )
  h = { ...h, turn: { ...h.turn, startedAt: end - 135_000 } }
  h = hud.completeTurn(h, 135_000, end, 'answer')
  h = { ...h, replay: { ...sampleReplay(end - 135_000), turn: h.turn.count, endedAt: end } }
  const rows: string[] = []
  let y = top + 14
  const line = (segs: Seg[], x = pad) => {
    rows.push(`<text y="${y}" xml:space="preserve">${tspans(segs, x, cw)}</text>`)
    y += lh
  }
  line([{ text: '⏺ ', color: 'success' }, { text: 'Added retries with exponential backoff to ' }, { text: 'fetchJson', color: 'suggestion' }, { text: ': 4 tries, on 503s and timeouts only. All 6 new tests pass.' }])
  line([{ text: '✻ ', color: 'claude' }, { text: 'Worked for 2m15s', dim: true }])
  y += 10

  for (const row of buildBand(h, now, COLS, { warnPercent: 60, criticalPercent: 80 })) {
    const rightWidth = displayWidth(row.right.map(s => s.text).join(''))
    rows.push(`<text y="${y}" xml:space="preserve">${tspans(row.left, pad, cw)}</text>`)
    if (row.right.length) rows.push(`<text y="${y}" xml:space="preserve">${tspans(row.right, pad + (COLS - rightWidth) * cw, cw)}</text>`)
    y += lh
  }
  // The handoff row the mod adds past handoffPercent: a primary button, as
  // the terminal draws one, and what it does.
  line([{ text: '[ ⇢ handoff ]', color: 'claude', bold: true }, { text: '  context 82%: save a summary, clear, and start over with it', dim: true }])

  y += 4
  const ruleWidth = COLS * cw
  rows.push(`<rect x="${pad}" y="${y - 13}" width="${ruleWidth}" height="1" fill="#30363d"/>`)
  y += 8
  line([{ text: '❯ ', color: 'text' }, { text: '▌', color: 'suggestion' }])
  rows.push(`<rect x="${pad}" y="${y - 13}" width="${ruleWidth}" height="1" fill="#30363d"/>`)
  return windowSvg(Math.round(pad * 2 + COLS * cw), Math.round(y + 6), rows.join('\n'))
}

// ── The spinner demo ────────────────────────────────────────────────────────

const MOODS: { mode: Mode; label: string }[] = [
  { mode: 'think', label: 'thinking' },
  { mode: 'tool', label: 'running a tool' },
  { mode: 'reply', label: 'replying' },
]

// Every scene at once, in two columns, all in the same mood.
function renderDemoFrame(m: number, t: number): string {
  const px = 5
  const label = 150
  const pad = 16
  const header = 48
  const perColumn = Math.ceil(SCENE_NAMES.length / 2)
  const rowH = 8 * px + 16
  const cellW = label + 48 * px + pad
  const width = pad + 2 * cellW
  const height = header + perColumn * rowH + pad / 2
  const font = `font-family="${GIF_FONT}" font-style="normal"`
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${COLORS.bg}"/>`
  MOODS.forEach((mood, i) => {
    const x = pad + i * 150
    const active = i === m
    out += `<rect x="${x}" y="12" width="138" height="24" rx="12" fill="${active ? COLORS.claude : '#21262d'}"/>`
    out += `<text x="${x + 69}" y="28" text-anchor="middle" fill="${active ? '#ffffff' : COLORS.dim}" font-size="13" font-weight="${active ? 700 : 400}" ${font}>${mood.label}</text>`
  })
  SCENE_NAMES.forEach((name, i) => {
    const x0 = pad + Math.floor(i / perColumn) * cellW
    const y0 = header + (i % perColumn) * rowH
    out += `<text x="${x0}" y="${y0 + 25}" fill="${SCENES[name].accent}" font-size="13" font-weight="700" ${font}>${esc(TITLES[name] ?? name)}</text>`
    const c = new Canvas(48, 8)
    SCENES[name].draw(c, MOODS[m]!.mode, t)
    out += `<rect x="${x0 + label - 4}" y="${y0 + 1}" width="${48 * px + 8}" height="${8 * px + 8}" rx="4" fill="#010409"/>`
    out += pixels(c, x0 + label, y0 + 5, px, px)
  })
  return out + '</svg>'
}

function renderDemoGif(out: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'hudcade-frames-'))
  const FRAME_MS = 100
  const PER_MOOD = 20
  let i = 0
  try {
    for (let m = 0; m < MOODS.length; m++) {
      for (let f = 0; f < PER_MOOD; f++) {
        const t = 1_000 + (m * PER_MOOD + f) * FRAME_MS
        writeFileSync(join(dir, `f${String(i++).padStart(4, '0')}.svg`), renderDemoFrame(m, t))
      }
    }
    const pngs = Bun.spawnSync(['magick', 'mogrify', '-density', '144', '-format', 'png', join(dir, '*.svg')])
    if (pngs.exitCode !== 0) throw new Error(pngs.stderr.toString())
    const gif = Bun.spawnSync(['magick', '-delay', String(FRAME_MS / 10), '-loop', '0', join(dir, '*.png'), '-layers', 'Optimize', out])
    if (gif.exitCode !== 0) throw new Error(gif.stderr.toString())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

writeFileSync(join(ROOT, 'assets/hud.svg'), renderHudSvg())
writeFileSync(join(ROOT, 'assets/replay.svg'), renderReplaySvg())
writeFileSync(join(ROOT, 'assets/handoff.svg'), renderHandoffSvg())
renderDemoGif(join(ROOT, 'assets/demo.gif'))
console.log('wrote assets/hud.svg, assets/replay.svg, assets/handoff.svg and assets/demo.gif')
