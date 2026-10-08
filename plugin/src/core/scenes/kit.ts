// Shared pieces of the spinner scenes: the palette, the scene shape, and two
// small helpers for looping motion and stable pseudo-randomness.

import type { Canvas } from './canvas'
import type { Mode } from './mode'

export type Scene = {
  name: string
  // The color of the spinner word while this scene plays.
  accent: string
  draw: (c: Canvas, mode: Mode, t: number) => void
}

export const C = {
  white: 0xf4f4f4,
  cream: 0xfff1d0,
  gray: 0x94a3b8,
  dgray: 0x4b5563,
  steel: 0x64748b,
  brown: 0x8b5a2b,
  dbrown: 0x5d3a1a,
  tan: 0xd8a46a,
  red: 0xe0404a,
  orange: 0xf28c28,
  yellow: 0xffd23f,
  green: 0x3fbf5f,
  dgreen: 0x2a7f3f,
  lime: 0x9be15d,
  cyan: 0x41d6e8,
  blue: 0x3b82f6,
  navy: 0x1e3a8a,
  water: 0x2563eb,
  pink: 0xff77a8,
  purple: 0x9b5de5,
  skin: 0xf5c6a0,
}

// v modulo m, always in [0, m).
export const wrap = (v: number, m: number) => ((v % m) + m) % m

// A stable value in [0, 1) for an integer seed.
export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
