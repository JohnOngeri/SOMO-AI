import type { PrismaClient } from '../db'
import type { Env } from '../env'
import { newUlid } from '../ids'
import { monthEnd, monthStart } from '../metering/service'
import { SeatError, type SeatService } from '../seats/service'

export interface AdminIdentity {
  adminId: string
  institutionId: string
  role: 'HQ_ADMIN' | 'COORDINATOR'
  regionScope: string | null
}

/**
 * Institution-side console operations. Every method takes the AdminIdentity
 * resolved by the router middleware and is scoped to that institution — an
 * admin can never see or touch another tenant's licenses or seats.
 */
export class AdminService {
  constructor(
    private db: PrismaClient,
    private seats: SeatService,
    private env: Env,
  ) {}

  /** Resolve console identity from the authenticated user's phone. */
  async identityForPhone(phone: string): Promise<AdminIdentity | null> {
    const admin = await this.db.adminUser.findUnique({ where: { phone } })
    if (!admin) return null
    const inst = await this.db.institution.findUnique({ where: { id: admin.institutionId } })
    if (!inst || inst.status !== 'ACTIVE') return null
    return {
      adminId: admin.id,
      institutionId: admin.institutionId,
      role: admin.role as AdminIdentity['role'],
      regionScope: admin.regionScope,
    }
  }

  async addAdmin(input: {
    institutionId: string
    phone: string
    displayName?: string | undefined
    role: 'HQ_ADMIN' | 'COORDINATOR'
    regionScope?: string | undefined
  }) {
    return this.db.adminUser.create({
      data: {
        id: newUlid(),
        institutionId: input.institutionId,
        phone: input.phone,
        displayName: input.displayName ?? null,
        role: input.role,
        regionScope: input.regionScope ?? null,
      },
    })
  }

  // ── overview ─────────────────────────────────────────────────────────

  async overview(admin: AdminIdentity) {
    const institution = await this.db.institution.findUniqueOrThrow({
      where: { id: admin.institutionId },
    })
    const licenses = await this.db.license.findMany({
      where: { institutionId: admin.institutionId },
      orderBy: { startDate: 'desc' },
    })
    const rows = []
    for (const license of licenses) {
      const [issued, claimed, active] = await Promise.all([
        this.db.seat.count({ where: { licenseId: license.id } }),
        this.db.seat.count({ where: { licenseId: license.id, status: 'ACTIVE' } }),
        this.activeThisWeek(license.id),
      ])
      rows.push({
        ...license,
        seatsIssued: issued,
        seatsClaimed: claimed,
        activeThisWeek: active,
        totalValueMinor: license.seatsPurchased * license.pricePerSeatMinor,
      })
    }
    return { institution, licenses: rows }
  }

