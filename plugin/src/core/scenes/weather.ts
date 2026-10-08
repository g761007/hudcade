// Weather.
// A little village under the sky. Thinking: sun and drifting clouds. A tool:
// storm clouds, rain and lightning. Replying: a rainbow and birds.

import type { Canvas } from './canvas'
import { C, wrap, type Scene } from './kit'
import type { Mode } from './mode'

function draw(c: Canvas, mode: Mode, t: number) {
  for (let x = 0; x < c.width; x++) c.set(x, 7, C.green)
  c.sprite(['.r.', 'rrr', 'wdw'], 4, 4, { r: C.red, w: C.cream, d: C.brown })
  c.sprite(['.t.', 'ttt', '.b.'], 38, 4, { t: C.dgreen, b: C.dbrown })
  c.sprite(['.t.', 'ttt', '.b.'], 43, 4, { t: C.green, b: C.dbrown })
  if (mode === 'reply') {
    const bands = [C.red, C.orange, C.yellow, C.green, C.blue]
    bands.forEach((color, i) => {
      for (let x = 8 + i; x < 36 - i; x++) {
        const y = Math.round(i + 6 - Math.sin(((x - 8) / 28) * Math.PI) * 6)
        if (y >= 0 && y < 7) c.set(x, y, color)
      }
    })
    for (let b = 0; b < 2; b++) {
      const x = wrap((t / 1000) * 12 + b * 9, c.width)
      const up = Math.floor(t / 150 + b) % 2
      c.set(x, 1 + b, C.dgray)
      c.set(x - 1, up ? b : 1 + b, C.dgray)
      c.set(x + 1, up ? b : 1 + b, C.dgray)
    }
    return
  }
  const stormy = mode === 'tool'
  if (!stormy) {
    const sx = 10 + wrap((t / 1000) * 2, 24)
    c.sprite(['.y.', 'yYy', '.y.'], sx, 0, { y: C.yellow, Y: C.orange })
  }
  for (let k = 0; k < 3; k++) {
    const x = wrap(k * 17 + (t / 1000) * (stormy ? 6 : 3), c.width + 8) - 6
    c.sprite(['.cc..', 'ccccc'], x, 1 + (k % 2), { c: stormy ? C.dgray : C.white })
    if (stormy) for (let d = 0; d < 3; d++) c.set(x + 1 + d * 2 - (Math.floor(t / 70) % 2), 3 + wrap(Math.floor(t / 60) + d * 2, 4), C.blue)
  }
  if (stormy && Math.floor(t / 100) % 12 === 0) c.sprite(['.Y', 'Y.', '.Y', 'Y.'], 26, 2, { Y: C.yellow })
}

export const weather: Scene = { name: 'weather', accent: '#60a5fa', draw }
