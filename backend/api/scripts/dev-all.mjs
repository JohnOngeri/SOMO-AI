/**
 * One-command dev stack for machines WITHOUT Docker:
 *   pnpm dev:all
 * Boots an embedded real PostgreSQL (persistent data in .pgdata-dev, port
 * 5433), pushes the Prisma schema, seeds the demo on first run, then starts
 * the whole workspace (`pnpm dev`: API :4000 + admin console :5180) with all
 * logs — including the OTP codes "sent" by SMS — in this terminal.
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = path.resolve(apiDir, '../..')
const dataDir = path.join(apiDir, '.pgdata-dev')
const DATABASE_URL = 'postgresql://somo:somo@127.0.0.1:5433/somo'

const firstBoot = !existsSync(path.join(dataDir, 'PG_VERSION'))
const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'somo',
  password: 'somo',
  port: 5433,
  persistent: true,
})

if (firstBoot) await server.initialise()
await server.start()
if (firstBoot) await server.createDatabase('somo')
console.log(`\n▸ embedded postgres up on :5433 (data: backend/api/.pgdata-dev)`)

execSync('pnpm exec prisma db push', {
  cwd: apiDir,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL },
})

const client = new pg.Client({ connectionString: DATABASE_URL })
await client.connect()
const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM "Institution"')
await client.end()
if (rows[0].n === 0) {
  console.log('▸ first run — seeding demo institutions…')
  execSync('pnpm exec tsx prisma/seed.ts', {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL },
  })
} else {
  console.log(`▸ database already seeded (${rows[0].n} institutions)`)
}

console.log('\n▸ starting SOMO — API http://localhost:4000 · Console http://localhost:5180')
console.log('▸ console login: +254700000001 — the OTP code will PRINT BELOW as [sms -> …]\n')

const dev = spawn('pnpm', ['dev'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL },
})

const shutdown = async () => {
  dev.kill('SIGINT')
  await server.stop().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
dev.on('exit', shutdown)
