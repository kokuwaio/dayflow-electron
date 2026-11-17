import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Fixed zone, so 4 AM boundaries and DST tests mean the same on every machine.
    env: { TZ: 'Europe/Berlin' }
  }
})
