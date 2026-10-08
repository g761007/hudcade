// Fishing.
// Someone fishing off a pier. Thinking: the bobber bobs, fish shadows swim
// by. A tool: a bite, the bobber dips with a splash. Replying: fish leap out
// of the water.

import type { Canvas } from './canvas'
import { C, wrap, type Scene } from './kit'
import type { Mode } from './mode'

function draw(c: Canvas, mode: Mode, t: number) {
  for (let y = 5; y < 8; y++) for (let x = 0; x < c.width; x++) c.set(x, y, y === 5 ? (wrap(x + Math.floor(t / 150), 6) < 2 ? 0x60a5fa : C.water) : C.navy)
  for (let x = 0; x < 9; x++) c.set(x, 4, C.brown)
  c.set(1, 5, C.dbrown)
  c.set(7, 5, C.dbrown)
  c.sprite(['.s.', 'rrr', '.r.', 'b.b'], 4, 0, { s: C.skin, r: C.red, b: C.navy })
  // Rod from the hand up to the tip.
  for (let i = 0; i < 6; i++) c.set(7 + i, 1 - Math.floor(i / 3), C.dbrown)
  const bobberX = 22
  let bobberY = 5
  if (mode === 'think') bobberY = 5 - (Math.floor(t / 450) % 2)
  if (mode === 'tool') bobberY = Math.floor(t / 150) % 3 === 0 ? 6 : 5
  for (let x = 13; x < bobberX; x++) {
    const y = Math.round(0 + ((x - 13) / (bobberX - 13)) * (bobberY - 0.5))
    if (y < 5) c.set(x, y, 0xcbd5e1)
  }
  c.set(bobberX, bobberY - 1, C.white)
  c.set(bobberX, bobberY, C.red)
  if (mode === 'tool') for (const dx of [-2, 2]) if (Math.floor(t / 150) % 3 === 0) c.set(bobberX + dx, 4, 0xbfdbfe)
  if (mode === 'think') {
    for (let k = 0; k < 2; k++) {
      const x = wrap(30 + k * 9 - (t / 1000) * (4 + k * 2), c.width - 12) + 12
      c.hline(x, x + 2, 7, 0x1e40af)
    }
  }
  if (mode === 'reply') {
    const p = wrap(t / 900, 1)
    const x = bobberX + 6 - p * 14
    const y = 6 - Math.sin(p * Math.PI) * 6
    c.sprite(p < 0.5 ? ['.oo.o', 'ooooo'] : ['o.oo.', 'ooooo'], x, y, { o: C.orange })
    if (p < 0.12) for (const dx of [-1, 1, 3]) c.set(bobberX + 6 + dx, 4, 0xbfdbfe)
  }
}

export const fishing: Scene = { name: 'fishing', accent: '#3b82f6', draw }
