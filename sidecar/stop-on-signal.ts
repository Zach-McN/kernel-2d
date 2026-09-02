/**
 * Stops a running service on Ctrl-C or a termination signal, once.
 *
 * Both signals reach the same handler, and a second one arriving while the
 * first close is still under way is ignored rather than starting a second
 * close against the first. The sentence is printed on a line of its own because
 * the `^C` the terminal echoes leaves the cursor mid-line. Shared by the sidecar
 * on its own (`sidecar/main.ts`) and the editor command (`scripts/editor.ts`),
 * which is the same service with a dev server beside it.
 */
export function stopOnSignal(close: () => Promise<void>, sentence: string): void {
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n${sentence}`)
    await close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}
