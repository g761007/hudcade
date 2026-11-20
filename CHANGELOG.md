# Changelog

All notable changes to hudcade are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-20

### Added

- Turn replay: `/hud replay` opens a pane on the last turn that called
  tools, and you step through it call by call: each call's tool, its
  arguments in full, its outcome and time, the start of what it answered,
  and the lines an edit changed. `d` opens the diff an Edit or Write asked
  for, noted from the file before the call ran, so a refused one shows too.
  `a` goes into a subagent's own track of calls; `b` or Escape goes back.
  The last replay of each project is kept on disk, so it outlives a restart.
  The idle band offers it once such a turn ends.
- One-click handoff: from `handoffPercent` of context (80% by default) the
  idle band offers a handoff button, and `/hud handoff` runs one at any
  time. A fork of the conversation writes a summary (goal, done, not done
  yet, files changed, what to watch out for), saved under
  `~/.claude/handoffs/<project>/`; the conversation is cleared and starts
  over with the summary as its first prompt. With no summary, the
  conversation is left as it was.
- `/hud handoff-at <percent>` sets the handoff threshold from the prompt,
  kept across sessions; `/hud handoff-at default` goes back to the option.
- `/hud` shows what the cache countdown counts from: the cache's lifetime,
  when the main conversation's last request was sent, and when the cache
  runs out.

### Changed

- The idle band's prompt-cache countdown turns amber five minutes before
  the cache runs out, and a toast says so once. Run out, it reads `cache
  expired · next prompt rebuilds it` in red instead of `cache cold`.

### Fixed

- After a reload of the mod, an idle band counts the cache down again
  instead of waiting for the next turn.
- After a `/clear`, the band names the project and branch again from the
  first turn on.

## [0.3.0] - 2026-11-20

### Removed

- The status line under the prompt, and its `statusLine` option. It repeated
  the band's first two rows, and Claude Code draws a mod's status as a
  `⚠ hudcade:` notice, which read like a warning.
- Subagent rows on the HUD band. Claude Code lists running subagents under
  the prompt itself. The dim line under each running Agent call and the
  `/hud agents` pane stay.

### Changed

- While hudcade's spinner runs in the terminal, the band leaves it the turn's
  clock, output tokens, speed, tool calls and cost instead of showing them
  twice. The desktop app, and a terminal with the spinner off, keep them.
- The band no longer shows what the turn added to the cost when that is all
  the session has spent (`$3.79 +3.79`).

### Added

- A forecast on the 5-hour and 7-day limits, at the pace since the window
  opened, once it heads past 75%: `→92%` at the reset, or `→full in 50m`.
- A Telegram message when the background agents a turn left running have all
  ended while you are idle, listing each with how it ended.

## [0.2.0] - 2026-11-20

### Fixed

- Subagent rows on the HUD band, on Team and Enterprise plans where
  Claude Code passes every classic hook over:
  - A workflow's agent or a fork no longer takes over the row of an Agent
    call still starting, and ends when its run does instead of spinning on.
  - A subagent's turn no longer counts as a new turn of the band, restarts
    its clock or picks a new spinner scene (Claude Code 2.1.329 raises
    `turn.start` for subagents too).
  - A finished row now goes a minute after it ended even while you are idle,
    not at the next prompt.
  - An agent taken up again by a message runs again on its row.
  - A teammate's tool calls no longer add an agent row that never ends.
- Where both classic and native events arrive, a guess from `SubagentStart`
  now gives way to the exact link from `agent.spawn`, and permission and
  failure messages and compactions count once.

### Added

- Native fallbacks for classic hooks: `agent.report` ends an agent's row with
  how its run ended (✓, ✗, or ⏹ for stopped); `session.compact` counts
  compactions; the prompt-cache lifetime comes from each response's usage;
  a permission prompt is inferred from `tool.check`, so the band shows
  "waiting for you" and Telegram is told.
- Step recap (opt-in `recap`, `recapModel`): a small model sums up the
  running turn in one line of the band, at most once every 10 seconds.
- While idle, the band counts down how long the prompt cache still holds the
  conversation, then says it is cold.
- Agent rows show their context share and a sparkline of their tokens; a dim
  line under each running Agent call in the transcript shows its live state;
  `/hud agents` opens a pane with every agent and its task.
- The idle band says when the last turn was interrupted or failed.

## [0.1.2] - 2026-10-19

### Fixed

- A subagent's row on the HUD band now shows the time the agent spent working,
  not how long the row has been listed. The clock stops when the agent's run
  ends and picks up again when the agent takes on more work, so an agent left
  idle no longer adds hours to its row. A row from an older version of the mod
  starts at 0:00 and counts from the agent's next request.

## [0.1.1] - 2026-10-12

### Fixed

- A background subagent's row on the HUD band no longer keeps spinning after
  the agent has finished when Claude Code's `SubagentStop` event never reaches
  the mod. The band now checks Claude Code's agent list when a main turn ends,
  at `Stop`, and every 15 seconds while something runs. A row the list reports
  as completed turns ✓, one reported failed or killed turns ✗, and a launched
  agent the list no longer shows is marked done.

### Changed

- Teammate rows refresh at those same points too, not only when a turn ends
  or a subagent starts.

## [0.1.0] - 2026-10-08

The first release.

### Added

- HUD band above the prompt, in the terminal and the desktop app: model and
  effort, project and git branch, lines changed, session and turn cost,
  context, prompt-cache hit ratio, 5-hour and 7-day limits, turn activity,
  task progress, and subagents, teammates, background tasks and loops.
- Compact status line under the prompt.
- Pixel spinner (terminal): ten original 8-bit scenes that react to thinking,
  tool use and replies.
- Telegram notifications for completed turns, permission prompts and failures,
  in English or Traditional Chinese.
- Toasts at the context warning and critical thresholds, and before a model
  switch that would throw away a warm prompt cache.

[0.4.0]: https://github.com/g761007/hudcade/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/g761007/hudcade/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/g761007/hudcade/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/g761007/hudcade/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/g761007/hudcade/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/g761007/hudcade/releases/tag/v0.1.0
