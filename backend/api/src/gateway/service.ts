import type { UssdResponse } from '@somo/types'
import { SeatRequiredError, type CoachService } from '../coach/service'
import type { PrismaClient } from '../db'
import { newUlid } from '../ids'
import { QuotaExceededError, type MeteringService } from '../metering/service'
import { SeatError, type SeatService } from '../seats/service'
import type { SmsGate } from './smsgate'

/** USSD screens are hard-capped; leave headroom under the 160-char practical limit. */
const USSD_MAX = 158

const NOT_REGISTERED = 'This number is not registered. Contact your SOMO coordinator.'

const MENU = [
  'SOMO — your teaching coach',
  '1. Ask Coach',
  '2. Reflection',
  '3. My week',
  '4. My seat',
].join('\n')

const REFLECT_MENU = [
  'Reflect on today:',
  '1. What worked?',
  '2. What was hard?',
  '3. Try tomorrow?',
].join('\n')

/**
 * The button-phone product, PIN-gated end to end. The MSISDN is the identity;
 * an MSISDN without an ACTIVE seat gets exactly one thing: the chance to enter
 * an authorization PIN. Unbound numbers NEVER reach the LLM and NEVER trigger
 * a paid outbound SMS — USSD session text is the only reply channel for them
 * (it costs us nothing).
 */
export class GatewayService {
  constructor(
    private db: PrismaClient,
    private coach: CoachService,
    private seats: SeatService,
    private metering: MeteringService,
    private smsGate: SmsGate,
  ) {}

  private end(message: string): UssdResponse {
    return { type: 'END', message: message.slice(0, USSD_MAX) }
  }

  private con(message: string): UssdResponse {
    return { type: 'CON', message: message.slice(0, USSD_MAX) }
  }

  async handleUssd(input: { phoneNumber: string; text: string }): Promise<UssdResponse> {
    const live = await this.seats.activeSeatForPhone(input.phoneNumber)
    const path = input.text === '' ? [] : input.text.split('*')

    // ── unbound MSISDN: the ONLY offered flow is PIN entry ───────────
    if (!live) {
      if (path.length === 0) {
        return this.con(
          'SOMO\nEnter your authorization PIN (on your PIN sheet from your coordinator):',
        )
      }
      return this.redeemViaGateway(input.phoneNumber, path.join(''))
    }

    const userId = live.seat.teacherId!
    if (path.length === 0) {
      await this.metering.record({ id: newUlid(), userId, type: 'ussd_session' })
      return this.con(MENU)
    }

    const [first, second, ...rest] = path
    switch (first) {
      case '1': {
        if (path.length === 1) return this.con('Type your teaching question:')
        const question = [second, ...rest].join(' ').trim()
        return this.answerAsk(userId, input.phoneNumber, question)
      }
      case '2': {
        if (path.length === 1) return this.con(REFLECT_MENU)
        const slot = Number(second)
        if (![1, 2, 3].includes(slot)) return this.end('Invalid choice.')
        if (path.length === 2) return this.con('Type your reflection:')
        const transcript = rest.join(' ').trim()
        if (!transcript) return this.end('Empty reflection — nothing saved.')
        await this.saveReflection(userId, slot as 1 | 2 | 3, transcript)
        return this.end('Saved. Small reflections, big teaching. See you tomorrow!')
      }
      case '3':
        return this.end(await this.weekSummary(userId))
      case '4':
        return this.end(await this.seatSummary(userId))
      default:
        return this.end('Invalid choice. Dial again to see the menu.')
    }
  }

  /**
   * Two-way SMS. Bound numbers: ASK <q>, R1/R2/R3 <text>, WEEK, help.
   * Unbound numbers: only "PIN <pin>" is processed; every other inbound text
   * is silently dropped — a reply would be an unauthorized paid SMS.
   */
  async handleSms(input: { from: string; text: string }): Promise<void> {
    const text = input.text.trim()
    const upper = text.toUpperCase()
    const live = await this.seats.activeSeatForPhone(input.from)

    if (!live) {
      if (upper.startsWith('PIN')) {
        const attempt = text.slice(3).trim()
        const result = await this.redeemViaGateway(input.from, attempt)
        // a successful redemption creates the seat — the confirmation SMS is
        // then authorized under the seat's own quota. Failures get no SMS.
        const nowLive = await this.seats.activeSeatForPhone(input.from)
        if (nowLive) {
          await this.smsGate.trySendGated(nowLive.seat.teacherId!, input.from, result.message, {
            kind: 'pin_welcome',
          })
        }
      }
      return
    }

    const userId = live.seat.teacherId!

    if (upper.startsWith('ASK ')) {
      const question = text.slice(4).trim()
      // don't burn an AI credit if we can't afford the reply SMS
      const smsQuota = await this.metering.quotaState(
        userId,
        'sms_out',
        this.seats.quotaFor(live).monthlySms,
      )
      if (smsQuota.limit !== null && smsQuota.used >= smsQuota.limit) {
        await this.metering.record({
          id: newUlid(),
          userId,
          type: 'quota_block',
          meta: { blocked: 'sms_out', kind: 'ask_reply' },
        })
        return
      }
      try {
        const { reply } = await this.coach.ask({ userId, askId: newUlid(), question, mode: 'sms' })
        await this.smsGate.trySendGated(userId, input.from, reply.answer, { kind: 'coach_reply' })
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          await this.smsGate.trySendGated(
            userId,
            input.from,
            'Your institution’s monthly coaching quota is used for now — it renews on the 1st. Reflections (R1/R2/R3) still work!',
            { kind: 'quota_notice' },
          )
          return
        }
        if (e instanceof SeatRequiredError) return // race: seat lapsed mid-flight — fail closed
        throw e
      }
      return
    }

