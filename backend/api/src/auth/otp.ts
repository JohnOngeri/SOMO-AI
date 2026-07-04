import { createHmac, randomInt } from 'node:crypto'
import type { PrismaClient } from '../db'
import { t } from '@somo/i18n'
import type { Locale } from '@somo/i18n'
import type { Env } from '../env'
import { newUlid } from '../ids'
import type { SmsSender } from '../sms'

export class OtpError extends Error {
  constructor(
    public code: 'rate_limited' | 'invalid_code' | 'expired' | 'too_many_attempts',
    message: string,
  ) {
    super(message)
  }
}

export class OtpService {
  constructor(
    private db: PrismaClient,
    private sms: SmsSender,
    private env: Env,
  ) {}

  private hash(code: string): string {
    return createHmac('sha256', this.env.JWT_SECRET).update(code).digest('hex')
  }

  async request(
    phone: string,
    locale: string,
  ): Promise<{ challengeId: string; expiresAt: Date; retryAfterSec: number }> {
    const recent = await this.db.otpChallenge.findFirst({
      where: {
        phone,
        createdAt: { gt: new Date(Date.now() - this.env.OTP_RESEND_SECONDS * 1000) },
      },
    })
    if (recent) {
      throw new OtpError('rate_limited', `wait before requesting another code`)
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const expiresAt = new Date(Date.now() + this.env.OTP_TTL_SECONDS * 1000)
    const challenge = await this.db.otpChallenge.create({
      data: { id: newUlid(), phone, codeHash: this.hash(code), locale, expiresAt },
    })

    const loc = (['en', 'fr', 'ha', 'sw'].includes(locale) ? locale : 'en') as Locale
    await this.sms.send(phone, `${t(loc, 'app.name')}: ${code}`)

    return { challengeId: challenge.id, expiresAt, retryAfterSec: this.env.OTP_RESEND_SECONDS }
  }

  /** Verify a code; on success consumes the challenge and returns the phone. */
  async verify(challengeId: string, code: string): Promise<{ phone: string; locale: string }> {
    const challenge = await this.db.otpChallenge.findUnique({ where: { id: challengeId } })
    if (!challenge || challenge.consumedAt) throw new OtpError('invalid_code', 'invalid code')
    if (challenge.expiresAt < new Date()) throw new OtpError('expired', 'code expired')
    if (challenge.attempts >= this.env.OTP_MAX_ATTEMPTS) {
      throw new OtpError('too_many_attempts', 'too many attempts')
    }

    if (challenge.codeHash !== this.hash(code)) {
      await this.db.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      })
      throw new OtpError('invalid_code', 'invalid code')
    }

    await this.db.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    })
    return { phone: challenge.phone, locale: challenge.locale }
  }
}
