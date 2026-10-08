// Equalizer.
// Audio bars. Thinking: a low, gentle wave. A tool: pulses on the beat.
// Replying: full energy, peaks in the red.

import type { Canvas } from './canvas'
import { C, hash, wrap, type Scene } from './kit'
import type { Mode } from './mode'

function draw(c: Canvas, mode: Mode, t: number) {
  const bars = Math.floor(c.width / 3)
  const beat = mode === 'tool' ? Math.max(0, 1 - wrap(t / 400, 1) * 2) : 0
  for (let i = 0; i < bars; i++) {
    let h: number
    if (mode === 'think') h = 2 + Math.sin(t / 400 + i / 2) * 1.5
    else if (mode === 'tool') h = 2 + beat * 5 * (0.5 + hash(i) / 2) + Math.sin(t / 250 + i) * 0.8
    else h = 2 + hash(Math.floor(t / 90) * 31 + i) * 6
    const top = 8 - Math.max(1, Math.min(8, Math.round(h)))
    for (let y = 7; y >= top; y--) {
      const color = y <= 1 ? C.red : y <= 3 ? C.yellow : C.green
      c.set(i * 3, y, color)
      c.set(i * 3 + 1, y, color)
    }
  }
}

export const equalizer: Scene = { name: 'equalizer', accent: '#9be15d', draw }
