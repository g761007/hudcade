// The change an Edit or Write call asks for, as unified-diff hunks numbered
// from the file as it stood before the call ran. Pure: the mod reads the file.

import type { DiffHunk as Hunk } from '../../types'

const CONTEXT = 3
// A changed stretch longer than this on both sides is shown as removed, then
// added, rather than matched line by line.
const MAX_MATCH_CELLS = 400 * 400

// What the file holds once the Edit runs; undefined when `oldString` is not
// in it, so the Edit will fail.
export function applyEdit(content: string, oldString: string, newString: string, replaceAll: boolean): string | undefined {
  if (oldString === '') return content === '' ? newString : undefined
  if (!content.includes(oldString)) return undefined
  return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, () => newString)
}

export function editHunks(before: string, after: string): Hunk[] {
  const a = splitLines(before)
  const b = splitLines(after)
  // The unchanged head and tail are set aside, so a long file costs only its changed stretch.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const middle = matchLines(a.slice(head, a.length - tail), b.slice(head, b.length - tail))
  if (!middle.some(line => line[0] !== ' ')) return []

  const lead = a.slice(Math.max(0, head - CONTEXT), head).map(line => ` ${line}`)
  const trail = a.slice(a.length - tail, a.length - tail + CONTEXT).map(line => ` ${line}`)
  const all = [...lead, ...middle, ...trail]
  const oldAt: number[] = []
  const newAt: number[] = []
  let oldLine = head - lead.length + 1
  let newLine = oldLine
  for (const line of all) {
    oldAt.push(oldLine)
    newAt.push(newLine)
    if (line[0] !== '+') oldLine++
    if (line[0] !== '-') newLine++
  }

  // Changes with at most twice the context between them share a hunk.
  const changed = all.flatMap((line, i) => (line[0] === ' ' ? [] : [i]))
  const hunks: Hunk[] = []
  for (let i = 0; i < changed.length; ) {
    let j = i
    while (j + 1 < changed.length && changed[j + 1]! - changed[j]! <= 2 * CONTEXT + 1) j++
    const from = Math.max(0, changed[i]! - CONTEXT)
    const to = Math.min(all.length - 1, changed[j]! + CONTEXT)
    hunks.push({ oldStart: oldAt[from]!, newStart: newAt[from]!, lines: all.slice(from, to + 1) })
    i = j + 1
  }
  return hunks
}

export function hunkCounts(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line[0] === '+') added++
      else if (line[0] === '-') removed++
    }
  }
  return { added, removed }
}

// The first `maxLines` lines of the hunks, cut between lines; how many were left out.
export function takeLines(hunks: readonly Hunk[], maxLines: number): { hunks: Hunk[]; more: number } {
  const kept: Hunk[] = []
  let room = Math.max(0, maxLines)
  let more = 0
  for (const h of hunks) {
    const lines = h.lines.slice(0, room)
    if (lines.length > 0) kept.push({ ...h, lines })
    more += h.lines.length - lines.length
    room -= lines.length
  }
  return { hunks: kept, more }
}

// The hunks as unified-diff text, each header counted from its own lines, so
// hunks cut short still parse.
export function diffSource(hunks: readonly Hunk[]): string {
  return hunks
    .flatMap(h => {
      const oldCount = h.lines.filter(line => line[0] !== '+').length
      const newCount = h.lines.filter(line => line[0] !== '-').length
      // An empty side starts on the line before, as `diff -u` writes it.
      const oldStart = oldCount === 0 ? h.oldStart - 1 : h.oldStart
      const newStart = newCount === 0 ? h.newStart - 1 : h.newStart
      return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...h.lines]
    })
    .join('\n')
}

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

// A line-by-line match of two stretches by their longest common subsequence.
function matchLines(a: readonly string[], b: readonly string[]): string[] {
  if (a.length * b.length > MAX_MATCH_CELLS) return [...a.map(line => `-${line}`), ...b.map(line => `+${line}`)]
  const n = a.length
  const m = b.length
  const lcs = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = a[i] === b[j] ? lcs[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!)
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`)
      i++
      j++
    } else if (lcs[(i + 1) * (m + 1) + j]! >= lcs[i * (m + 1) + j + 1]!) {
      out.push(`-${a[i++]}`)
    } else {
      out.push(`+${b[j++]}`)
    }
  }
  while (i < n) out.push(`-${a[i++]}`)
  while (j < m) out.push(`+${b[j++]}`)
  return out
}
