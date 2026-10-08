// A tiny pixel canvas packed into Raster cells: each terminal cell shows two
// vertical pixels with the half-block characters, foreground on top.

export const CLEAR = 0x01000000 // the terminal's default color (transparent)

const SPACE = 0x20
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const FULL = 0x2588 // █

export type Palette = Record<string, number>

export class Canvas {
  readonly px: Uint32Array

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.px = new Uint32Array(width * height).fill(CLEAR)
  }

  set(x: number, y: number, color: number): void {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return
    this.px[yi * this.width + xi] = color
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return CLEAR
    return this.px[y * this.width + x]!
  }

  // Draws a sprite given as rows of palette keys; '.' is transparent.
  sprite(rows: readonly string[], x: number, y: number, palette: Palette): void {
    const left = Math.round(x)
    const top = Math.round(y)
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const key = row[dx]!
        if (key === '.') continue
        const color = palette[key]
        if (color !== undefined) this.set(left + dx, top + dy, color)
      }
    })
  }

  hline(x0: number, x1: number, y: number, color: number): void {
    for (let x = x0; x <= x1; x++) this.set(x, y, color)
  }

  // Raster cells: `width` columns by `height / 2` rows of [codePoint, fg, bg].
  toCells(): string {
    const rows = Math.ceil(this.height / 2)
    const words = new Uint32Array(this.width * rows * 3)
    let i = 0
    for (let r = 0; r < rows; r++) {
      for (let x = 0; x < this.width; x++) {
        const top = this.get(x, r * 2)
        const bottom = this.get(x, r * 2 + 1)
        let code = SPACE
        let fg = CLEAR
        let bg = CLEAR
        if (top !== CLEAR && bottom !== CLEAR) {
          if (top === bottom) {
            code = FULL
            fg = top
          } else {
            code = UPPER
            fg = top
            bg = bottom
          }
        } else if (top !== CLEAR) {
          code = UPPER
          fg = top
        } else if (bottom !== CLEAR) {
          code = LOWER
          fg = bottom
        }
        words[i++] = code
        words[i++] = fg
        words[i++] = bg
      }
    }
    return base64(words)
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Little-endian u32 words as standard padded base64 (RasterProps.cells).
export function base64(words: Uint32Array): string {
  const bytes = new Uint8Array(words.length * 4)
  const view = new DataView(bytes.buffer)
  words.forEach((word, i) => view.setUint32(i * 4, word, true))
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
  }
  return out
}
