import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { StripePaymentProvider } from '../src/index'

const SECRET = 'whsec_test'

function sign(body: string, ts: number, secret = SECRET) {
  const v1 = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  return `t=${ts},v1=${v1}`
}

describe('Stripe webhook signature scheme', () => {
  const stripe = new StripePaymentProvider('sk_test_x', SECRET)
  const now = 1_800_000_000
  const body = JSON.stringify({
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_123',
        status: 'succeeded',
        amount: 120000,
        currency: 'usd',
        metadata: { customerId: 'inst_1', idempotencyKey: 'k1' },
      },
    },
  })

  it('accepts a valid signature and normalizes the event', () => {
    const event = stripe.verifyWebhook(body, sign(body, now), now)
    expect(event).not.toBeNull()
    expect(event!.type).toBe('charge.succeeded')
    expect(event!.providerRef).toBe('pi_123')
  })

  it('rejects tampered bodies, wrong secrets, and stale timestamps', () => {
    expect(
      stripe.verifyWebhook(body.replace('succeeded', 'failed!!'), sign(body, now), now),
    ).toBeNull()
    expect(stripe.verifyWebhook(body, sign(body, now, 'whsec_other'), now)).toBeNull()
    expect(stripe.verifyWebhook(body, sign(body, now - 3600), now)).toBeNull()
    expect(stripe.verifyWebhook(body, 'garbage', now)).toBeNull()
  })

  it('ignores event types outside the contract', () => {
    const other = JSON.stringify({ id: 'evt_2', type: 'customer.created', data: { object: {} } })
    expect(stripe.verifyWebhook(other, sign(other, now), now)).toBeNull()
  })
})
