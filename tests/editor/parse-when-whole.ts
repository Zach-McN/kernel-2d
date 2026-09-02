import fs from 'node:fs'

/**
 * Reads and parses a JSON file the editor may be writing at this very moment.
 *
 * A poll that reads straight from disk can catch the file mid-write — present
 * but incomplete — and `JSON.parse` on half a file throws, which fails the test
 * instead of waiting out the write. Returning `undefined` turns that moment
 * into one more round of polling: the caller's poll sees a value that matches
 * nothing it is waiting for, and asks again.
 */
export function parsedWhenWhole<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return undefined
  }
}
