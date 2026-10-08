// Small formatters shared by the HUD band, the spinner and Telegram messages.

// 0:42, 12:05, 1:02:03
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// 14:32:05 local time; the offset comes from the machine's `date +%z`, since
// the mod's own environment may not know the local zone.
export function wallClock(epochMs: number, offsetMinutes?: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (offsetMinutes === undefined) {
    const d = new Date(epochMs)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  const d = new Date(epochMs + offsetMinutes * 60_000)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

// "+0800" → 480, "-0330" → -210
export function parseTzOffset(text: string): number | undefined {
  const match = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (!match) return undefined
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

// 42s, 12m, 1h05m, 2d3h
export function compactDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m`
  return `${total}s`
}

// 2m14s, 45s, 1h02m
export function preciseDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`
  return `${s}s`
}

// 850, 12k, 913k, 1.2M
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

function trim(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '')
}

export function usd(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`
}

// ██▌░░░ — one cell per 1/width, with a half cell for the remainder.
export function bar(percent: number, width: number): string {
  const clamped = Math.min(100, Math.max(0, percent))
  const halves = Math.round((clamped / 100) * width * 2)
  const full = Math.floor(halves / 2)
  const half = halves % 2
  return '█'.repeat(full) + (half ? '▌' : '') + '░'.repeat(Math.max(0, width - full - half))
}

// claude-opus-5-5 → Opus 5.5; claude-haiku-4-5-20251001 → Haiku 4.5
export function modelLabel(id: string | undefined): string | undefined {
  if (!id) return undefined
  const base = id.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')
  const match = /^(?:claude-)?([a-z]+)-(\d+)(?:-(\d+))?$/.exec(base)
  if (!match) return id
  const family = match[1]!.charAt(0).toUpperCase() + match[1]!.slice(1)
  return match[3] ? `${family} ${match[2]}.${match[3]}` : `${family} ${match[2]}`
}

export function rateLabel(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  return kind.replace(/_/g, ' ')
}

// resetsAt arrives as an ISO time or as Unix seconds in a string.
export function msUntil(resetsAt: string | undefined, now: number): number | undefined {
  if (!resetsAt) return undefined
  const at = /^\d+$/.test(resetsAt) ? Number(resetsAt) * 1000 : Date.parse(resetsAt)
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined
}

// Drops terminal control sequences and control characters from text that
// came from outside (commands, descriptions, branch names).
export function sanitize(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

export function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

// A short description of a tool call for the HUD: the command, the file, the pattern.
export function toolDetail(tool: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === 'string' ? sanitize(input[key] as string) : '')
  switch (tool) {
    case 'Bash':
      return str('description') || str('command')
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return basename(str('file_path') || str('notebook_path'))
    case 'Grep':
    case 'Glob':
      return str('pattern')
    case 'WebFetch':
      return hostOf(str('url'))
    case 'WebSearch':
      return str('query')
    case 'Agent':
      return str('description')
    case 'Skill':
      return str('skill')
    case 'TaskCreate':
      return str('subject')
    default:
      return ''
  }
}

// mcp__server__tool → server:tool
export function toolLabel(tool: string): string {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool)
  return match ? `${match[1]}:${match[2]}` : tool
}

function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/]+)/i.exec(url)
  return match ? match[1]! : url
}
