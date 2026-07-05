import { createHmac } from 'node:crypto'
import type { PrismaClient } from '../db'
import type { Env } from '../env'
import { newUlid } from '../ids'

/**
 * Zero-marginal-cost topic classifier: a curriculum-informed keyword
 * taxonomy. Deliberately NOT an LLM call — classification runs on every
 * question and reflection, and the mart must not add per-event AI spend.
 * An AI classifier can slot in behind the same signature later (batched,
 * internal budget) if label quality demands it.
 */
const TAXONOMY: { topic: string; skill: string; patterns: RegExp }[] = [
  {
    topic: 'numeracy.fractions',
    skill: 'concept_explanation',
    patterns: /fraction|numerator|denominator|half|quarter/i,
  },
  {
    topic: 'numeracy.place_value',
    skill: 'concept_explanation',
    patterns: /place value|tens and ones|hundreds|regroup/i,
  },
  {
    topic: 'numeracy.operations',
    skill: 'concept_explanation',
    patterns: /multiplication|division|subtraction|addition|times table/i,
  },
  {
    topic: 'literacy.phonics',
    skill: 'concept_explanation',
    patterns: /phonics|letter sound|blend|syllable|decod/i,
  },
  {
    topic: 'literacy.comprehension',
    skill: 'concept_explanation',
    patterns: /comprehension|storybook|story|vocabulary|read(ing)? (fluency|comprehension|skills)/i,
  },
  {
    topic: 'resources.low_resource',
    skill: 'improvisation',
    patterns:
      /no (textbook|materials)|bottle top|chalkboard|without (books|materials)|few textbooks/i,
  },
  {
    topic: 'classroom.large_class',
    skill: 'management',
    patterns: /large class|\b[5-9]\d+ (learners|students|pupils)|overcrowd|big class/i,
  },
  {
    topic: 'classroom.management',
    skill: 'management',
    patterns: /discipline|behavio|noisy|attention|manage/i,
  },
  {
    topic: 'classroom.engagement',
    skill: 'pedagogy',
    patterns: /engage|game|warm-?up|fun|participat|quiet (ones|learners)/i,
  },
  {
    topic: 'assessment.formative',
    skill: 'assessment',
    patterns: /assess|exit question|check.{0,20}(understanding|improv)|test|quiz|marking/i,
  },
]

export function classifyText(text: string): { topic: string; skill: string } {
  for (const entry of TAXONOMY) {
    if (entry.patterns.test(text)) return { topic: entry.topic, skill: entry.skill }
  }
  return { topic: 'general.pedagogy', skill: 'general' }
}

export function isoWeekBucket(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export interface ConceptCell {
  topic: string
  skill: string | null
  signals: number
  teachers: number
}

/**
 * The analytics mart: ingest strips everything personal at the door
 * (labels only — the transcript never enters this store), reads enforce
 * k-anonymity (cells under K distinct teachers are suppressed, and the
 * suppression itself is reported so consumers know data was withheld).
 */
export class AnalyticsService {
  constructor(
    private db: PrismaClient,
    private env: Env,
  ) {}

  private teacherHash(userId: string): string {
    return createHmac('sha256', this.env.JWT_SECRET).update(`analytics:${userId}`).digest('hex')
  }

  /** Institution context (coarse geography + consent) for a seated teacher. */
  private async contextFor(userId: string) {
    const seat = await this.db.seat.findUnique({
      where: { teacherId: userId },
      include: { license: { include: { institution: true } } },
    })
    if (!seat) return null
    const inst = seat.license.institution as unknown as {
      country: string
      type: string
      analyticsOptOut: boolean
    }
    if (inst.analyticsOptOut) return null
    return { country: inst.country, institutionType: inst.type }
  }

  async ingest(input: {
    userId: string
    source: 'coach_question' | 'reflection'
    text: string
    subject?: string
    grade?: string
    at?: Date
  }): Promise<boolean> {
    const ctx = await this.contextFor(input.userId)
    if (!ctx) return false // no seat or institution opted out -> nothing leaves the tenant

    const { topic, skill } = classifyText(input.text)
    await this.db.analyticsSignal.create({
      data: {
        id: newUlid(),
        teacherHash: this.teacherHash(input.userId),
        source: input.source,
        topic,
        skill,
        subject: input.subject ?? null,
        grade: input.grade ?? null,
        country: ctx.country,
        institutionType: ctx.institutionType,
        weekBucket: isoWeekBucket(input.at ?? new Date()),
      },
    })
    return true
  }

  /**
   * "What do teachers struggle to explain?" — the flagship insights query.
   * Any cell with fewer than K distinct teachers is REMOVED (not zeroed),
   * and the count of suppressed cells is disclosed.
   */
  async topConcepts(filter: {
    country?: string | undefined
    institutionType?: string | undefined
    sinceWeeks?: number | undefined
  }): Promise<{ cells: ConceptCell[]; suppressedCells: number; kThreshold: number }> {
    const since = new Date(Date.now() - (filter.sinceWeeks ?? 12) * 7 * 86_400_000)
    const signals = await this.db.analyticsSignal.findMany({
      where: {
        createdAt: { gte: since },
        ...(filter.country ? { country: filter.country } : {}),
        ...(filter.institutionType ? { institutionType: filter.institutionType } : {}),
      },
      select: { topic: true, skill: true, teacherHash: true },
    })

    const byTopic = new Map<
      string,
      { skill: string | null; count: number; teachers: Set<string> }
    >()
    for (const s of signals) {
      const cell = byTopic.get(s.topic) ?? { skill: s.skill, count: 0, teachers: new Set() }
      cell.count++
      cell.teachers.add(s.teacherHash)
      byTopic.set(s.topic, cell)
    }

    const k = this.env.ANALYTICS_K_THRESHOLD
    const cells: ConceptCell[] = []
    let suppressed = 0
    for (const [topic, cell] of byTopic) {
      if (cell.teachers.size < k) {
        suppressed++
        continue
      }
      cells.push({ topic, skill: cell.skill, signals: cell.count, teachers: cell.teachers.size })
    }
    cells.sort((a, b) => b.signals - a.signals)
    return { cells, suppressedCells: suppressed, kThreshold: k }
  }

  /** Weekly trend for one topic — each bucket independently k-suppressed. */
  async trend(filter: {
    topic: string
    country?: string | undefined
    sinceWeeks?: number | undefined
  }) {
    const since = new Date(Date.now() - (filter.sinceWeeks ?? 12) * 7 * 86_400_000)
    const signals = await this.db.analyticsSignal.findMany({
      where: {
        topic: filter.topic,
        createdAt: { gte: since },
        ...(filter.country ? { country: filter.country } : {}),
      },
      select: { weekBucket: true, teacherHash: true },
    })
    const byWeek = new Map<string, { count: number; teachers: Set<string> }>()
    for (const s of signals) {
      const cell = byWeek.get(s.weekBucket) ?? { count: 0, teachers: new Set() }
      cell.count++
      cell.teachers.add(s.teacherHash)
      byWeek.set(s.weekBucket, cell)
    }
    const k = this.env.ANALYTICS_K_THRESHOLD
    return [...byWeek.entries()]
      .filter(([, c]) => c.teachers.size >= k)
      .map(([weekBucket, c]) => ({ weekBucket, signals: c.count, teachers: c.teachers.size }))
      .sort((a, b) => a.weekBucket.localeCompare(b.weekBucket))
  }
}
