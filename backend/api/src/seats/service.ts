import { createHmac, randomInt } from 'node:crypto'
import { AUTH_PIN_ALPHABET } from '@somo/types'
import type { PrismaClient } from '../db'
import type { Env } from '../env'
import { newUlid } from '../ids'

export class SeatError extends Error {
  constructor(
    public code:
      | 'invalid_pin'
      | 'pin_already_used'
      | 'seat_revoked'
      | 'license_inactive'
      | 'already_seated'
      | 'seat_capacity'
      | 'not_found'
      | 'invalid_state',
    message?: string,
  ) {
    super(message ?? code)
  }
}

export interface SeatWithLicense {
  seat: NonNullable<Awaited<ReturnType<PrismaClient['seat']['findUnique']>>>
  license: NonNullable<Awaited<ReturnType<PrismaClient['license']['findUnique']>>>
}

/**
 * The billing unit of the B2B model. A license issues N seats; each seat
 * carries a one-time authorization PIN a coordinator hands to a teacher.
 * Everything metered hangs off an ACTIVE seat on an in-term ACTIVE license —
 * and every check here FAILS CLOSED.
 */
export class SeatService {
  constructor(
    private db: PrismaClient,
    private env: Env,
  ) {}

  // ── PINs ───────────────────────────────────────────────────────────

  /** Deterministic keyed hash so seats are O(1)-addressable by PIN, never storing plaintext. */
  hashPin(pin: string): string {
    const normalized = pin.toUpperCase().replace(/[\s-]/g, '')
    return createHmac('sha256', this.env.JWT_SECRET).update(`seat-pin:${normalized}`).digest('hex')
  }

  generatePin(): string {
    let raw = ''
    for (let i = 0; i < 8; i++) raw += AUTH_PIN_ALPHABET[randomInt(AUTH_PIN_ALPHABET.length)]
    return `${raw.slice(0, 4)}-${raw.slice(4)}`
  }

  // ── provisioning (console-side) ────────────────────────────────────

  async createInstitution(input: {
    name: string
    type: string
    country: string
    billingContactEmail?: string
  }) {
    return this.db.institution.create({
      data: {
        id: newUlid(),
        name: input.name,
        type: input.type,
        country: input.country,
        billingContactEmail: input.billingContactEmail ?? null,
      },
    })
  }

  async createLicense(input: {
    institutionId: string
    term: string
    startDate: Date
    endDate: Date
    seatsPurchased: number
    pricePerSeatMinor: number
    currency: string
    monthlyAiCallsPerSeat?: number
    monthlySmsPerSeat?: number
  }) {
    return this.db.license.create({
      data: {
        id: newUlid(),
        institutionId: input.institutionId,
        term: input.term,
        startDate: input.startDate,
        endDate: input.endDate,
        seatsPurchased: input.seatsPurchased,
        pricePerSeatMinor: input.pricePerSeatMinor,
        currency: input.currency,
        ...(input.monthlyAiCallsPerSeat !== undefined
          ? { monthlyAiCallsPerSeat: input.monthlyAiCallsPerSeat }
          : {}),
        ...(input.monthlySmsPerSeat !== undefined
          ? { monthlySmsPerSeat: input.monthlySmsPerSeat }
          : {}),
      },
    })
  }

  /**
   * Bulk-issue seats with one-time PINs. Plaintext PINs are returned exactly
   * once — for the printable PIN sheet — and never stored or logged.
   */
  async generateSeats(
    licenseId: string,
    count: number,
  ): Promise<{ seatId: string; pin: string }[]> {
    const license = await this.db.license.findUnique({
      where: { id: licenseId },
      include: { _count: { select: { seats: true } } },
    })
    if (!license) throw new SeatError('not_found')
    if (license._count.seats + count > license.seatsPurchased) {
      throw new SeatError(
        'seat_capacity',
        `license has ${license.seatsPurchased - license._count.seats} unissued seats, requested ${count}`,
      )
    }

    const issued: { seatId: string; pin: string }[] = []
    for (let i = 0; i < count; i++) {
      // retry on the astronomically unlikely PIN collision
      for (let attempt = 0; ; attempt++) {
        const pin = this.generatePin()
        try {
          const seat = await this.db.seat.create({
            data: { id: newUlid(), licenseId, authPinHash: this.hashPin(pin) },
          })
          issued.push({ seatId: seat.id, pin })
          break
        } catch (e) {
          if (attempt >= 3) throw e
        }
      }
    }
    return issued
  }

  // ── redemption (teacher-side) ──────────────────────────────────────

