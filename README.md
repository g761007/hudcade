<div align="center">

# 🕹️ hudcade

**A pixel-art HUD for Claude Code.**

Context, cost, cache, agents and rate limits at a glance,<br>
and little 8-bit scenes that play while Claude thinks.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-%E2%89%A5%202.1.290-d97757)](https://code.claude.com)
[![Built as a mod](https://img.shields.io/badge/built%20as%20a-mod-8b949e)](#how-it-works)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)](#requirements)

English · [繁體中文](README.zh-TW.md)

<img src="assets/hud.svg" alt="hudcade inside a Claude Code session: a pixel-scene spinner, the HUD band and the status line" width="100%">

</div>

## Why hudcade

Claude Code shows you the conversation. hudcade shows you everything happening around it.

- **💸 Know what a turn costs while it runs.** Session cost, what this turn has added so far, and how close you are to the 5-hour and 7-day limits, with reset countdowns.
- **🧠 See context filling up before auto-compact hits.** A colored context bar with tokens left, how often the session has compacted, and, once you pass the warning line, what is eating the window.
- **⚡ Catch a broken prompt cache.** Hit ratio for the session. The last request is flagged when it missed, and a resumed session whose cache has expired says so, with the cost of rebuilding it.
- **🤖 Watch every worker at once.** Subagents with their model and current tool, agent-team teammates, background shells and scheduled loops, each on its own row.
- **🕹️ Make waiting fun.** The spinner becomes one of ten little 8-bit scenes that react to what Claude is doing.
- **📱 Walk away.** A Telegram message when a turn finishes, when Claude needs your approval, or when a turn fails.

## Install

In a Claude Code terminal session:

```
/plugin install hudcade --marketplace g761007/hudcade
```

1. Answer `y` to add the marketplace.
2. Pick the user scope.
3. Fill in the options you want. Leave the Telegram fields empty if you don't want notifications.

The HUD shows up right away, in every session from then on, including those the desktop app starts on the same machine.

If you used a `statusLine` command before, you can remove it from `~/.claude/settings.json`. hudcade draws its own status line.

<details>
<summary>Prefer the CLI?</summary>

```sh
claude plugin marketplace add g761007/hudcade
claude plugin install hudcade@hudcade
```

</details>

## What you get

### The HUD band

Above the prompt, in the terminal and in the desktop app. Each row has a left and a right side. On a narrow terminal the least important parts drop out first.

| Row | What it tells you |
|---|---|
| **Identity** | Model and effort · project and branch (dirty, ahead/behind) · lines added and removed and files edited this session · session cost, what this turn added, session time |
| **Capacity** | Context bar, tokens left and compactions · prompt-cache hit ratio · 5-hour and 7-day limits with reset countdowns |
| **Activity** | Working, waiting for your approval, or idle · turn number, start time (and end time once done) · the tool running now · tokens in and out this turn · output speed · tool calls and failures · task progress |
| **Context breakdown** | The largest parts of the window. Only appears once context passes the warning threshold. |
| **Workers** | Subagents, teammates, background tasks and loops, while there are any |

Toasts warn you when context crosses its thresholds, and before a model switch that would throw away a warm prompt cache. The toast includes what rebuilding it will cost.

### The status line

A compact line under the prompt, for when you only want the essentials:

```
Opus 5.5 · xhigh │ ctx 41% │ $3.21 │ 5h 13% │ 7d 38%
```

### The pixel spinner

<img src="assets/demo.gif" alt="The ten spinner scenes, switching between thinking, running a tool and replying" width="828">

While Claude works, the spinner turns into a little 8-bit scene, a different one each turn. Every scene reacts to what Claude is doing:

| Scene | Thinking | Running a tool | Replying |
|---|---|---|---|
| **Robot coder** | The antenna blinks, a question forms | A progress bar fills, gears turn, sparks fly | It types; bits stream out of the screen |
| **Coffee conveyor** | Mugs roll under a slow drip | A kettle pours, the drip speeds up | The belt speeds up, every mug steams |
| **Little garden** | Plants sprout and sway | A watering can flies over | Everything blooms, butterflies arrive |
| **Rocket voyage** | Cruising among the stars | Collecting energy crystals | Warp speed |
| **Cat and yarn** | The cat sits, tail swishing | It pounces, the yarn unrolls | A full-speed chase |
| **Fishing** | The bobber bobs, fish swim below | A bite and a splash | Fish leap out of the water |
| **Steam train** | Puffing through the trees | The cars load cargo | Full steam ahead |
| **Campfire** | Small flames under the stars | A log goes in, the fire flares | A marshmallow toasts |
| **Weather** | Sun and drifting clouds | Storm clouds, rain and lightning | A rainbow and birds |
| **Equalizer** | A low, gentle wave | Pulses on the beat | Peaks in the red |

Next to the scene are the spinner word, the elapsed time, the effort, the current activity, and what the turn has done so far: tool calls, output tokens, speed and cost (`2 tools · ↓900 · 50 tok/s · +$0.42`). Pin one scene with the `spinnerScene` option.

The spinner is terminal only; the desktop app keeps its own.

### Telegram notifications

```
✅ Claude Code is done
Project: my-app (feat/retry)
Time: 2026-10-08 14:34:19 CST
Took 2m14s · Opus 5.5 · xhigh · $3.21
5h:13%(2h02m) wk:81%(5d16h) ctx:65%(opus)
Summary: Added a retry policy with exponential backoff and covered it with 6 tests.
Session: 11fa1a35
```

Messages are sent in three cases:

- **A turn completes.** Turns you interrupt and subagent turns are skipped.
- **A permission prompt is waiting.**
- **A turn fails**, for example on a rate limit.

Messages come in English or Traditional Chinese. By default they follow Claude Code's own `language` setting. The bot token stays in Claude Code's secure storage and never appears in a log.

## Configuration

Everything lives in `/config`, or run `claude plugin configure hudcade`:

| Option | Default | Meaning |
|---|---|---|
| `hud` | `true` | The HUD band |
| `statusLine` | `true` | The line under the prompt |
| `spinner` | `true` | The pixel spinner (terminal) |
| `spinnerScene` | `random` | `random`, or one of `robot`, `coffee`, `garden`, `rocket`, `cat`, `fishing`, `train`, `campfire`, `weather`, `equalizer` |
| `ctxWarnPercent` / `ctxCriticalPercent` | `60` / `80` | Context thresholds for colors, toasts and the breakdown row |
| `notify` | `true` | Telegram notifications |
| `notifyMinTurnSeconds` | `0` | Skip completion messages for shorter turns; `0` sends every turn |
| `notifyBlocklist` | empty | Project folder names that never notify, separated by spaces |
| `notifyLanguage` | `auto` | `auto` follows Claude Code's `language` setting (Chinese there means Traditional Chinese, anything else English); or `en`, `zh-TW` |
| `telegramBotToken` / `telegramChatId` | — | Your bot and chat. When unset, `~/.claude/hooks/.telegram.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) is read if it exists |

Per project, `.claude/claude-mods.json` (shared with the team) and `.claude/claude-mods.local.json` (just you) override any option except the Telegram credentials:

```json
{ "notify": false, "spinnerScene": "campfire" }
```

Commands:

- `/hud`: what is switched on, where the settings came from, and what the HUD has read.
- `/hud test-notify`: send a test Telegram message.

## How it works

hudcade is a **mod**: a plugin of function hooks that runs inside Claude Code itself.

- **No statusline script.** Nothing is spawned on every refresh, and no transcript files are parsed.
- **It reads the engine directly.** Usage, cost and rate limits come from `$.session.usage()`. Tool calls, subagents and tasks come from `tool.call` and the session events. Tokens, cache reads and output speed come from the model's own response stream.
- **The drawing goes through Claude Code's UI.** The band and the status line are drawn with the UI's elements. The scenes are a `Raster` repainted about twelve times a second while a turn runs, and only then.
- **The logic is plain TypeScript, separate from the hooks.** The HUD model, the layout, the scenes and the messages are pure functions, covered by tests that also mount the band on the terminal and desktop surfaces.

## Requirements

- Claude Code **2.1.290** or newer. Mods are on by default from 2.1.287; their API is still marked early access.
- macOS or Linux, with `git` and `date` on `PATH`.
- A Telegram bot, only if you want notifications.

## Known limits

- **Background tasks and loops** refresh when a turn ends. One that finishes while you are idle stays listed until the next turn.
- **Lines added and removed** count Edit and Write changes, not files changed through shell commands.
- **Output speed** counts from the first streamed chunk, thinking included.
- **Before the first reply** of a session, Claude Code has no context or rate-limit readings yet. The band says so instead of showing zeros.

## Troubleshooting

- **Nothing shows.** Run `/hud` to see what the HUD has read and any reading that failed. For more detail, start `claude --debug` and look for lines starting with `hudcade:`.
- **No Telegram message.** `/hud` tells you whether Telegram is configured. Then try `/hud test-notify`.

## Development

```
.claude-plugin/marketplace.json   the marketplace
plugin/                           the mod
  .claude-plugin/plugin.json      manifest and options
  hooks/register.tsx              every hook
  src/core/                       pure logic: HUD model, band layout, config, messages
  src/core/scenes/                one file per spinner scene
  types/index.d.ts                the session-state contract
  tests/                          unit and drawing tests
scripts/render-assets.ts          renders assets/ from the mod's own code
```

```sh
tsc -p plugin                             # type-check (TypeScript 5.4+)
claude plugin validate plugin --strict    # what the engine would refuse
claude plugin test plugin                 # tests, terminal and desktop surfaces
claude --plugin-dir ./plugin              # run your working copy; saving a file reloads it
bun scripts/render-assets.ts              # regenerate the README images (Bun + ImageMagick)
```

All hooks live in one file because of two engine rules:

- A module registers one hook per event.
- The engine follows `$` only into functions declared in the same file.

The editor and `tsc` read the API declarations from `plugin/.claude-plugin/types/`. The engine writes that folder whenever it loads the mod. Before the first load, copy it from the `plugin-authoring` skill's `types/claude-code.d.ts`.

## Contributing

Issues and pull requests are welcome, especially new scenes, new HUD rows and notification channels beyond Telegram.

A scene is one file in `plugin/src/core/scenes/`: a `draw(canvas, mode, t)` function that paints an 8-pixel-tall frame for the `think`, `tool` and `reply` moods. Register it in `scenes/index.ts`, add its name to `SceneName` and to the `spinnerScene` options, and the tests check that it draws in every mood and at every width.

Please run the three checks above before opening a PR.

## Disclaimer

hudcade is an independent community project. It is not affiliated with, endorsed by or sponsored by Anthropic. Claude and Claude Code are trademarks of Anthropic, PBC.

## License

[MIT](LICENSE)
