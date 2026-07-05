import type { PaymentChannel, PaymentProvider } from '@somo/payments'
import type { PrismaClient } from '../db'
import { newUlid } from '../ids'

/** SOMO keeps 25% of every marketplace sale (BUSINESS_MODEL.md §1C). */
export const PLATFORM_FEE_PCT = 25
/** Creators can cash out from this balance upward (minor units). */
export const MIN_PAYOUT_MINOR = 1000

export class MarketplaceError extends Error {
  constructor(
    public code:
      | 'pack_not_found'
      | 'not_for_sale'
      | 'charge_failed'
      | 'payment_pending'
      | 'insufficient_balance'
      | 'not_found',
    message?: string,
  ) {
    super(message ?? code)
  }
}

export function splitFee(grossMinor: number): { feeMinor: number; netMinor: number } {
  const feeMinor = Math.round((grossMinor * PLATFORM_FEE_PCT) / 100)
  return { feeMinor, netMinor: grossMinor - feeMinor }
}

export class MarketplaceService {
  constructor(
    private db: PrismaClient,
    private payments: PaymentProvider,
  ) {}

  async hasGrant(userId: string, packId: string): Promise<boolean> {
    return (
      (await this.db.packGrant.findUnique({
        where: { packId_userId: { packId, userId } },
      })) !== null
    )
  }

  /**
   * Buy a paid pack. Success → grant + sale + balanced ledger split.
   * Mobile-money pending parks the purchase; the payment webhook completes it
   * through completeSaleForCharge().
   */
  async buyPack(input: {
    buyerId: string
    packId: string
    channel: PaymentChannel
    msisdn?: string
    idempotencyKey: string
  }) {
    const pack = await this.db.pack.findUnique({ where: { id: input.packId } })
    if (!pack || pack.status !== 'live') throw new MarketplaceError('pack_not_found')
    if (pack.priceAmountMinor <= 0) throw new MarketplaceError('not_for_sale', 'pack is free')

    if (await this.hasGrant(input.buyerId, input.packId)) {
      return { alreadyOwned: true as const }
    }

    // idempotent retry
    const prior = await this.db.paymentCharge.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (prior) {
      if (prior.status === 'succeeded') return { alreadyOwned: true as const }
      if (prior.status === 'pending') throw new MarketplaceError('payment_pending')
      throw new MarketplaceError('charge_failed', prior.failureCode ?? undefined)
    }

    const charge = await this.payments.createCharge({
      idempotencyKey: input.idempotencyKey,
      amountMinor: pack.priceAmountMinor,
      currency: pack.priceCurrency as never,
      channel: input.channel,
      ...(input.msisdn ? { msisdn: input.msisdn } : {}),
      customerId: input.buyerId,
      description: `Pack: ${pack.title}`,
    })
    await this.db.paymentCharge.create({
      data: {
        id: newUlid(),
        userId: input.buyerId,
        purpose: 'marketplace',
        amountMinor: charge.amountMinor,
        currency: charge.currency,
        channel: charge.channel,
        provider: this.payments.id,
        providerRef: charge.providerRef,
        idempotencyKey: charge.idempotencyKey,
        status: charge.status,
        failureCode: charge.failureCode ?? null,
        meta: { packId: pack.id },
      },
    })

    if (charge.status === 'failed') throw new MarketplaceError('charge_failed', charge.failureCode)
    if (charge.status === 'pending') throw new MarketplaceError('payment_pending')

    const sale = await this.settleSale({
      packId: pack.id,
      buyerId: input.buyerId,
      creatorId: pack.publisherId,
      grossMinor: pack.priceAmountMinor,
      currency: pack.priceCurrency,
      providerRef: charge.providerRef,
    })
    return { alreadyOwned: false as const, sale }
  }

  /** Called by the webhook dispatcher when a pending marketplace charge settles. */
  async completeSaleForCharge(providerRef: string): Promise<void> {
    const charge = await this.db.paymentCharge.findUnique({ where: { providerRef } })
    if (!charge || charge.purpose !== 'marketplace') return
    if (await this.db.sale.findUnique({ where: { providerRef } })) return // replay

    const packId = (charge.meta as Record<string, unknown>).packId
    if (typeof packId !== 'string') return
    const pack = await this.db.pack.findUnique({ where: { id: packId } })
    if (!pack) return

    await this.settleSale({
      packId: pack.id,
      buyerId: charge.userId,
      creatorId: pack.publisherId,
      grossMinor: charge.amountMinor,
      currency: charge.currency,
      providerRef,
    })
  }

