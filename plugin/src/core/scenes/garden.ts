// Little garden.
// A row of plants. Thinking: they sprout and grow in turn, swaying. A tool:
// a watering can flies over and they grow faster. Replying: everything
// blooms and butterflies come.

import type { Canvas } from './canvas'
import { C, wrap, type Scene } from './kit'
import type { Mode } from './mode'

const STAGES = [
  ['.....', '.....', '.....', '.....', '..s..'],
  ['.....', '.....', '.....', '..g..', '..g..'],
  ['.....', '.....', '.lg..', '..gl.', '..g..'],
  ['.....', '..b..', '.lgl.', '..g..', '..g..'],
  ['.ppp.', '.pyp.', '.pgp.', '.lgl.', '..g..'],
]
function draw(c: Canvas, mode: Mode, t: number) {
  c.hline(0, c.width - 1, 7, C.dbrown)
  for (let x = 0; x < c.width; x += 3) c.set(x, 6 + (x % 2), C.dgreen)
  const rate = mode === 'tool' ? 1.4 : 0.5
  const colors = [C.pink, C.yellow, C.purple, C.red, C.orange]
  for (let k = 0; k < 5; k++) {
    const stage = mode === 'reply' ? 4 : Math.floor(wrap((t / 1000) * rate + k * 0.9, 5))
    const sway = Math.round(Math.sin(t / 300 + k)) * (stage >= 2 ? 1 : 0)
    const rows = STAGES[stage]!
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < 5; dx++) {
        const key = row[dx]!
        if (key === '.') continue
        const color = { s: C.dbrown, g: C.green, l: C.lime, b: colors[k]!, p: colors[k]!, y: C.yellow }[key]!
        c.set(3 + k * 9 + dx + (dy < 3 ? sway : 0), 2 + dy, color)
      }
    })
  }
  if (mode === 'tool') {
    const x = wrap((t / 1000) * 14, c.width + 10) - 5
    c.sprite(['.CC.', 'CCCCs', 'CCC..'], x, 0, { C: C.steel, s: C.gray })
    for (let i = 0; i < 3; i++) c.set(x + 5, 2 + wrap(Math.floor(t / 80) + i * 2, 5), C.cyan)
  }
  if (mode === 'reply') {
    for (let b = 0; b < 3; b++) {
      const x = wrap((t / 1000) * 9 + b * 17, c.width)
      const y = 1 + Math.round(Math.sin(t / 200 + b * 2) * 1.2)
      const open = Math.floor(t / 120 + b) % 2 === 0
      c.set(x, y, b % 2 ? C.yellow : C.cyan)
      if (open) {
        c.set(x - 1, y - 1, b % 2 ? C.yellow : C.cyan)
        c.set(x + 1, y - 1, b % 2 ? C.yellow : C.cyan)
      }
    }
  }
}

export const garden: Scene = { name: 'garden', accent: '#3fbf5f', draw }