  /** Distinct seated teachers on this license with any usage event in the last 7 days. */
  private async activeThisWeek(licenseId: string): Promise<number> {
    const seats = await this.db.seat.findMany({
      where: { licenseId, status: 'ACTIVE', teacherId: { not: null } },
      select: { teacherId: true },
    })
    const ids = seats.map((s) => s.teacherId!)
    if (ids.length === 0) return 0
    const since = new Date(Date.now() - 7 * 86_400_000)
    const grouped = await this.db.usageEvent.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, at: { gte: since } },
    })
    return grouped.length
  }

  // ── seats ────────────────────────────────────────────────────────────

  private async assertLicenseInTenant(admin: AdminIdentity, licenseId: string) {
    const license = await this.db.license.findUnique({ where: { id: licenseId } })
    if (!license || license.institutionId !== admin.institutionId) {
      throw new SeatError('not_found')
    }
    return license
  }

  /** HQ only. Returns the plaintext PINs exactly once, for the printable sheet. */
  async generateSeats(admin: AdminIdentity, licenseId: string, count: number, labels?: string[]) {
    if (admin.role !== 'HQ_ADMIN') throw new SeatError('invalid_state', 'HQ_ADMIN role required')
    await this.assertLicenseInTenant(admin, licenseId)
    const issued = await this.seats.generateSeats(licenseId, count)
    if (labels) {
      for (let i = 0; i < issued.length && i < labels.length; i++) {
        const label = labels[i]?.trim()
        if (label) {
          await this.db.seat.update({ where: { id: issued[i]!.seatId }, data: { label } })
        }
      }
    }
    return issued.map((s, i) => ({ ...s, label: labels?.[i]?.trim() || null }))
  }

  async listSeats(admin: AdminIdentity, licenseId: string) {
    await this.assertLicenseInTenant(admin, licenseId)
    const seats = await this.db.seat.findMany({
      where: { licenseId },
      include: { teacher: { select: { phone: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const now = new Date()
    const rows = []
    for (const seat of seats) {
      let lastActiveAt: Date | null = null
      let aiCallsThisMonth = 0
      let smsThisMonth = 0
      if (seat.teacherId) {
        const [last, ai, sms] = await Promise.all([
          this.db.usageEvent.findFirst({
            where: { userId: seat.teacherId },
            orderBy: { at: 'desc' },
            select: { at: true },
          }),
          this.db.usageEvent.count({
            where: {
              userId: seat.teacherId,
              type: 'ai_call',
              at: { gte: monthStart(now), lt: monthEnd(now) },
            },
          }),
          this.db.usageEvent.count({
            where: {
              userId: seat.teacherId,
              type: 'sms_out',
              at: { gte: monthStart(now), lt: monthEnd(now) },
            },
          }),
        ])
        lastActiveAt = last?.at ?? null
        aiCallsThisMonth = ai
        smsThisMonth = sms
      }
      rows.push({
        id: seat.id,
        label: seat.label,
        status: seat.status,
        claimedAt: seat.claimedAt,
        teacherPhone: seat.teacher?.phone ?? null,
        teacherName: seat.teacher?.displayName ?? null,
        lastActiveAt,
        aiCallsThisMonth,
        smsThisMonth,
      })
    }
    return rows
  }

  async revokeSeat(admin: AdminIdentity, seatId: string) {
    await this.assertSeatInTenant(admin, seatId)
    return this.seats.revokeSeat(seatId)
  }

  /** Returns the fresh one-time PIN — display once, then it is gone. */
  async reassignSeat(admin: AdminIdentity, seatId: string) {
    await this.assertSeatInTenant(admin, seatId)
    return this.seats.reassignSeat(seatId)
  }

  private async assertSeatInTenant(admin: AdminIdentity, seatId: string) {
    const seat = await this.db.seat.findUnique({
      where: { id: seatId },
      include: { license: true },
    })
    if (!seat || seat.license.institutionId !== admin.institutionId) {
      throw new SeatError('not_found')
    }
    return seat
  }

  /**
   * Roster import: one seat per row, labelled with the teacher's name.
   * Teachers still redeem their own PIN — the roster only labels the sheet.
   */
  async importRoster(admin: AdminIdentity, licenseId: string, rows: { name: string }[]) {
    return this.generateSeats(
      admin,
      licenseId,
      rows.length,
      rows.map((r) => r.name),
    )
  }

  // ── cost dashboard ───────────────────────────────────────────────────

  /**
   * The buyer's spend view: the quota ceiling (worst case), the projection
   * (current run-rate extrapolated), and the actual metered spend this month.
   * All in micro-USD so institutions can see costs to the third decimal.
   */
  async costs(admin: AdminIdentity, licenseId: string) {
    const license = await this.assertLicenseInTenant(admin, licenseId)
    const seats = await this.db.seat.findMany({
      where: { licenseId, status: 'ACTIVE', teacherId: { not: null } },
      select: { teacherId: true, monthlyAiCallsOverride: true, monthlySmsOverride: true },
    })
    const teacherIds = seats.map((s) => s.teacherId!)
    const now = new Date()

    const [aiCalls, smsOut] = await Promise.all([
      teacherIds.length
        ? this.db.usageEvent.count({
            where: {
              userId: { in: teacherIds },
              type: 'ai_call',
              at: { gte: monthStart(now), lt: monthEnd(now) },
            },
          })
        : 0,
      teacherIds.length
        ? this.db.usageEvent.count({
            where: {
              userId: { in: teacherIds },
              type: 'sms_out',
              at: { gte: monthStart(now), lt: monthEnd(now) },
            },
          })
        : 0,
    ])

    const aiUnit = this.env.COST_PER_AI_CALL_USD_MICRO
    const smsUnit = this.env.COST_PER_SMS_USD_MICRO

    const ceilingAiCalls = seats.reduce(
      (sum, s) => sum + (s.monthlyAiCallsOverride ?? license.monthlyAiCallsPerSeat),
      0,
    )
    const ceilingSms = seats.reduce(
      (sum, s) => sum + (s.monthlySmsOverride ?? license.monthlySmsPerSeat),
      0,
    )

    const dayOfMonth = now.getUTCDate()
    const daysInMonth = (monthEnd(now).getTime() - monthStart(now).getTime()) / 86_400_000
    const runRate = dayOfMonth > 0 ? daysInMonth / dayOfMonth : 1

    return {
      month: monthStart(now).toISOString().slice(0, 7),
      actual: {
        aiCalls,
        smsOut,
        usdMicro: aiCalls * aiUnit + smsOut * smsUnit,
      },
      projected: {
        aiCalls: Math.round(aiCalls * runRate),
        smsOut: Math.round(smsOut * runRate),
        usdMicro: Math.round((aiCalls * aiUnit + smsOut * smsUnit) * runRate),
      },
      ceiling: {
        aiCalls: ceilingAiCalls,
        smsOut: ceilingSms,
        usdMicro: ceilingAiCalls * aiUnit + ceilingSms * smsUnit,
      },
      unitCosts: { aiCallUsdMicro: aiUnit, smsUsdMicro: smsUnit },
      activeSeats: seats.length,
    }
  }
}