  private async settleSale(input: {
    packId: string
    buyerId: string
    creatorId: string
    grossMinor: number
    currency: string
    providerRef: string
  }) {
    const { feeMinor, netMinor } = splitFee(input.grossMinor)
    const saleId = newUlid()

    const sale = await this.db.$transaction(async (tx) => {
      const s = await tx.sale.create({
        data: {
          id: saleId,
          packId: input.packId,
          buyerId: input.buyerId,
          creatorId: input.creatorId,
          grossMinor: input.grossMinor,
          platformFeeMinor: feeMinor,
          creatorNetMinor: netMinor,
          currency: input.currency,
          providerRef: input.providerRef,
        },
      })
      await tx.packGrant.create({
        data: {
          id: newUlid(),
          packId: input.packId,
          userId: input.buyerId,
          source: 'purchase',
        },
      })
      // balanced journal: -gross +fee +net = 0
      await tx.ledgerEntry.createMany({
        data: [
          {
            id: newUlid(),
            account: 'platform:clearing',
            amountMinor: -input.grossMinor,
            currency: input.currency,
            type: 'sale_gross',
            refId: saleId,
          },
          {
            id: newUlid(),
            account: 'platform:revenue',
            amountMinor: feeMinor,
            currency: input.currency,
            type: 'platform_fee',
            refId: saleId,
          },
          {
            id: newUlid(),
            account: `creator:${input.creatorId}`,
            amountMinor: netMinor,
            currency: input.currency,
            type: 'creator_credit',
            refId: saleId,
          },
        ],
      })
      return s
    })
    return sale
  }

  /** Reverse a sale: refund the buyer, mirror the journal, revoke the grant. */
  async refundSale(saleId: string, idempotencyKey: string) {
    const sale = await this.db.sale.findUnique({ where: { id: saleId } })
    if (!sale) throw new MarketplaceError('not_found')
    if (sale.refunded) return sale

    const refund = await this.payments.refund({
      providerRef: sale.providerRef,
      idempotencyKey,
    })
    if (refund.status !== 'succeeded') throw new MarketplaceError('charge_failed', 'refund failed')

    const refId = newUlid()
    await this.db.$transaction(async (tx) => {
      await tx.ledgerEntry.createMany({
        data: [
          {
            id: newUlid(),
            account: 'platform:clearing',
            amountMinor: sale.grossMinor,
            currency: sale.currency,
            type: 'refund',
            refId,
          },
          {
            id: newUlid(),
            account: 'platform:revenue',
            amountMinor: -sale.platformFeeMinor,
            currency: sale.currency,
            type: 'refund',
            refId,
          },
          {
            id: newUlid(),
            account: `creator:${sale.creatorId}`,
            amountMinor: -sale.creatorNetMinor,
            currency: sale.currency,
            type: 'refund',
            refId,
          },
        ],
      })
      await tx.sale.update({ where: { id: sale.id }, data: { refunded: true } })
      await tx.packGrant.deleteMany({ where: { packId: sale.packId, userId: sale.buyerId } })
    })
    return this.db.sale.findUniqueOrThrow({ where: { id: sale.id } })
  }

  async creatorBalance(creatorId: string): Promise<number> {
    const agg = await this.db.ledgerEntry.aggregate({
      where: { account: `creator:${creatorId}` },
      _sum: { amountMinor: true },
    })
    return agg._sum.amountMinor ?? 0
  }

  async earnings(creatorId: string) {
    const sales = await this.db.sale.findMany({
      where: { creatorId },
      orderBy: { at: 'desc' },
      take: 100,
    })
    const lifetime = sales.reduce((sum, s) => sum + (s.refunded ? 0 : s.creatorNetMinor), 0)
    const paidOut = await this.db.payout.aggregate({
      where: { creatorId, status: 'paid' },
      _sum: { amountMinor: true },
    })
    return {
      balanceMinor: await this.creatorBalance(creatorId),
      lifetimeNetMinor: lifetime,
      paidOutMinor: paidOut._sum.amountMinor ?? 0,
      sales,
    }
  }

  /** Cash out the full balance (sandbox settles instantly; real rails async). */
  async requestPayout(creatorId: string, currency: string, idempotencyKey: string) {
    const prior = await this.db.payout.findUnique({ where: { idempotencyKey } })
    if (prior) return prior

    const balance = await this.creatorBalance(creatorId)
    if (balance < MIN_PAYOUT_MINOR) throw new MarketplaceError('insufficient_balance')

    const payoutId = newUlid()
    return this.db.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: {
          id: payoutId,
          creatorId,
          amountMinor: balance,
          currency,
          status: 'paid',
          providerRef: `sbp_${payoutId.slice(0, 12)}`,
          idempotencyKey,
          settledAt: new Date(),
        },
      })
      await tx.ledgerEntry.createMany({
        data: [
          {
            id: newUlid(),
            account: `creator:${creatorId}`,
            amountMinor: -balance,
            currency,
            type: 'payout',
            refId: payoutId,
          },
          {
            id: newUlid(),
            account: 'platform:clearing',
            amountMinor: balance,
            currency,
            type: 'payout',
            refId: payoutId,
          },
        ],
      })
      return payout
    })
  }
}
