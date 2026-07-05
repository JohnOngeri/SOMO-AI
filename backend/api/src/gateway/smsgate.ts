import type { PrismaClient } from '../db'
import { QuotaExceededError, type MeteringService } from '../metering/service'
import type { SeatService } from '../seats/service'
import type { SmsSender } from '../sms'

export class SmsNotAuthorizedError extends Error {
  constructor(public reason: 'no_seat' | 'over_quota') {
    super(`sms_not_authorized:${reason}`)
  }
}

/**
 * Every outbound NON-AUTH SMS goes through here. Auth OTPs keep using the raw
 * sender (they are the front door and are rate-limited by the resend window);
 * everything else requires an active seat with remaining monthly SMS quota.
 * Fail closed: no seat or unknown state -> the message is not sent.
 */
export class SmsGate {
  constructor(
    private db: PrismaClient,
    private seats: SeatService,
    private metering: MeteringService,
    private sender: SmsSender,
  ) {}

  /** Send if and only if the user's seat has SMS quota left. Throws otherwise. */
  async sendGated(
    userId: string,
    to: string,
    message: string,
    meta: Record<string, string> = {},
  ): Promise<void> {
    const live = await this.seats.activeSeatFor(userId)
    if (!live) throw new SmsNotAuthorizedError('no_seat')
    const { monthlySms } = this.seats.quotaFor(live)
    try {
      await this.metering.recordSmsOrThrow({ userId, limit: monthlySms, meta })
    } catch (e) {
      if (e instanceof QuotaExceededError) throw new SmsNotAuthorizedError('over_quota')
      throw e
    }
    await this.sender.send(to, message)
  }

  /** Best-effort variant: swallow authorization failures (the SMS just doesn't go out). */
  async trySendGated(
    userId: string,
    to: string,
    message: string,
    meta: Record<string, string> = {},
  ): Promise<boolean> {
    try {
      await this.sendGated(userId, to, message, meta)
      return true
    } catch (e) {
      if (e instanceof SmsNotAuthorizedError) return false
      throw e
    }
  }
}