    const slotMatch = upper.match(/^R([123])\s+/)
    if (slotMatch) {
      const transcript = text.slice(slotMatch[0].length).trim()
      if (transcript) {
        await this.saveReflection(userId, Number(slotMatch[1]) as 1 | 2 | 3, transcript)
        await this.smsGate.trySendGated(userId, input.from, 'Reflection saved. Keep going!', {
          kind: 'reflection_ack',
        })
        return
      }
    }

    if (upper === 'WEEK') {
      await this.smsGate.trySendGated(userId, input.from, await this.weekSummary(userId), {
        kind: 'week_summary',
      })
      return
    }

    await this.smsGate.trySendGated(
      userId,
      input.from,
      'SOMO: send "ASK <question>" for coaching, "R1/R2/R3 <text>" to reflect, "WEEK" for your streak.',
      { kind: 'help' },
    )
  }

  // ── internals ──────────────────────────────────────────────────────

  /** PIN redemption over the gateway: find-or-create the user, bind the seat. */
  private async redeemViaGateway(phone: string, pinAttempt: string): Promise<UssdResponse> {
    const normalized = pinAttempt.replace(/[\s*-]/g, '')
    if (!/^[A-Za-z0-9]{8}$/.test(normalized)) return this.end(NOT_REGISTERED)

    const user =
      (await this.db.user.findUnique({ where: { phone } })) ??
      (await this.db.user.create({ data: { id: newUlid(), phone, settings: { create: {} } } }))

    try {
      await this.seats.redeemPin(normalized, user.id)
      await this.metering.record({ id: newUlid(), userId: user.id, type: 'seat_redeemed' })
      return this.end('Welcome to SOMO! Dial again for the menu, or send "ASK <question>" by SMS.')
    } catch (e) {
      if (e instanceof SeatError) return this.end(NOT_REGISTERED)
      throw e
    }
  }

  private async answerAsk(userId: string, phone: string, question: string): Promise<UssdResponse> {
    if (!question) return this.end('Empty question — dial again.')
    try {
      const { reply } = await this.coach.ask({ userId, askId: newUlid(), question, mode: 'ussd' })
      if (reply.answer.length <= USSD_MAX) return this.end(reply.answer)
      // long answers continue over SMS — but only if the seat's SMS quota allows
      const sent = await this.smsGate.trySendGated(userId, phone, reply.answer, {
        kind: 'ussd_overflow',
      })
      return sent
        ? this.end(`${reply.answer.slice(0, USSD_MAX - 30)}… (full answer sent by SMS)`)
        : this.end(reply.answer.slice(0, USSD_MAX))
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        return this.end(
          'Your institution’s monthly coaching quota is used for now — it renews on the 1st. Reflections still work!',
        )
      }
      if (e instanceof SeatRequiredError) return this.end(NOT_REGISTERED)
      throw e
    }
  }

  private async saveReflection(userId: string, slot: 1 | 2 | 3, transcript: string) {
    const date = new Date().toISOString().slice(0, 10)
    const id = newUlid()
    await this.db.reflectionEntry.upsert({
      where: { userId_date_slot: { userId, date, slot } },
      update: { id, transcript, mode: 'sms', capturedAt: new Date() },
      create: { id, userId, date, slot, mode: 'sms', transcript, capturedAt: new Date() },
    })
    await this.metering.record({
      id: newUlid(),
      userId,
      type: 'reflection',
      meta: { via: 'gateway' },
    })
  }

  private async weekSummary(userId: string): Promise<string> {
    const since = new Date(Date.now() - 7 * 86_400_000)
    const reflections = await this.db.reflectionEntry.count({
      where: { userId, capturedAt: { gte: since } },
    })
    const quota = await this.coach.quota(userId)
    const asksLine =
      quota.limit === null ? `${quota.used} asks` : `${quota.used}/${quota.limit} asks this month`
    return `Your week: ${reflections} reflections, ${asksLine}. Keep going!`
  }

  private async seatSummary(userId: string): Promise<string> {
    const live = await this.seats.activeSeatFor(userId)
    if (!live) return NOT_REGISTERED
    const inst = await this.db.institution.findUnique({
      where: {
        id: (await this.db.license.findUnique({ where: { id: live.license.id } }))!.institutionId,
      },
    })
    const quota = await this.coach.quota(userId)
    return `Seat: ${inst?.name ?? 'your institution'} (${live.license.term}). ${quota.used}/${quota.limit ?? '∞'} coach asks used this month.`
  }
}
