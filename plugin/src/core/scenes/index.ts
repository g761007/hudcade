import type { SceneName } from '../../../types'
import { campfire } from './campfire'
import { Canvas } from './canvas'
import { cat } from './cat'
import { coffee } from './coffee'
import { equalizer } from './equalizer'
import { fishing } from './fishing'
import { garden } from './garden'
import type { Scene } from './kit'
import type { Mode } from './mode'
import { robot } from './robot'
import { rocket } from './rocket'
import { train } from './train'
import { weather } from './weather'

export { modeLabel, modeOf, type Mode, type SpinnerMode } from './mode'

export const SCENES: Record<SceneName, Scene> = { robot, coffee, garden, rocket, cat, fishing, train, campfire, weather, equalizer }

export const SCENE_NAMES = Object.keys(SCENES) as SceneName[]

export const SCENE_ROWS = 4 // terminal rows: 8 pixels tall

// One frame of `name` as Raster cells, `columns` wide and SCENE_ROWS tall.
export function renderScene(name: SceneName, mode: Mode, t: number, columns: number): string {
  const canvas = new Canvas(columns, SCENE_ROWS * 2)
  SCENES[name].draw(canvas, mode, t)
  return canvas.toCells()
}

// A fixed choice, or a different scene than last turn's for `random`.
export function pickScene(choice: string, last: SceneName | undefined, roll: number): SceneName {
  if ((SCENE_NAMES as readonly string[]).includes(choice)) return choice as SceneName
  const pool = SCENE_NAMES.filter(name => name !== last)
  return pool[Math.floor(Math.abs(roll) * pool.length) % pool.length]!
}
