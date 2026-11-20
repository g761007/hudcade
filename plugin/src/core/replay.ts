// The turn replay: the last turn's tool calls, one step at a time as the
// person moves through them, each subagent's calls on a track of their own.
// Pure: the mod records the steps and keeps the position, and draws these
// rows in a pane.

import type { DiffHunk, Replay, ReplayField, ReplayStep, ReplayTrack } from '../../types'
import { cutToWidth, displayWidth, type Seg } from './band'
import { diffSource, hunkCounts, takeLines } from './diff'
import { clock, sanitize, toolLabel, truncate } from './format'

// At most this many lines of a step's change are kept.
export const DIFF_LINES = 300
// At most this much of what a call answered is kept.
const OUTPUT_LINES = 40
const OUTPUT_CHARS = 4_000
const FIELD_CHARS = 2_000
// The most steps listed at once.
const LIST_ROWS = 20

// ── Recording ─────────────────────────────────────────────────────────────

export type AgentInfo = { agentId: string; type: string; description: string }

// A call starts: its step joins the main line, or its agent's track.
export function addStep(r: Replay, step: ReplayStep, agent?: AgentInfo): Replay {
  if (!agent) return { ...r, steps: [...r.steps, step] }
  const track = r.agents[agent.agentId] ?? { type: agent.type, description: agent.description, steps: [] }
  return { ...r, agents: { ...r.agents, [agent.agentId]: { ...track, steps: [...track.steps, step] } } }
}

// Changes the step of call `callId`, on the main line or a track.
export function updateStep(r: Replay, callId: string, change: Partial<ReplayStep>): Replay {
  if (!hasCall(r, callId)) return r
  const apply = (steps: ReplayStep[]) => steps.map(s => (s.callId === callId ? { ...s, ...change } : s))
  const agents: Record<string, ReplayTrack> = {}
  for (const [id, track] of Object.entries(r.agents)) agents[id] = { ...track, steps: apply(track.steps) }
  return { ...r, steps: apply(r.steps), agents }
}

export function hasCall(r: Replay, callId: string): boolean {
  return allSteps(r).some(s => s.callId === callId)
}

// Whether an Agent call of this replay started the agent.
export function ownsAgent(r: Replay, agentId: string): boolean {
  return allSteps(r).some(s => s.agentId === agentId)
}

// The steps still running when their turn or their agent ended.
export function closeSteps(steps: readonly ReplayStep[], at: number): ReplayStep[] {
  return steps.map(s => (s.endedAt === undefined ? { ...s, endedAt: at, isUnfinished: true } : s))
}

export function closeAgent(r: Replay, agentId: string, at: number): Replay {
  const track = r.agents[agentId]
  return track ? { ...r, agents: { ...r.agents, [agentId]: { ...track, steps: closeSteps(track.steps, at) } } } : r
}

// What a step keeps of the change an Edit or Write asked for.
export function stepChange(hunks: DiffHunk[]): Pick<ReplayStep, 'added' | 'removed' | 'diff' | 'diffMore'> {
  const kept = takeLines(hunks, DIFF_LINES)
  return { ...hunkCounts(hunks), diff: kept.hunks, ...(kept.more > 0 ? { diffMore: kept.more } : {}) }
}

// The arguments worth showing for each tool, in order; any other tool shows
// its first few plain ones.
const FIELDS: Record<string, string[]> = {
  Bash: ['description', 'command', 'run_in_background'],
  Read: ['file_path', 'offset', 'limit'],
  Edit: ['file_path', 'replace_all'],
  Write: ['file_path'],
  NotebookEdit: ['notebook_path', 'edit_mode'],
  Grep: ['pattern', 'path', 'glob', 'type', 'output_mode'],
  Glob: ['pattern', 'path'],
  WebFetch: ['url', 'prompt'],
  WebSearch: ['query'],
  Agent: ['subagent_type', 'description', 'prompt', 'run_in_background'],
  Skill: ['skill', 'args'],
  TaskCreate: ['subject', 'description'],
  TaskUpdate: ['taskId', 'status', 'subject'],
}
// What a hook's input carries beside the tool's own arguments.
const NOT_ARGUMENTS = new Set(['tool', 'tool_use_id', 'agentId'])

