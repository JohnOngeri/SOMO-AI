import { defineConfig } from 'vitest/config'

// CI provides a Postgres service via DATABASE_URL; locally the globalSetup
// boots an embedded real Postgres on 5433.
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://somo:somo@127.0.0.1:5433/somo_test'

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'test-secret-not-for-prod',
    },
    // money + auth tests share one database — run files serially
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
