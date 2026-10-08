// Renders the README images from the mod's own code, so they show exactly
// what it draws: assets/hud.svg (a terminal mock-up) and assets/demo.gif
// (the spinner scenes). Needs Bun, ImageMagick (`magick`) and Menlo or
// another monospace font.
//
//   bun scripts/render-assets.ts

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildBand, displayWidth, statusLine, type Seg } from '../plugin/src/core/band'
import * as hud from '../plugin/src/core/hud-model'
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

  // The band.
  for (const row of buildBand(h, now, COLS, { warnPercent: 60, criticalPercent: 80 })) {
    const rightWidth = displayWidth(row.right.map(s => s.text).join(''))
    rows.push(`<text y="${y}" xml:space="preserve">${tspans(row.left, pad, cw)}</text>`)
    if (row.right.length) rows.push(`<text y="${y}" xml:space="preserve">${tspans(row.right, pad + (COLS - rightWidth) * cw, cw)}</text>`)
    y += lh
  }

  // The prompt box and the status line under it.
  y += 4
  const ruleWidth = COLS * cw
  rows.push(`<rect x="${pad}" y="${y - 13}" width="${ruleWidth}" height="1" fill="#30363d"/>`)
  y += 8
  line([{ text: '❯ ', color: 'text' }, { text: '▌', color: 'suggestion' }])
  rows.push(`<rect x="${pad}" y="${y - 13}" width="${ruleWidth}" height="1" fill="#30363d"/>`)
  y += 8
  line([{ text: '  ' + statusLine(h), dim: true }])

  const width = Math.round(pad * 2 + COLS * cw)
  const height = Math.round(y + 6)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}" font-size="14">
<rect width="${width}" height="${height}" rx="10" fill="${COLORS.bg}"/>
<rect width="${width}" height="32" rx="10" fill="${COLORS.chrome}"/><rect y="22" width="${width}" height="10" fill="${COLORS.chrome}"/>
<circle cx="20" cy="16" r="6" fill="#ff5f57"/><circle cx="40" cy="16" r="6" fill="#febc2e"/><circle cx="60" cy="16" r="6" fill="#28c840"/>
<text x="${width / 2}" y="21" text-anchor="middle" fill="${COLORS.dim}" font-size="12">~/code/my-app — claude</text>
${rows.join('\n')}
</svg>
`
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
renderDemoGif(join(ROOT, 'assets/demo.gif'))
console.log('wrote assets/hud.svg and assets/demo.gif')