  /**
   * Bind a PIN to a teacher. Idempotent for the SAME teacher re-entering
   * their own PIN; hard-fails for every other state.
   */
  async redeemPin(pin: string, userId: string, at: Date = new Date()) {
    const seat = await this.db.seat.findUnique({
      where: { authPinHash: this.hashPin(pin) },
      include: { license: { include: { institution: true } } },
    })
    if (!seat) throw new SeatError('invalid_pin')
    if (seat.status === 'REVOKED') throw new SeatError('seat_revoked')
    if (seat.status === 'ACTIVE') {
      if (seat.teacherId === userId) return seat // idempotent re-entry
      throw new SeatError('pin_already_used')
    }

    this.assertLicenseLive(seat.license, at)

    const existing = await this.db.seat.findUnique({ where: { teacherId: userId } })
    if (existing) throw new SeatError('already_seated', 'teacher already holds a seat')

    return this.db.seat.update({
      where: { id: seat.id },
      data: { status: 'ACTIVE', teacherId: userId, claimedAt: at },
      include: { license: true },
    })
  }

  // ── the authorization question every gate asks ─────────────────────

  /**
   * The teacher's live seat, or null. Null means fail closed: no AI, no SMS,
   * no pack sync. Checks seat status, license status, term window, and
   * institution status — lazily, so nothing depends on a cron having run.
   */
  async activeSeatFor(userId: string, at: Date = new Date()): Promise<SeatWithLicense | null> {
    const seat = await this.db.seat.findUnique({
      where: { teacherId: userId },
      include: { license: { include: { institution: true } } },
    })
    if (!seat || seat.status !== 'ACTIVE') return null
    try {
      this.assertLicenseLive(seat.license, at)
    } catch {
      return null
    }
    return { seat, license: seat.license }
  }

  /** Same question keyed by phone — the USSD/SMS gateway's identity is the MSISDN. */
  async activeSeatForPhone(phone: string, at: Date = new Date()): Promise<SeatWithLicense | null> {
    const user = await this.db.user.findUnique({ where: { phone } })
    if (!user) return null
    return this.activeSeatFor(user.id, at)
  }

  /** Effective monthly quota for a seat: per-seat override, else license default. */
  quotaFor(s: SeatWithLicense): { monthlyAiCalls: number; monthlySms: number } {
    return {
      monthlyAiCalls: s.seat.monthlyAiCallsOverride ?? s.license.monthlyAiCallsPerSeat,
      monthlySms: s.seat.monthlySmsOverride ?? s.license.monthlySmsPerSeat,
    }
  }

  // ── lifecycle (console-side) ───────────────────────────────────────

  async revokeSeat(seatId: string, at: Date = new Date()) {
    const seat = await this.db.seat.findUnique({ where: { id: seatId } })
    if (!seat) throw new SeatError('not_found')
    return this.db.seat.update({
      where: { id: seatId },
      data: { status: 'REVOKED', revokedAt: at },
    })
  }

  /**
   * Reassign a revoked (or unclaimed) seat: clears the teacher binding and
   * mints a fresh one-time PIN. The old PIN is dead the moment this runs.
   */
  async reassignSeat(seatId: string): Promise<{ seatId: string; pin: string }> {
    const seat = await this.db.seat.findUnique({ where: { id: seatId } })
    if (!seat) throw new SeatError('not_found')
    if (seat.status === 'ACTIVE') {
      throw new SeatError('invalid_state', 'revoke the seat before reassigning it')
    }
    const pin = this.generatePin()
    await this.db.seat.update({
      where: { id: seatId },
      data: {
        authPinHash: this.hashPin(pin),
        status: 'UNCLAIMED',
        teacherId: null,
        claimedAt: null,
        revokedAt: null,
      },
    })
    return { seatId, pin }
  }

  /** Worker path: flip lapsed licenses to EXPIRED (gates already fail closed without this). */
  async expireLapsedLicenses(at: Date = new Date()): Promise<number> {
    const res = await this.db.license.updateMany({
      where: { status: 'ACTIVE', endDate: { lt: at } },
      data: { status: 'EXPIRED' },
    })
    return res.count
  }

  // ── internals ──────────────────────────────────────────────────────

  private assertLicenseLive(
    license: { status: string; startDate: Date; endDate: Date; institution?: { status: string } },
    at: Date,
  ) {
    if (license.status !== 'ACTIVE') throw new SeatError('license_inactive')
    if (at < license.startDate || at > license.endDate) throw new SeatError('license_inactive')
    if (license.institution && license.institution.status !== 'ACTIVE') {
      throw new SeatError('license_inactive', 'institution suspended')
    }
  }
}
