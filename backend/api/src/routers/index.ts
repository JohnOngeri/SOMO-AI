import { router } from '../trpc'
import { authRouter } from './auth'
import { dnaRouter } from './dna'
import { meRouter } from './me'
import { packsRouter } from './packs'
import { reflectionRouter } from './reflection'

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  dna: dnaRouter,
  reflection: reflectionRouter,
  packs: packsRouter,
})

export type AppRouter = typeof appRouter
