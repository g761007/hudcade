// Rocket voyage.
// A rocket among stars. Thinking: it cruises, bobbing gently. A tool: it
// collects energy crystals. Replying: warp speed, stars stretch into
// streaks.

import type { Canvas } from './canvas'
import { C, hash, wrap, type Scene } from './kit'
import type { Mode } from './mode'

const ROCKET = ['.WW.....', 'RWWWWWW.', 'RWWCWWWR', 'RWWWWWW.', '.WW.....']
function draw(c: Canvas, mode: Mode, t: number) {
  const warp = mode === 'reply'
  for (let k = 0; k < 18; k++) {
    const layer = k % 2
    const speed = (layer ? 22 : 9) * (warp ? 4 : 1)
    const x = wrap(hash(k) * c.width - (t / 1000) * speed, c.width)
    const y = Math.floor(hash(k + 50) * 8)
    if (warp) for (let d = 0; d < 4 + layer * 3; d++) c.set(x + d, y, layer ? C.white : C.gray)
    else c.set(x, y, layer ? C.white : C.dgray)
  }
  const bob = warp ? 0 : Math.round(Math.sin(t / 400))
  const flame = (warp ? 6 : 3) + (Math.floor(t / 80) % 2)
  for (let i = 0; i < flame; i++) c.set(11 - i, 3 + bob, i < 2 ? C.yellow : C.orange)
  if (warp) {
    c.set(11 - 1, 2 + bob, C.orange)
    c.set(11 - 1, 4 + bob, C.orange)
  }
  c.sprite(ROCKET, 12, 1 + bob, { W: C.white, R: C.red, C: C.cyan })
  if (mode === 'tool') {
    for (let k = 0; k < 3; k++) {
      const x = wrap(c.width - (t / 1000) * 16 - k * 15, c.width + 6) + 2
      const y = 1 + Math.floor(hash(k + Math.floor((t / 1000) * 16 / (c.width + 6))) * 4)
      if (x < 21) {
        if (x > 17) c.set(x, y + 1, C.yellow)
        continue
      }
      c.sprite(['.d.', 'ddd', '.d.'], x, y, { d: C.cyan })
    }
  }
}

export const rocket: Scene = { name: 'rocket', accent: '#f28c28', draw }