// A call's arguments as its step shows them; paths inside the project are
// shown from its root.
export function callFields(tool: string, input: Record<string, unknown>, root: string): ReplayField[] {
  const plain = (key: string) => ['string', 'number', 'boolean'].includes(typeof input[key])
  const keys = FIELDS[tool] ?? Object.keys(input).filter(key => !NOT_ARGUMENTS.has(key) && plain(key)).slice(0, 4)
  return keys
    .filter(key => plain(key) && input[key] !== '' && input[key] !== false)
    .map(key => {
      let value = sanitize(String(input[key]))
      if (key.endsWith('path') && root && value.startsWith(`${root}/`)) value = value.slice(root.length + 1)
      return { label: key.replace(/_/g, ' '), value: truncate(value, FIELD_CHARS) }
    })
}

// The start of what a call answered, as the model read it, or why it was
// refused: lines kept apart, terminal codes taken out.
export function callOutput(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined
  const lines = text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '')
    .split('\n')
  while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop()
  const kept = lines.slice(0, OUTPUT_LINES).join('\n')
  const cut = kept.length > OUTPUT_CHARS ? kept.slice(0, OUTPUT_CHARS) : kept
  return lines.length > OUTPUT_LINES || cut !== kept ? `${cut}\n…` : cut
}

function allSteps(r: Replay): ReplayStep[] {
  return [...r.steps, ...Object.values(r.agents).flatMap(track => track.steps)]
}

// ── Showing ───────────────────────────────────────────────────────────────

// What the pane walks through: the main line, or one agent's track.
export type Line = { steps: ReplayStep[]; agent?: ReplayTrack }

export function lineOf(r: Replay, agentId: string | undefined): Line {
  const track = agentId === undefined ? undefined : r.agents[agentId]
  return track ? { steps: track.steps, agent: track } : { steps: r.steps }
}

// The step shown: `index` held to the line, where `steps.length` is its summary.
export function stepIndex(line: Line, index: number): number {
  return Math.max(0, Math.min(index, line.steps.length))
}

const OUTCOME: Record<NonNullable<Replay['outcome']>, Seg> = {
  answer: { text: '■ done', bold: true, color: 'success' },
  aborted: { text: '⏹ interrupted', bold: true, color: 'warning' },
  refusal: { text: '■ refused', bold: true, color: 'warning' },
  error: { text: '✗ error', bold: true, color: 'error' },
}

export type ReplayLines = { header: Seg[]; step: Seg[]; strip: Seg[]; task: Seg[] }

