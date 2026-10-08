// Robot coder.
// A robot at its desk. Thinking: the antenna blinks and a question forms. A
// tool: a progress bar fills while gears turn and sparks fly. Replying: it
// types and bits stream out of the screen.

import type { Canvas } from './canvas'
import { C, hash, wrap, type Scene } from './kit'
import type { Mode } from './mode'

const ROBOT = ['...a...', '.HHHHH.', '.HeHeH.', '.HHHHH.', '..BBB..', 'ABBBBBA', '..BBB..', '..L.L..']
const ROBOT_TYPING = ['...a...', '.HHHHH.', '.HeHeH.', '.HHHHH.', '..BBB..', '.ABBBA.', 'A.BBB.A', '..L.L..']
const GEAR = [
  ['.g.g.', 'ggggg', '.g.g.', 'ggggg', '.g.g.'],
  ['g.g.g', '.ggg.', 'gg.gg', '.ggg.', 'g.g.g'],
]
function draw(c: Canvas, mode: Mode, t: number) {
  const blink = Math.floor(t / (mode === 'tool' ? 120 : 500)) % 2 === 0
  const typing = mode === 'reply' && Math.floor(t / 90) % 2 === 0
  c.sprite(typing ? ROBOT_TYPING : ROBOT, 2, 0, {
    a: blink ? (mode === 'tool' ? C.orange : C.red) : C.dgray,
    H: C.gray,
    e: C.cyan,
    B: C.steel,
    A: C.gray,
    L: C.dgray,
  })
  // Monitor and desk.
  for (let y = 0; y < 6; y++) for (let x = 11; x < 21; x++) c.set(x, y, y === 0 || y === 5 || x === 11 || x === 20 ? C.dgray : 0x0b2e1a)
  c.set(15, 6, C.dgray)
  c.set(16, 6, C.dgray)
  c.hline(9, 22, 7, C.brown)
  if (mode === 'think') {
    if (Math.floor(t / 400) % 2 === 0) c.set(13, 2, C.green)
    const dots = Math.floor(t / 300) % 4
    for (let i = 0; i < dots; i++) c.set(24 + i * 2, 4 - i, C.white)
    if (dots === 3) c.sprite(['WW.', '..W', '.W.', '...', '.W.'], 31, 0, { W: C.yellow })
  } else if (mode === 'tool') {
    const fill = Math.floor((t / 120) % 7)
    for (let x = 13; x < 13 + fill; x++) c.set(x, 3, C.yellow)
    c.sprite(GEAR[Math.floor(t / 150) % 2]!, 26, 1, { g: C.gray })
    c.sprite(GEAR[1 - (Math.floor(t / 150) % 2)]!, 31, 3, { g: C.steel })
    for (let k = 0; k < 4; k++) {
      const age = wrap(t / 60 + k * 3, 10)
      c.set(9 + age * 0.6, 4 - age * 0.3 + (k % 2), k % 2 ? C.yellow : C.orange)
    }
  } else {
    const lines = Math.floor(t / 110)
    for (let r = 0; r < 4; r++) {
      const len = 1 + Math.floor(hash(lines - r) * 6)
      for (let x = 0; x < len; x++) c.set(13 + x, 4 - r, r === 0 ? C.lime : C.green)
    }
    for (let k = 0; k < 10; k++) {
      const x = 22 + wrap(t / 25 + k * 7, c.width - 22)
      c.set(x, 1 + Math.floor(hash(k) * 5), [C.cyan, C.lime, C.yellow, C.pink][k % 4]!)
    }
  }
}

export const robot: Scene = { name: 'robot', accent: '#41d6e8', draw }
