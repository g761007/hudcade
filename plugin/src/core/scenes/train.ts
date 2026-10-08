// Steam train.
// A steam train through the trees. Thinking: steady, puffing smoke rings. A
// tool: the cars load cargo. Replying: full steam, smoke pouring out.

import type { Canvas } from './canvas'
import { C, wrap, type Scene } from './kit'
import type { Mode } from './mode'

const ENGINE = ['.cc..KKK.', '.cc..KwK.', 'BBBBBKKKK', 'BBBBBBBBB', '.o..o..o.']
const CAR = ['.......', 'GGGGGGG', 'GGGGGGG', '.o...o.']
function draw(c: Canvas, mode: Mode, t: number) {
  const speed = mode === 'reply' ? 30 : 12
  const scroll = (t / 1000) * speed
  for (let k = 0; k < 4; k++) {
    const x = wrap(k * 15 - scroll / 2, c.width + 6) - 3
    c.sprite(['..t..', '.ttt.', 'ttttt', '..b..'], x, 2, { t: C.dgreen, b: C.dbrown })
  }
  for (let x = 0; x < c.width; x++) c.set(x, 7, wrap(x + Math.floor(scroll), 4) === 0 ? C.dbrown : C.gray)
  const wheel = Math.floor(t / (mode === 'reply' ? 60 : 140)) % 2
  const ex = 26
  c.sprite(ENGINE, ex, 2, { c: C.dgray, K: C.navy, w: C.yellow, B: C.red, o: wheel ? C.gray : C.white })
  for (let car = 0; car < 2; car++) {
    const x = ex - 8 - car * 8
    c.sprite(CAR, x, 3, { G: car ? C.dgreen : C.purple, o: wheel ? C.gray : C.white })
    if (mode === 'tool') {
      const loaded = Math.floor(t / 300) % 4
      for (let b = 0; b < Math.min(3, loaded + car); b++) c.set(x + 1 + b * 2, 3, [C.yellow, C.cyan, C.orange][b]!)
    }
  }
  const puffs = mode === 'reply' ? 6 : 3
  for (let p = 0; p < puffs; p++) {
    const age = wrap(t / (mode === 'reply' ? 90 : 220) + p * (6 / puffs), 6)
    const x = ex + 1 - age * 1.5
    const y = 1 - age * 0.25
    if (y >= 0) {
      c.set(x, y, age < 3 ? C.white : C.gray)
      if (age > 1.5) c.set(x - 1, y, C.gray)
    }
  }
}

export const train: Scene = { name: 'train', accent: '#e0404a', draw }