// Where the person stands, the step (or the line's totals on its summary),
// a strip of every step, and what was asked (an agent's task on its track),
// each on one line.
export function replayLines(r: Replay, line: Line, index: number, columns: number): ReplayLines {
  const n = line.steps.length
  const took = r.endedAt === undefined ? '…' : clock(r.endedAt - r.startedAt)
  const where = line.agent ? ` · ${line.agent.type}` : ` · turn ${r.turn}`
  const step = line.steps[index]
  let header: Seg[]
  let body: Seg[]
  if (!step) {
    const failed = line.steps.filter(s => s.isError && !s.isUnfinished).length
    const unfinished = line.steps.filter(s => s.isUnfinished).length
    const agents = line.steps.filter(s => s.agentId !== undefined && r.agents[s.agentId] !== undefined).length
    const { added, removed } = editTotals(line.steps)
    header = [
      line.agent ? { text: '■ end', bold: true } : OUTCOME[r.outcome ?? 'answer'],
      { text: line.agent ? where : `${where} · ${took}`, dim: true },
    ]
    body = [
      { text: `${n} step${n === 1 ? '' : 's'}` },
      ...(failed > 0 ? [{ text: ` · ${failed} failed`, color: 'error' }] : []),
      ...(unfinished > 0 ? [{ text: ` · ${unfinished} unfinished`, color: 'warning' }] : []),
      ...(agents > 0 ? [{ text: ` · ${agents} agent${agents === 1 ? '' : 's'}`, color: 'suggestion' }] : []),
      ...(added + removed > 0 ? lineCounts(added, removed) : []),
    ]
  } else {
    header = [
      { text: `▶ step ${index + 1} / ${n}`, bold: true },
      { text: `${where} · ${clock(step.startedAt - r.startedAt)} / ${took}`, dim: true },
    ]
    const tail: Seg[] = [...extras(r, step), { text: ' ' }, mark(step, false), { text: ` ${duration(step)}`, dim: true }]
    const label: Seg = { text: toolLabel(step.tool), color: 'suggestion', bold: true }
    // The detail gives way first, so the tool, lines, outcome and time stay whole.
    const room = columns - [label, ...tail].reduce((sum, seg) => sum + displayWidth(seg.text), 0) - 1
    const detail = room >= 4 && step.detail ? [{ text: ` ${fitWidth(step.detail, room)}` }] : []
    body = [label, ...detail, ...tail]
  }
  const asked = line.agent ? line.agent.description : r.task
  return { header, step: body, strip: strip(line.steps, index, columns), task: [{ text: `“${truncate(asked, 200)}”`, dim: true }] }
}

export type ListRow = { index: number; segs: Seg[] }

// The steps as a list of at most `rows`, around the current one: those
// passed plain, the current one marked, those ahead dim; each with its
// outcome, the lines an edit changed or the steps an agent took, and its time
// at the right edge.
export function stepList(r: Replay, line: Line, current: number, columns: number, rows: number): ListRow[] {
  const steps = line.steps
  const n = steps.length
  const count = Math.max(0, Math.min(n, rows))
  const start = Math.max(0, Math.min(current - Math.floor(count / 2), n - count))
  const digits = String(n).length
  const labels = steps.map(s => toolLabel(s.tool))
  const labelWidth = Math.min(14, Math.max(0, ...labels.map(displayWidth)))
  const list: ListRow[] = []
  for (let i = start; i < start + count; i++) {
    const s = steps[i]!
    const isAhead = i > current
    const style: Partial<Seg> = i === current ? { bold: true, color: 'claude' } : { dim: isAhead }
    const head = `${i === current ? '▸' : ' '} ${String(i + 1).padStart(digits)} `
    const label = ` ${padWidth(fitWidth(labels[i]!, labelWidth), labelWidth)}`
    const more = extras(r, s)
    const time = ` ${duration(s)}`
    const fixed = displayWidth(head) + 1 + more.reduce((sum, seg) => sum + displayWidth(seg.text), 0) + displayWidth(time)
    const room = columns - fixed - displayWidth(label)
    const detail = room >= 5 && s.detail ? ` ${fitWidth(s.detail, room - 1)}` : ''
    list.push({
      index: i,
      segs: [
        { text: head, ...style },
        mark(s, isAhead),
        { text: padWidth(label + detail, columns - fixed), ...style },
        ...more,
        { text: time, dim: true },
      ],
    })
  }
  return list
}

// The whole pane but its buttons, fitted to `columns` by `rows`: where the
// person stands, what was asked, the step, its arguments and what it
// answered (on the summary, the files the line changed), then the steps
// around it. Short of rows the answer gives way first, then the arguments,
// then the ask, so that three steps stay listed; rows to spare go back to
// them in that order.
export type ReplayView = { header: Seg[]; task: Seg[][]; step: Seg[]; details: Seg[][]; list: ListRow[]; strip?: Seg[] }

