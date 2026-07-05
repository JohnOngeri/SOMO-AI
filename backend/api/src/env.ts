import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8).default('dev-only-change-me'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_RESEND_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** base64 DER ed25519 keys; when absent outside production an ephemeral pair is generated */
  PACK_SIGNING_PRIVATE_KEY: z.string().optional(),
  PACK_SIGNING_PUBLIC_KEY: z.string().optional(),
  ENTITLEMENT_SIGNING_PRIVATE_KEY: z.string().optional(),
  ENTITLEMENT_SIGNING_PUBLIC_KEY: z.string().optional(),
  PACKS_STORAGE_DIR: z.string().default('./storage'),
  /** 'anthropic' needs ANTHROPIC_API_KEY; anything else falls back to the mock */
  AI_PROVIDER: z.enum(['anthropic', 'mock']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_FAST: z.string().default('claude-haiku-4-5'),
  AI_MODEL_QUALITY: z.string().default('claude-sonnet-5'),
  AI_QUALITY_THRESHOLD_CHARS: z.coerce.number().int().positive().default(280),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return envSchema.parse({ ...process.env, ...overrides })
}
