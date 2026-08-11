import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Watcher tests do real filesystem work and wait on real OS events.
    testTimeout: 10_000,
  },
})
