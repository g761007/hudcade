# Changelog

All notable changes to hudcade are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/g761007/hudcade/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/g761007/hudcade/releases/tag/v0.1.0
