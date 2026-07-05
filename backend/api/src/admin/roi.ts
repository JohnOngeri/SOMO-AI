import type { PrismaClient } from '../db'
import type { Env } from '../env'
import type { AdminIdentity } from './service'
import { SeatError } from '../seats/service'

const DAY = 86_400_000

export interface RoiReport {
  term: string
  licenseId: string
  generatedAt: string
  coverage: {
    seatsPurchased: number
    seatsClaimed: number
    weeklyActive: number
    weeklyActivePct: number
    reflectionsTotal: number
    coachInteractionsTotal: number
    avgReflectionsPerClaimedSeat: number
  }
  mentorTime: {
    coachInteractions: number
    visitsDisplaced: number
    hoursSaved: number
    costSavedUsdMicro: number
    assumptions: { asksPerVisit: number; hoursPerVisit: number; costPerVisitUsdMicro: number }
  }
  timeToCompetency: {
    reached: number
    ofClaimed: number
    medianDays: number | null
    curve: { day: number; cumulativePct: number }[]
    baseline: { reflections: number; asks: number }
  }
  roi: {
    costPerSeatMinor: number
    currency: string
    savedPerClaimedSeatUsdMicro: number
    totalSavedUsdMicro: number
    totalLicenseValueMinor: number
  }
}

/**
 * The institutional value story, computed from the same ledgers that gate
 * spend. Buyers pay for displaced field-mentor cost and faster onboarding —
 * every number here traces to raw events, and every assumption is printed.
 */
export class RoiService {
  constructor(
    private db: PrismaClient,
    private env: Env,
  ) {}

  async report(admin: AdminIdentity, licenseId: string): Promise<RoiReport> {
    const license = await this.db.license.findUnique({ where: { id: licenseId } })
    if (!license || license.institutionId !== admin.institutionId) throw new SeatError('not_found')

    const seats = await this.db.seat.findMany({
      where: { licenseId, teacherId: { not: null } },
      select: { teacherId: true, claimedAt: true },
    })
    const teacherIds = seats.map((s) => s.teacherId!)
    const termStart = license.startDate
    const termEnd = license.endDate

    // ── coverage ───────────────────────────────────────────────────────
    const weeklySince = new Date(Date.now() - 7 * DAY)
    const [reflectionsTotal, coachInteractionsTotal, weeklyActiveGroups] = await Promise.all([
      teacherIds.length
        ? this.db.reflectionEntry.count({
            where: { userId: { in: teacherIds }, capturedAt: { gte: termStart, lte: termEnd } },
          })
        : 0,
      teacherIds.length
        ? this.db.usageEvent.count({
            where: {
              userId: { in: teacherIds },
              type: 'ai_call',
              at: { gte: termStart, lte: termEnd },
            },
          })
        : 0,
      teacherIds.length
        ? this.db.usageEvent.groupBy({
            by: ['userId'],
            where: { userId: { in: teacherIds }, at: { gte: weeklySince } },
          })
        : [],
    ])
    const weeklyActive = weeklyActiveGroups.length

    // ── mentor time displaced ──────────────────────────────────────────
    const asksPerVisit = this.env.ROI_ASKS_PER_VISIT
    const hoursPerVisit = this.env.ROI_HOURS_PER_VISIT
    const costPerVisit = this.env.ROI_COST_PER_VISIT_USD_MICRO
    const visitsDisplaced = Math.floor(coachInteractionsTotal / asksPerVisit)

    // ── time to competency ─────────────────────────────────────────────
    const baseline = {
      reflections: this.env.ROI_COMPETENCY_REFLECTIONS,
      asks: this.env.ROI_COMPETENCY_ASKS,
    }
    const daysToCompetency: number[] = []
    for (const seat of seats) {
      if (!seat.claimedAt) continue
      const [reflections, asks] = await Promise.all([
        this.db.reflectionEntry.findMany({
          where: { userId: seat.teacherId! },
          orderBy: { capturedAt: 'asc' },
          select: { capturedAt: true },
          take: baseline.reflections,
        }),
        this.db.usageEvent.findMany({
          where: { userId: seat.teacherId!, type: 'ai_call' },
          orderBy: { at: 'asc' },
          select: { at: true },
          take: baseline.asks,
        }),
      ])
      if (reflections.length < baseline.reflections || asks.length < baseline.asks) continue
      const reachedAt = Math.max(
        reflections[reflections.length - 1]!.capturedAt.getTime(),
        asks[asks.length - 1]!.at.getTime(),
      )
      daysToCompetency.push(Math.max(0, Math.ceil((reachedAt - seat.claimedAt.getTime()) / DAY)))
    }
    daysToCompetency.sort((a, b) => a - b)
    const medianDays =
      daysToCompetency.length > 0
        ? daysToCompetency[Math.floor((daysToCompetency.length - 1) / 2)]!
        : null

    const maxDay = daysToCompetency.length > 0 ? daysToCompetency[daysToCompetency.length - 1]! : 0
    const curve: { day: number; cumulativePct: number }[] = []
    if (seats.length > 0) {
      for (
        let day = 0;
        day <= Math.min(maxDay, 120);
        day += Math.max(1, Math.ceil(maxDay / 24) || 1)
      ) {
        const reached = daysToCompetency.filter((d) => d <= day).length
        curve.push({ day, cumulativePct: Math.round((reached / seats.length) * 100) })
      }
    }

    // ── the sales metric ───────────────────────────────────────────────
    const totalSaved = visitsDisplaced * costPerVisit
    const savedPerClaimedSeat = seats.length > 0 ? Math.round(totalSaved / seats.length) : 0

    return {
      term: license.term,
      licenseId,
      generatedAt: new Date().toISOString(),
      coverage: {
        seatsPurchased: license.seatsPurchased,
        seatsClaimed: seats.length,
        weeklyActive,
        weeklyActivePct: seats.length > 0 ? Math.round((weeklyActive / seats.length) * 100) : 0,
        reflectionsTotal,
        coachInteractionsTotal,
        avgReflectionsPerClaimedSeat:
          seats.length > 0 ? Math.round((reflectionsTotal / seats.length) * 10) / 10 : 0,
      },
      mentorTime: {
        coachInteractions: coachInteractionsTotal,
        visitsDisplaced,
        hoursSaved: Math.round(visitsDisplaced * hoursPerVisit * 10) / 10,
        costSavedUsdMicro: totalSaved,
        assumptions: { asksPerVisit, hoursPerVisit, costPerVisitUsdMicro: costPerVisit },
      },
      timeToCompetency: {
        reached: daysToCompetency.length,
        ofClaimed: seats.length,
        medianDays,
        curve,
        baseline,
      },
      roi: {
        costPerSeatMinor: license.pricePerSeatMinor,
        currency: license.currency,
        savedPerClaimedSeatUsdMicro: savedPerClaimedSeat,
        totalSavedUsdMicro: totalSaved,
        totalLicenseValueMinor: license.seatsPurchased * license.pricePerSeatMinor,
      },
    }
  }
}
