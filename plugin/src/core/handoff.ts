// One-click handoff: what the model is asked for a handoff summary, where the
// summary is kept, and the first prompt of the conversation that takes over.
// Pure: the mod forks the model, writes the file, clears and submits.

// What the summary holds, under these headings, in this order.
export const HANDOFF_PROMPT = [
  'Write a handoff summary of this conversation for a new session that will take over the work with none of this context.',
  'Use exactly these Markdown headings, in this order:',
  '## Goal: what the person is trying to achieve now.',
  '## Done: what has been finished, and how it was checked.',
  '## Not done yet: what remains, the next step first.',
  '## Files changed: each path and what changed in it.',
  '## Watch out for: decisions made, constraints, what is not yet verified, commands to run.',
  'Be specific: names, paths, branches, commands, numbers. Write in the language the person has been writing in.',
  'Reply with the summary only.',
].join('\n')

// Where a handoff is kept: under the person's Claude folder, by project,
// named by local time; `n` numbers a second one in the same minute.
export function handoffPath(home: string, project: string, now: number, tzOffsetMinutes?: number, n = 1): string {
  const name = project.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  return `${home}/.claude/handoffs/${name}/${stamp(now, tzOffsetMinutes, '-', '')}${n > 1 ? `-${n}` : ''}-handoff.md`
}

// The file: a title naming the project and the time, then the summary.
export function handoffFile(summary: string, project: string, now: number, tzOffsetMinutes?: number): string {
  return `# Handoff: ${project || 'project'}, ${stamp(now, tzOffsetMinutes, ' ', ':')}\n\n${summary.trim()}\n`
}

// The first prompt of the conversation that takes over.
export function handoffMessage(summary: string, path: string): string {
  return `This conversation takes over from an earlier one, handed off to start with a fresh context. Its handoff summary follows; it is also saved at ${path}.\n\n${summary.trim()}`
}

// 2026-11-20-1612 in local time (`between` the date and the time, `colon` within the time).
function stamp(now: number, tzOffsetMinutes: number | undefined, between: string, colon: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = tzOffsetMinutes === undefined ? new Date(now) : new Date(now + tzOffsetMinutes * 60_000)
  const [y, mo, day, h, mi] =
    tzOffsetMinutes === undefined
      ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]
      : [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()]
  return `${y}-${pad(mo)}-${pad(day)}${between}${pad(h)}${colon}${pad(mi)}`
}
