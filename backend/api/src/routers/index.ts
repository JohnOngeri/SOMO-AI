import { router } from '../trpc'
import { authRouter } from './auth'
import { dnaRouter } from './dna'
import { entitlementsRouter } from './entitlements'
import { meRouter } from './me'
import { meteringRouter } from './metering'
import { packsRouter } from './packs'
import { reflectionRouter } from './reflection'

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  dna: dnaRouter,
  reflection: reflectionRouter,
  packs: packsRouter,
  entitlements: entitlementsRouter,
  metering: meteringRouter,
})

export type AppRouter = typeof appRouter