export function replayView(r: Replay, line: Line, index: number, columns: number, rows: number): ReplayView {
  const n = line.steps.length
  const lines = replayLines(r, line, index, columns)
  const step = line.steps[index]
  const asked = wrap(`“${line.agent ? line.agent.description : r.task}”`, columns).map(text => [{ text, dim: true }])
  const fields = step ? fieldLines(step.fields ?? [], columns) : fileLines(line.steps, columns)
  const output = step?.output ? outputLines(step.output, step.isError, columns) : []

  const budget = Math.max(0, rows - 2)
  let task = Math.min(asked.length, rows >= 24 ? 3 : rows >= 14 ? 2 : 1)
  let args = Math.min(fields.length, rows >= 24 ? 8 : 3)
  let answer = Math.min(output.length, rows >= 24 ? 6 : 2)
  const listMin = Math.min(n, 3)
  while (budget - task - args - answer < listMin && (answer > 0 || args > 1 || task > 1)) {
    if (answer > 0) answer--
    else if (args > 1) args--
    else task--
  }
  const room = Math.max(0, budget - task - args - answer)
  const listRows = room >= listMin ? Math.min(n, LIST_ROWS, room) : 0
  let spare = room - listRows - (listRows === 0 && room > 0 ? 1 : 0)
  const grow = (have: number, want: number) => {
    const add = Math.max(0, Math.min(spare, want - have))
    spare -= add
    return have + add
  }
  answer = grow(answer, output.length)
  args = grow(args, fields.length)
  task = grow(task, asked.length)

  return {
    header: lines.header,
    task: take(asked, task),
    step: lines.step,
    details: [...take(fields, args), ...take(output, answer)],
    list: listRows > 0 ? stepList(r, line, index, columns, listRows) : [],
    ...(listRows === 0 && room > 0 ? { strip: lines.strip } : {}),
  }
}

// The nearest step with a change after (`direction` 1) or before (-1) `from`.
export function stepWithDiff(steps: readonly ReplayStep[], from: number, direction: 1 | -1): number | undefined {
  for (let i = from + direction; i >= 0 && i < steps.length; i += direction) if (steps[i]!.diff?.length) return i
  return undefined
}

// A step's change as diff text of at most `rows` lines, and how many lines
// of it are left out.
export function diffView(step: ReplayStep, rows: number): { source: string; more: number } {
  const { hunks, more } = takeLines(step.diff ?? [], rows)
  return { source: diffSource(hunks), more: more + (step.diffMore ?? 0) }
}

// Each argument on its own lines: the name dim in a column, the value wrapped beside it.
function fieldLines(fields: readonly ReplayField[], columns: number): Seg[][] {
  const width = Math.min(12, Math.max(0, ...fields.map(f => displayWidth(f.label))))
  return fields.flatMap(f =>
    wrap(f.value, Math.max(8, columns - width - 2)).map((text, i) => [
      { text: `${padWidth(i === 0 ? fitWidth(f.label, width) : '', width)}  `, dim: true },
      { text },
    ]),
  )
}

// On the summary: each file the line's edits changed, with its lines.
function fileLines(steps: readonly ReplayStep[], columns: number): Seg[][] {
  const files = new Map<string, { added: number; removed: number }>()
  for (const s of steps) {
    if (s.added === undefined || s.removed === undefined || s.isError || s.isUnfinished) continue
    const name = s.fields?.find(f => f.label === 'file path')?.value ?? s.detail
    const sum = files.get(name) ?? { added: 0, removed: 0 }
    files.set(name, { added: sum.added + s.added, removed: sum.removed + s.removed })
  }
  return [...files].map(([name, sum]) => {
    const counts = lineCounts(sum.added, sum.removed)
    const room = columns - counts.reduce((total, seg) => total + displayWidth(seg.text), 0)
    return [{ text: fitWidth(name, Math.max(4, room)) }, ...counts]
  })
}

// What a call answered, under a rule, red where it failed.
function outputLines(output: string, isError: boolean, columns: number): Seg[][] {
  return output.split('\n').flatMap(raw => wrap(raw, Math.max(8, columns - 2)).map(text => [
    { text: '│ ', dim: true },
    { text, dim: !isError, color: isError ? 'error' : undefined },
  ]))
}

