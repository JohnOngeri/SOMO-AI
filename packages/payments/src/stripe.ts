import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  Charge,
  CreateChargeInput,
  PaymentProvider,
  Refund,
  RefundInput,
  WebhookEvent,
} from './provider'

const API = 'https://api.stripe.com/v1'

/**
 * Card rail for institutions that pay by card rather than bank transfer.
 * Thin fetch-based adapter (PaymentIntents) — the interface stays the
 * contract; B2B invoicing works without any provider at all.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly id = 'stripe' as const

  constructor(
    private secretKey: string,
    private webhookSecret: string,
    /** webhook timestamp tolerance, seconds */
    private toleranceSec = 300,
  ) {}

  private async call(
    path: string,
    body?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
    })
    const json = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      const err = json.error as { message?: string } | undefined
      throw new Error(`stripe: ${err?.message ?? res.status}`)
    }
    return json
  }

  private toCharge(pi: Record<string, unknown>, input?: CreateChargeInput): Charge {
    const status = String(pi.status)
    const meta = (pi.metadata ?? {}) as Record<string, string>
    return {
      providerRef: String(pi.id),
      status: status === 'succeeded' ? 'succeeded' : status === 'canceled' ? 'failed' : 'pending',
      amountMinor: Number(pi.amount),
      currency: String(pi.currency).toUpperCase() as Charge['currency'],
      channel: 'card',
      customerId: input?.customerId ?? meta.customerId ?? '',
      idempotencyKey: input?.idempotencyKey ?? meta.idempotencyKey ?? '',
    }
  }

  async createCharge(input: CreateChargeInput): Promise<Charge> {
    const pi = await this.call('/payment_intents', {
      amount: String(input.amountMinor),
      currency: input.currency.toLowerCase(),
      'automatic_payment_methods[enabled]': 'true',
      'metadata[customerId]': input.customerId,
      'metadata[idempotencyKey]': input.idempotencyKey,
      ...(input.description ? { description: input.description } : {}),
    })
    return this.toCharge(pi, input)
  }

  async fetchCharge(providerRef: string): Promise<Charge | null> {
    try {
      return this.toCharge(await this.call(`/payment_intents/${providerRef}`))
    } catch {
      return null
    }
  }

  async refund(input: RefundInput): Promise<Refund> {
    const refund = await this.call('/refunds', {
      payment_intent: input.providerRef,
      ...(input.amountMinor ? { amount: String(input.amountMinor) } : {}),
      'metadata[idempotencyKey]': input.idempotencyKey,
    })
    return {
      refundRef: String(refund.id),
      providerRef: input.providerRef,
      status: refund.status === 'succeeded' ? 'succeeded' : 'failed',
      amountMinor: Number(refund.amount),
    }
  }

  /**
   * Stripe-Signature scheme: `t=<ts>,v1=<hmac-sha256(ts + '.' + payload)>`.
   * Constant-time compare + timestamp tolerance; returns the normalized event.
   */
  verifyWebhook(
    rawBody: string,
    signature: string,
    nowSec = Math.floor(Date.now() / 1000),
  ): WebhookEvent | null {
    const parts = new Map(
      signature.split(',').map((kv) => {
        const [k, ...rest] = kv.split('=')
        return [k?.trim() ?? '', rest.join('=')] as const
      }),
    )
    const ts = parts.get('t')
    const v1 = parts.get('v1')
    if (!ts || !v1) return null
    if (Math.abs(nowSec - Number(ts)) > this.toleranceSec) return null

    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${ts}.${rawBody}`)
      .digest('hex')
    const a = Buffer.from(v1)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    try {
      const event = JSON.parse(rawBody) as {
        id: string
        type: string
        data: { object: Record<string, unknown> }
      }
      const map: Record<string, WebhookEvent['type']> = {
        'payment_intent.succeeded': 'charge.succeeded',
        'payment_intent.payment_failed': 'charge.failed',
        'charge.refunded': 'refund.succeeded',
      }
      const type = map[event.type]
      if (!type) return null
      const object = event.data.object
      return {
        id: event.id,
        type,
        providerRef: String(object.id ?? object.payment_intent ?? ''),
        data: this.toCharge(object),
      }
    } catch {
      return null
    }
  }
}
