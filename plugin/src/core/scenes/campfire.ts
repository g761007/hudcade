// Campfire.
// A campfire under the stars. Thinking: small flames, a few sparks. A tool:
// a log goes in and the fire flares. Replying: a marshmallow toasts from
// white to brown.

import type { Canvas } from './canvas'
import { C, hash, wrap, type Scene } from './kit'
import type { Mode } from './mode'

function draw(c: Canvas, mode: Mode, t: number) {
  for (let k = 0; k < 10; k++) if (Math.floor(t / 400 + k * 3) % 5 !== 0) c.set(Math.floor(hash(k) * c.width), Math.floor(hash(k + 9) * 3), C.white)
  c.sprite(['.YY', 'Y..', 'Y..', '.YY'], 42, 0, { Y: C.cream })
  c.sprite(['...T...', '..TTT..', '.TTdTT.', 'TTTddTT'], 2, 4, { T: C.orange, d: C.dbrown })
  const fx = 20
  c.hline(fx - 3, fx + 3, 7, C.brown)
  c.set(fx - 2, 6, C.dbrown)
  c.set(fx + 2, 6, C.dbrown)
  const big = mode === 'tool' ? 1 + Math.max(0, 2 - wrap(t / 400, 4)) : 0
  for (let dx = -2; dx <= 2; dx++) {
    const h = Math.max(1, Math.round(3 + big + hash(Math.floor(t / 90) * 7 + dx) * 2 - Math.abs(dx)))
    for (let i = 0; i < h; i++) {
      const y = 6 - i
      c.set(fx + dx, y, i >= h - 1 ? C.yellow : i >= h - 2 ? C.orange : C.red)
    }
  }
  const sparks = mode === 'tool' ? 6 : 2
  for (let s = 0; s < sparks; s++) {
    const age = wrap(t / 120 + s * 2.3, 6)
    c.set(fx + Math.round(Math.sin(s * 5 + t / 300) * 2), 3 - age, age < 3 ? C.yellow : C.orange)
  }
  if (mode === 'tool') {
    const p = wrap(t / 1600, 1)
    if (p < 0.3) {
      const x = 36 - p * 50
      c.hline(x, x + 2, 4 - Math.sin((p / 0.3) * Math.PI) * 3, C.brown)
    }
  }
  if (mode === 'reply') {
    for (let x = 25; x < 32; x++) c.set(x, 3 + Math.floor((x - 25) / 4), C.tan)
    const toast = Math.floor(t / 700) % 3
    c.sprite(['mm', 'mm'], 23, 3, { m: [C.white, C.tan, C.brown][toast]! })
  }
}

export const campfire: Scene = { name: 'campfire', accent: '#ffd23f', draw }
