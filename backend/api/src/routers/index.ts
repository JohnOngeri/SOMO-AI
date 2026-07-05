import { router } from '../trpc'
import { authRouter } from './auth'
import { coachRouter } from './coach'
import { dnaRouter } from './dna'
import { entitlementsRouter } from './entitlements'
import { marketplaceRouter } from './marketplace'
import { meRouter } from './me'
import { meteringRouter } from './metering'
import { packsRouter } from './packs'
import { reflectionRouter } from './reflection'

// B2B pivot: no teacher-facing billing surface. Institutions pay per seat via
// invoices (P6); the BillingService remains for charge/webhook plumbing only.
export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  dna: dnaRouter,
  reflection: reflectionRouter,
  packs: packsRouter,
  entitlements: entitlementsRouter,
  metering: meteringRouter,
  marketplace: marketplaceRouter,
  coach: coachRouter,
})

export type AppRouter = typeof appRouter
