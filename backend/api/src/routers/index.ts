import { router } from '../trpc'
import { authRouter } from './auth'
import { dnaRouter } from './dna'
import { meRouter } from './me'
import { reflectionRouter } from './reflection'

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  dna: dnaRouter,
  reflection: reflectionRouter,
})

export type AppRouter = typeof appRouter
