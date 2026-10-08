// Effective configuration: the plugin's userConfig options, overridden per
// project by .claude/claude-mods.json and .claude/claude-mods.local.json.

import type { SceneName } from '../../types'
import { SCENE_NAMES } from './scenes'
import type { LanguageChoice } from './telegram'

export type SceneChoice = 'random' | SceneName

export type ModsConfig = {
  hud: boolean
  statusLine: boolean
  spinner: boolean
  spinnerScene: SceneChoice
  ctxWarnPercent: number
  ctxCriticalPercent: number
  notify: boolean
  notifyMinTurnSeconds: number
  notifyBlocklist: string[]
  notifyLanguage: LanguageChoice
  telegramBotToken?: string
  telegramChatId?: string
}

export const DEFAULTS: ModsConfig = {
  hud: true,
  statusLine: true,
  spinner: true,
  spinnerScene: 'random',
  ctxWarnPercent: 60,
  ctxCriticalPercent: 80,
  notify: true,
  notifyMinTurnSeconds: 0,
  notifyBlocklist: [],
  notifyLanguage: 'auto',
}

const SCENE_CHOICES: readonly SceneChoice[] = ['random', ...SCENE_NAMES]

// Secrets stay out of project files: only these keys may be overridden there.
const PROJECT_KEYS = [
  'hud',
  'statusLine',
  'spinner',
  'spinnerScene',
  'ctxWarnPercent',
  'ctxCriticalPercent',
  'notify',
  'notifyMinTurnSeconds',
  'notifyBlocklist',
  'notifyLanguage',
] as const

// What every module reads. Created from userConfig when the module loads and
// completed at session.start, once project files can be read through `$`.
export type Runtime = {
  config: ModsConfig
  warnings: string[]
  sources: string[]
  telegramSource?: string
}

export type Layer = { source: string; values: Record<string, unknown> }

export type ConfigResult = { config: ModsConfig; warnings: string[] }

export function createRuntime(options: Record<string, unknown>): Runtime {
  const { config, warnings } = resolveConfig(options, [])
  return { config, warnings, sources: ['userConfig'] }
}

export function resolveConfig(options: Record<string, unknown>, projectLayers: Layer[]): ConfigResult {
  const warnings: string[] = []
  const config: ModsConfig = { ...DEFAULTS, notifyBlocklist: [...DEFAULTS.notifyBlocklist] }

  apply(config, options, 'userConfig', Object.keys(options), warnings)
  for (const layer of projectLayers) {
    apply(config, layer.values, layer.source, PROJECT_KEYS, warnings)
  }
  return { config, warnings }
}

function apply(
  config: ModsConfig,
  values: Record<string, unknown>,
  source: string,
  allowed: readonly string[],
  warnings: string[],
): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue
    if (!allowed.includes(key)) {
      warnings.push(`${source}: unknown or not overridable key "${key}"`)
      continue
    }
    const error = set(config, key, value)
    if (error) warnings.push(`${source}: ${error}`)
  }
}

function set(config: ModsConfig, key: string, value: unknown): string | undefined {
  switch (key) {
    case 'hud':
    case 'statusLine':
    case 'spinner':
    case 'notify':
      if (typeof value !== 'boolean') return `"${key}" must be a boolean`
      config[key] = value
      return
    case 'ctxWarnPercent':
    case 'ctxCriticalPercent':
    case 'notifyMinTurnSeconds':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return `"${key}" must be a non-negative number`
      }
      config[key] = value
      return
    case 'spinnerScene':
      if (!SCENE_CHOICES.includes(value as SceneChoice)) return `"spinnerScene" must be one of ${SCENE_CHOICES.join(', ')}`
      config.spinnerScene = value as SceneChoice
      return
    case 'notifyLanguage':
      if (value !== 'auto' && value !== 'en' && value !== 'zh-TW') return '"notifyLanguage" must be one of auto, en, zh-TW'
      config.notifyLanguage = value
      return
    case 'notifyBlocklist':
      if (typeof value === 'string') config.notifyBlocklist = value.split(/\s+/).filter(Boolean)
      else if (Array.isArray(value) && value.every(v => typeof v === 'string')) config.notifyBlocklist = value
      else return '"notifyBlocklist" must be a space-separated string or a string array'
      return
    case 'telegramBotToken':
    case 'telegramChatId':
      if (typeof value !== 'string') return `"${key}" must be a string`
      config[key] = value.trim()
      return
    default:
      return `unknown key "${key}"`
  }
}

// Parses KEY="value" lines of a shell env file (the old notify hook's format).
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) continue
    let value = match[2]!.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[match[1]!] = value
  }
  return out
}
