import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_URL = 'postgresql://somo:somo@127.0.0.1:5433/somo_test'

export default async function globalSetup(): Promise<() => Promise<void>> {
  let stop = async () => {}
  let databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    // no external Postgres (local dev without docker) -> boot an embedded real one
    const { default: EmbeddedPostgres } = await import('embedded-postgres')
    const { rm } = await import('node:fs/promises')
    await rm(path.join(pkgDir, '.pgdata-test'), { recursive: true, force: true })
    const pg = new EmbeddedPostgres({
      databaseDir: path.join(pkgDir, '.pgdata-test'),
      user: 'somo',
      password: 'somo',
      port: 5433,
      persistent: false,
    })
    await pg.initialise()
    await pg.start()
    await pg.createDatabase('somo_test')
    databaseUrl = LOCAL_URL
    stop = async () => {
      await pg.stop()
    }
  }

  // no --force-reset: the embedded dir is freshly initialised every run and
  // CI's service container starts empty, so a plain push is always sufficient
  execSync(`pnpm exec prisma db push --url '${databaseUrl}'`, {
    cwd: pkgDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })

  return stop
}
