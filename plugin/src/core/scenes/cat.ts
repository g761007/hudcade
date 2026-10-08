// Cat and yarn.
// A cat and a ball of yarn. Thinking: the cat sits, tail swishing. A tool:
// it pounces and the yarn unrolls. Replying: it chases the yarn at full
// speed.

import type { Canvas } from './canvas'
import { C, wrap, type Scene } from './kit'
import type { Mode } from './mode'

const CAT_SIT = ['k.k....', 'kkk....', 'kek....', 'kkkk...', '.kkkk..', '.kkkkT.', '.k.k..T']
const CAT_RUN = [
  ['......k.k', '......kkk', 'T.....kek', '.Tkkkkkk.', '..kkkkkk.', '..k....k.'],
  ['......k.k', '......kkk', '......kek', 'TTkkkkkk.', '..kkkkkk.', '...k..k..'],
]
function draw(c: Canvas, mode: Mode, t: number) {
  c.hline(0, c.width - 1, 7, C.tan)
  if (mode === 'think') {
    const tail = Math.floor(t / 300) % 2
    const sit = CAT_SIT.map((row, i) => (i >= 5 && tail ? row.replace(/T/g, '.') + (i === 5 ? '' : '') : row))
    c.sprite(sit, 8, 0, { k: C.orange, e: C.dgreen, T: C.orange })
    if (tail) c.set(14, 4, C.orange)
    const wobble = Math.round(Math.sin(t / 250))
    c.sprite(['.pp.', 'pPpp', 'ppPp', '.pp.'], 18 + wobble, 3, { p: C.pink, P: 0xd9467c })
    return
  }
  const speed = mode === 'reply' ? 30 : 14
  const lap = c.width + 20
  const yarnX = wrap((t / 1000) * speed, lap) - 4
  const catX = yarnX - (mode === 'reply' ? 13 : 16)
  for (let x = Math.max(0, catX + 9); x < yarnX; x++) c.set(x, 6, C.pink)
  const spin = Math.floor(t / 100) % 2
  c.sprite(spin ? ['.pp.', 'pPpp', 'ppPp', '.pp.'] : ['.pp.', 'ppPp', 'pPpp', '.pp.'], yarnX, 3, { p: C.pink, P: 0xd9467c })
  c.sprite(CAT_RUN[Math.floor(t / (mode === 'reply' ? 70 : 120)) % 2]!, catX, 1, { k: C.orange, e: C.dgreen, T: C.orange })
}

export const cat: Scene = { name: 'cat', accent: '#ff77a8', draw }
