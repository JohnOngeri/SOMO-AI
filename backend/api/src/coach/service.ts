import { sha256Hex } from '@somo/packsign'
import type { AskMode } from '@somo/types'
import type { PrismaClient } from '../db'
import type { Env } from '../env'
import { newUlid } from '../ids'
import type { MeteringService } from '../metering/service'
import type { SeatService } from '../seats/service'
import type { AiProvider } from './provider'

/** SMS/USSD answers must fit comfortably in concatenated SMS segments. */
const SMS_MAX_CHARS = 380

/** Thrown before ANY paid action when the asker has no authorized seat. */
export class SeatRequiredError extends Error {
  constructor() {
    super('seat_required')
  }
}

export class CoachService {
  constructor(
    private db: PrismaClient,
    private ai: AiProvider,
    private seats: SeatService,
    private metering: MeteringService,
    private env: Env,
  ) {}

  /**
   * The Ask Coach pipeline, fail-closed:
   *   idempotency -> SEAT GATE -> answer cache (free) -> quota consume ->
   *   DNA/pack grounding -> cost-routed model -> stored reply.
   * No seat: SeatRequiredError before anything that costs money.
   * Over quota: cached answers still serve (degraded); a cache miss throws
   * QuotaExceededError — the LLM is never called.
   */
  async ask(input: {
    userId: string
    askId: string
    question: string
    mode: AskMode
    dnaId?: string
  }) {
    // offline replay: same askId returns the original answer, costs nothing
    const existing = await this.db.coachReply.findUnique({ where: { askId: input.askId } })
    if (existing) {
      if (existing.userId !== input.userId) throw new Error('forbidden')
      return { reply: existing, quota: await this.quota(input.userId), degraded: false }
    }

    // ── THE GATE: no authorized seat, no service ─────────────────────
    const live = await this.seats.activeSeatFor(input.userId)
    if (!live) throw new SeatRequiredError()
    const { monthlyAiCalls } = this.seats.quotaFor(live)

    const dna = await this.loadDna(input.userId, input.dnaId)
    const normalizedHash = sha256Hex(this.normalize(input.question) + '|' + (dna?.id ?? ''))

    // cache rung: identical grounded questions are answered for free — and
    // remain available even when the seat is over its monthly quota
    const cached = await this.db.coachReply.findFirst({
      where: { normalizedHash, dnaProfileId: dna?.id ?? null },
      orderBy: { createdAt: 'desc' },
    })
    const quotaNow = await this.metering.quotaState(input.userId, 'ai_call', monthlyAiCalls)
    const overQuota = quotaNow.limit !== null && quotaNow.used >= quotaNow.limit

    if (cached) {
      const reply = await this.storeReply({
        ...input,
        dnaProfileId: dna?.id ?? null,
        normalizedHash,
        answer: cached.answer,
        costTier: 'cached',
        model: cached.model,
      })
      return { reply, quota: quotaNow, degraded: overQuota }
    }

    // cache miss: consuming a credit is the only path to the model —
    // this throws (and audits a quota_block) when the seat is exhausted
    const quota = await this.metering.recordAiCallOrThrow({
      id: input.askId,
      userId: input.userId,
      limit: monthlyAiCalls,
      meta: { mode: input.mode, licenseId: live.license.id },
    })

    const short = input.mode === 'sms' || input.mode === 'ussd'
    const tier = this.routeTier(input.question, short)
    const model = tier === 'quality' ? this.env.AI_MODEL_QUALITY : this.env.AI_MODEL_FAST

    const lessons = await this.installedLessonTitles(input.userId)
    const system = this.buildSystemPrompt(dna, lessons, short)

    const completion = await this.ai.complete({
      model,
      system,
      prompt: input.question,
      maxTokens: short ? 200 : 1024,
    })

    const answer = short ? completion.text.slice(0, SMS_MAX_CHARS) : completion.text
    const reply = await this.storeReply({
      ...input,
      dnaProfileId: dna?.id ?? null,
      normalizedHash,
      answer,
      costTier: tier,
      model: completion.model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
    })
    return { reply, quota, degraded: false }
  }

