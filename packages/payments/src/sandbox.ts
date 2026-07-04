import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type {
  Charge,
  CreateChargeInput,
  PaymentProvider,
  Refund,
  RefundInput,
  WebhookEvent,
} from './provider'

/**
 * Deterministic in-memory payment provider, modeled on real mobile-money rails.
 *
 * Test-control conventions (like Stripe's test cards):
 *   msisdn ending '0000'  -> fails immediately: insufficient_funds
 *   msisdn ending '9999'  -> fails immediately: invalid_msisdn
 *   msisdn ending '1111'  -> stays 'pending' (STK push in flight);
 *                            settle it with settlePending(), which yields a
 *                            signed webhook — exactly how mobile money behaves.
 *   amountMinor === 13    -> declined (any channel)
 *   anything else         -> succeeds synchronously
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly id = 'sandbox' as const

  private chargesByKey = new Map<string, Charge>()
  private chargesByRef = new Map<string, Charge>()
  private refundedByRef = new Map<string, number>()
  private refundsByKey = new Map<string, Refund>()
  private eventSeq = 0

  constructor(private webhookSecret: string = 'sandbox_whsec') {}

  async createCharge(input: CreateChargeInput): Promise<Charge> {
    const existing = this.chargesByKey.get(input.idempotencyKey)
    if (existing) return existing

    if (input.amountMinor <= 0) throw new Error('amountMinor must be positive')
    if ((input.channel === 'mobile_money' || input.channel === 'airtime') && !input.msisdn) {
      throw new Error(`${input.channel} charges require an msisdn`)
    }

    const providerRef = `sb_${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 16)}`
    const msisdn = input.msisdn ?? ''

    let charge: Charge = {
      providerRef,
      status: 'succeeded',
      amountMinor: input.amountMinor,
      currency: input.currency,
      channel: input.channel,
      customerId: input.customerId,
      idempotencyKey: input.idempotencyKey,
    }

    if (msisdn.endsWith('0000')) {
      charge = { ...charge, status: 'failed', failureCode: 'insufficient_funds' }
    } else if (msisdn.endsWith('9999')) {
      charge = { ...charge, status: 'failed', failureCode: 'invalid_msisdn' }
    } else if (msisdn.endsWith('1111')) {
      charge = { ...charge, status: 'pending' }
    } else if (input.amountMinor === 13) {
      charge = { ...charge, status: 'failed', failureCode: 'declined' }
    }

    this.chargesByKey.set(input.idempotencyKey, charge)
    this.chargesByRef.set(providerRef, charge)
    return charge
  }

  async fetchCharge(providerRef: string): Promise<Charge | null> {
    return this.chargesByRef.get(providerRef) ?? null
  }

  /**
   * Settle a pending charge (the customer confirmed or ignored the STK push).
   * Returns the signed webhook delivery the real provider would POST to us.
   */
  settlePending(
    providerRef: string,
    outcome: 'succeeded' | 'failed',
  ): { rawBody: string; signature: string } {
    const charge = this.chargesByRef.get(providerRef)
    if (!charge) throw new Error(`unknown charge ${providerRef}`)
    if (charge.status !== 'pending') throw new Error(`charge ${providerRef} is not pending`)

    const settled: Charge = {
      ...charge,
      status: outcome,
      ...(outcome === 'failed' ? { failureCode: 'timeout' as const } : {}),
    }
    this.chargesByRef.set(providerRef, settled)
    this.chargesByKey.set(charge.idempotencyKey, settled)

    return this.emitWebhook(outcome === 'succeeded' ? 'charge.succeeded' : 'charge.failed', settled)
  }

  async refund(input: RefundInput): Promise<Refund> {
    const existing = this.refundsByKey.get(input.idempotencyKey)
    if (existing) return existing

    const charge = this.chargesByRef.get(input.providerRef)
    const alreadyRefunded = this.refundedByRef.get(input.providerRef) ?? 0
    const amount = input.amountMinor ?? (charge ? charge.amountMinor - alreadyRefunded : 0)

    let refund: Refund
    if (
      !charge ||
      charge.status !== 'succeeded' ||
      amount <= 0 ||
      alreadyRefunded + amount > charge.amountMinor
    ) {
      refund = {
        refundRef: `sbr_fail_${input.idempotencyKey.slice(0, 8)}`,
        providerRef: input.providerRef,
        status: 'failed',
        amountMinor: amount,
      }
    } else {
      this.refundedByRef.set(input.providerRef, alreadyRefunded + amount)
      refund = {
        refundRef: `sbr_${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 16)}`,
        providerRef: input.providerRef,
        status: 'succeeded',
        amountMinor: amount,
      }
    }

    this.refundsByKey.set(input.idempotencyKey, refund)
    return refund
  }

  verifyWebhook(rawBody: string, signature: string): WebhookEvent | null {
    const expected = this.sign(rawBody)
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    return JSON.parse(rawBody) as WebhookEvent
  }

  /** Build + sign a webhook body — used by settlePending and by billing tests. */
  emitWebhook(
    type: WebhookEvent['type'],
    data: Charge | Refund,
  ): { rawBody: string; signature: string } {
    const event: WebhookEvent = {
      id: `evt_sb_${++this.eventSeq}`,
      type,
      providerRef: 'providerRef' in data ? data.providerRef : '',
      data,
    }
    const rawBody = JSON.stringify(event)
    return { rawBody, signature: this.sign(rawBody) }
  }

  private sign(rawBody: string): string {
    return createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex')
  }
}
