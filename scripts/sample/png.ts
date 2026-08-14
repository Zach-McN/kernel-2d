import zlib from 'node:zlib'

/**
 * A minimal PNG writer, and a tiny canvas to draw on.
 *
 * Hand-rolled rather than pulled from a package: the sample assets are a
 * handful of 16×16 sprites, and a dependency that exists only to make test
 * fixtures is a dependency the kernel carries forever.
 *
 * Everything here is deterministic — same inputs, same bytes — so re-running
 * the generator does not churn the project folder.
 */

export type Colour = readonly [red: number, green: number, blue: number, alpha: number]

export class PixelCanvas {
  readonly width: number
  readonly height: number
  private readonly pixels: Uint8Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.pixels = new Uint8Array(width * height * 4)
  }

  set(x: number, y: number, colour: Colour): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const at = (y * this.width + x) * 4
    this.pixels[at] = colour[0]
    this.pixels[at + 1] = colour[1]
    this.pixels[at + 2] = colour[2]
    this.pixels[at + 3] = colour[3]
  }

  fill(x: number, y: number, width: number, height: number, colour: Colour): void {
    for (let dy = 0; dy < height; dy += 1) {
      for (let dx = 0; dx < width; dx += 1) this.set(x + dx, y + dy, colour)
    }
  }

  outline(x: number, y: number, width: number, height: number, colour: Colour): void {
    for (let dx = 0; dx < width; dx += 1) {
      this.set(x + dx, y, colour)
      this.set(x + dx, y + height - 1, colour)
    }
    for (let dy = 0; dy < height; dy += 1) {
      this.set(x, y + dy, colour)
      this.set(x + width - 1, y + dy, colour)
    }
  }

  /** Copies another canvas in, skipping fully transparent pixels. */
  stamp(source: PixelCanvas, x: number, y: number): void {
    for (let dy = 0; dy < source.height; dy += 1) {
      for (let dx = 0; dx < source.width; dx += 1) {
        const colour = source.get(dx, dy)
        if (colour[3] === 0) continue
        this.set(x + dx, y + dy, colour)
      }
    }
  }

  get(x: number, y: number): Colour {
    const at = (y * this.width + x) * 4
    return [this.pixels[at] ?? 0, this.pixels[at + 1] ?? 0, this.pixels[at + 2] ?? 0, this.pixels[at + 3] ?? 0]
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.pixels)
  }
}

/**
 * Draws a sprite from rows of single-character keys, which is the readable way
 * to keep tiny pixel art in source. A key missing from the palette is
 * transparent, so `.` and ` ` both work as empty.
 */
export function drawSprite(rows: readonly string[], palette: Readonly<Record<string, Colour>>): PixelCanvas {
  const height = rows.length
  const width = Math.max(...rows.map((row) => row.length))
  const canvas = new PixelCanvas(width, height)

  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const colour = palette[row[x] ?? '']
      if (colour !== undefined) canvas.set(x, y, colour)
    }
  })

  return canvas
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  // Each row is prefixed with its filter type; 0 means "no filtering", which is
  // the right trade for images this small.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, rowStart + 1)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bits per channel
  header[9] = 6 // colour type 6: red, green, blue, alpha
  header[10] = 0 // deflate, the only compression PNG has
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlacing

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])

  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed), 0)

  return Buffer.concat([length, typed, crc])
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