  async quota(userId: string) {
    const live = await this.seats.activeSeatFor(userId)
    const limit = live ? this.seats.quotaFor(live).monthlyAiCalls : 0
    return this.metering.quotaState(userId, 'ai_call', limit)
  }

  // ── internals ──────────────────────────────────────────────────────

  private async storeReply(input: {
    askId: string
    userId: string
    dnaProfileId: string | null
    mode: AskMode
    question: string
    normalizedHash: string
    answer: string
    costTier: string
    model: string
    inputTokens?: number
    outputTokens?: number
  }) {
    return this.db.coachReply.create({
      data: {
        id: newUlid(),
        askId: input.askId,
        userId: input.userId,
        dnaProfileId: input.dnaProfileId,
        mode: input.mode,
        question: input.question,
        normalizedHash: input.normalizedHash,
        answer: input.answer,
        costTier: input.costTier,
        model: input.model,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
      },
    })
  }

  private normalize(question: string): string {
    return question
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[?!.]+$/g, '')
      .trim()
  }

  /** Cost router: short/simple -> small model; long or multi-part -> quality. */
  private routeTier(question: string, short: boolean): 'small' | 'quality' {
    if (short) return 'small'
    const multiPart = (question.match(/\?/g) ?? []).length > 1
    return question.length > this.env.AI_QUALITY_THRESHOLD_CHARS || multiPart ? 'quality' : 'small'
  }

  private async loadDna(userId: string, dnaId?: string) {
    return this.db.classDnaProfile.findFirst({
      where: dnaId ? { id: dnaId, userId } : { userId },
      include: { responses: true },
      orderBy: { updatedAt: 'desc' },
    })
  }

  /** Lesson titles from installed packs — lightweight grounding until pgvector RAG. */
  private async installedLessonTitles(userId: string): Promise<string[]> {
    const packIds = new Set<string>(await this.metering.distinctInstalledPacks(userId))
    for (const grant of await this.db.packGrant.findMany({ where: { userId } })) {
      packIds.add(grant.packId)
    }
    if (packIds.size === 0) return []
    const packs = await this.db.pack.findMany({ where: { id: { in: [...packIds] } } })
    const titles: string[] = []
    for (const pack of packs) {
      const lessons = pack.lessons as { title?: string }[]
      for (const lesson of lessons) if (lesson.title) titles.push(`${pack.title}: ${lesson.title}`)
    }
    return titles.slice(0, 12)
  }

  private buildSystemPrompt(
    dna: Awaited<ReturnType<CoachService['loadDna']>>,
    lessons: string[],
    short: boolean,
  ): string {
    const parts = [
      'You are SOMO, a practical teaching coach for teachers in low-resource classrooms.',
      'Give concrete, immediately usable advice that works with minimal materials (chalkboard, bottle tops, call-and-response). Never suggest resources the teacher is unlikely to have.',
    ]
    if (dna) {
      const traits = dna.traits.join(', ')
      const responses = dna.responses.map((r) => `- ${r.promptId}: ${r.transcript}`).join('\n')
      parts.push(
        `CLASS CONTEXT (ground every answer in this):\nClass: ${dna.className}${dna.learnerCount ? `, ${dna.learnerCount} learners` : ''}\n${dna.summary ? `Summary: ${dna.summary}\n` : ''}${traits ? `Traits: ${traits}\n` : ''}${responses}`,
      )
    }
    if (lessons.length > 0) {
      parts.push(
        `INSTALLED LESSONS the teacher can reference:\n${lessons.map((l) => `- ${l}`).join('\n')}`,
      )
    }
    parts.push(
      short
        ? 'Answer in at most 3 short sentences, under 320 characters total. Plain text only — this arrives as an SMS.'
        : 'Answer in under 150 words. Start with the single most useful action.',
    )
    return parts.join('\n\n')
  }
}
