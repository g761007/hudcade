// Coffee conveyor.
// Mugs ride a conveyor under a pour-over. Thinking: slow drips. A tool: a
// kettle pours and the drip speeds up. Replying: the belt speeds up and
// every mug steams.

import type { Canvas } from './canvas'
import { C, wrap, type Scene } from './kit'
import type { Mode } from './mode'

const MUG = ['WKKKW.', 'WKKKWh', 'WWWWWh', '.WWW..']
function draw(c: Canvas, mode: Mode, t: number) {
  const speed = mode === 'reply' ? 14 : mode === 'tool' ? 6 : 4
  const dripX = 20
  c.sprite(['DDDDDDD', '.DDDDD.', '..DDD..'], dripX - 3, 0, { D: C.tan })
  if (mode === 'tool') {
    c.sprite(['.KKKK', 'KKKKK', '.KKK.'], dripX - 11, 0, { K: C.steel })
    for (let x = dripX - 6; x <= dripX - 4; x++) c.set(x, 0, C.cyan)
  }
  const dripEvery = mode === 'think' ? 260 : 120
  c.set(dripX, 3 + ((t % dripEvery) / dripEvery > 0.5 ? 1 : 0), C.dbrown)
  const spacing = 11
  const offset = (t / 1000) * speed
  for (let k = -1; k < c.width / spacing + 1; k++) {
    const x = Math.round(k * spacing + wrap(offset, spacing)) - 2
    const center = x + 2
    const isFull = center > dripX + 1
    const isFilling = Math.abs(center - dripX) <= 1
    const inside = isFull ? C.dbrown : isFilling ? C.brown : 0x1f2937
    c.sprite(MUG, x, 3, { W: C.white, h: C.white, K: inside })
    if (isFull && (mode !== 'think' || k % 2 === 0)) {
      const s = Math.floor(t / 160 + k) % 3
      c.set(x + 1 + s, 2 - (s % 2), 0xcbd5e1)
      if (mode === 'reply') c.set(x + 3 - s, 1 + (s % 2), 0xcbd5e1)
    }
  }
  for (let x = 0; x < c.width; x++) c.set(x, 7, wrap(x - Math.floor(offset), 3) === 0 ? C.dgray : C.gray)
}

export const coffee: Scene = { name: 'coffee', accent: '#d8a46a', draw }
