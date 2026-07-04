import { loadEnv } from './env'
import { buildServer } from './server'

const env = loadEnv()
const app = await buildServer({ env })

try {
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' })
  console.log(`somo api listening on :${env.API_PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