// `text` broken into lines of at most `width` columns, at spaces where it can.
export function wrap(text: string, width: number): string[] {
  const out: string[] = []
  let rest = text
  while (displayWidth(rest) > width) {
    // At least one character a line, however narrow.
    let line = cutToWidth(rest, width) || Array.from(rest)[0]!
    const space = line.lastIndexOf(' ')
    if (space > line.length / 2) line = line.slice(0, space)
    out.push(line)
    rest = rest.slice(line.length).replace(/^ /, '')
  }
  if (rest || out.length === 0) out.push(rest)
  return out
}

// The first `count` lines; cut short, the last says how many more there are,
// or, given one line, the first ends in an ellipsis.
function take(lines: Seg[][], count: number): Seg[][] {
  if (lines.length <= count) return lines
  if (count <= 0) return []
  if (count === 1) return [[...lines[0]!, { text: ' …', dim: true }]]
  return [...lines.slice(0, count - 1), [{ text: `  … ${lines.length - count + 1} more lines`, dim: true }]]
}

// The lines changed by the steps that went through.
function editTotals(steps: readonly ReplayStep[]): { added: number; removed: number } {
  const done = steps.filter(s => s.endedAt !== undefined && !s.isError && !s.isUnfinished)
  return { added: done.reduce((sum, s) => sum + (s.added ?? 0), 0), removed: done.reduce((sum, s) => sum + (s.removed ?? 0), 0) }
}

// What follows a step's detail: the lines an edit changed, or the steps its agent took.
function extras(r: Replay, s: ReplayStep): Seg[] {
  if (s.added !== undefined && s.removed !== undefined) return lineCounts(s.added, s.removed)
  const track = s.agentId === undefined ? undefined : r.agents[s.agentId]
  return track ? [{ text: ` ⤷ ${track.steps.length}`, color: 'suggestion' }] : []
}

// How a step's call ended: ◌ still running, ⏹ still running when its turn or
// agent ended, ✗ failed or refused, ✓ done (dim for a step ahead).
function mark(s: ReplayStep, isAhead: boolean): Seg {
  if (s.endedAt === undefined) return { text: '◌', dim: true }
  if (s.isUnfinished) return { text: '⏹', color: 'warning' }
  if (s.isError) return { text: '✗', color: 'error' }
  return { text: '✓', color: isAhead ? undefined : 'success', dim: isAhead }
}

function duration(s: ReplayStep): string {
  return s.endedAt === undefined ? '…' : clock(s.endedAt - s.startedAt)
}

function padWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

function fitWidth(text: string, max: number): string {
  return displayWidth(text) <= max ? text : `${cutToWidth(text, max - 1)}…`
}

function lineCounts(added: number, removed: number): Seg[] {
  return [
    { text: ` +${added}`, color: 'success' },
    { text: ` −${removed}`, color: 'error' },
  ]
}

// One cell per step, the current one filled, failed ones red, unfinished ones
// amber; a line too long for the width shows the stretch around the current step.
function strip(steps: readonly ReplayStep[], current: number, columns: number): Seg[] {
  const n = steps.length
  const room = Math.max(3, Math.floor((columns - 4) / 2))
  const start = n <= room ? 0 : Math.max(0, Math.min(current - Math.floor(room / 2), n - room))
  const end = Math.min(n, start + room)
  const cells: Seg[] = start > 0 ? [{ text: '… ', dim: true }] : []
  for (let i = start; i < end; i++) {
    const s = steps[i]!
    const flag = s.isUnfinished ? 'warning' : s.isError ? 'error' : undefined
    cells.push(i === current ? { text: '■ ', bold: true, color: flag ?? 'claude' } : { text: '▪ ', dim: !flag, color: flag })
  }
  if (end < n) cells.push({ text: '…', dim: true })
  return cells
}
