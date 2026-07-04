import { describe, expect, it } from 'vitest'
import { SandboxPaymentProvider } from '../src/index'

const base = {
  amountMinor: 26000,
  currency: 'KES' as const,
  channel: 'mobile_money' as const,
  customerId: 'cus_1',
}

describe('SandboxPaymentProvider', () => {
  it('charges mobile money successfully', async () => {
    const sb = new SandboxPaymentProvider()
    const charge = await sb.createCharge({ ...base, idempotencyKey: 'k1', msisdn: '+254712345678' })
    expect(charge.status).toBe('succeeded')
    expect(charge.providerRef).toMatch(/^sb_[0-9a-f]{16}$/)
  })

  it('is idempotent: same key returns the SAME charge, never a double charge', async () => {
    const sb = new SandboxPaymentProvider()
    const a = await sb.createCharge({ ...base, idempotencyKey: 'k1', msisdn: '+254712345678' })
    const b = await sb.createCharge({ ...base, idempotencyKey: 'k1', msisdn: '+254712345678' })
    expect(b).toEqual(a)
    const c = await sb.createCharge({ ...base, idempotencyKey: 'k2', msisdn: '+254712345678' })
    expect(c.providerRef).not.toBe(a.providerRef)
  })

  it('fails deterministically on the magic msisdns and amount', async () => {
    const sb = new SandboxPaymentProvider()
    const broke = await sb.createCharge({ ...base, idempotencyKey: 'k1', msisdn: '+254700000000' })
    expect(broke).toMatchObject({ status: 'failed', failureCode: 'insufficient_funds' })
    const bad = await sb.createCharge({ ...base, idempotencyKey: 'k2', msisdn: '+254700009999' })
    expect(bad).toMatchObject({ status: 'failed', failureCode: 'invalid_msisdn' })
    const unlucky = await sb.createCharge({
      ...base,
      idempotencyKey: 'k3',
      msisdn: '+254712345678',
      amountMinor: 13,
    })
    expect(unlucky).toMatchObject({ status: 'failed', failureCode: 'declined' })
  })

  it('rejects mobile money without an msisdn and non-positive amounts', async () => {
    const sb = new SandboxPaymentProvider()
    await expect(sb.createCharge({ ...base, idempotencyKey: 'k1' })).rejects.toThrow(/msisdn/)
    await expect(
      sb.createCharge({ ...base, idempotencyKey: 'k2', msisdn: '+254712345678', amountMinor: 0 }),
    ).rejects.toThrow(/positive/)
  })

  it('models the async STK-push flow: pending -> settle -> verified webhook', async () => {
    const sb = new SandboxPaymentProvider()
    const pending = await sb.createCharge({
      ...base,
      idempotencyKey: 'k1',
      msisdn: '+254700001111',
    })
    expect(pending.status).toBe('pending')

    const { rawBody, signature } = sb.settlePending(pending.providerRef, 'succeeded')
    const event = sb.verifyWebhook(rawBody, signature)
    expect(event).not.toBeNull()
    expect(event!.type).toBe('charge.succeeded')
    expect(event!.providerRef).toBe(pending.providerRef)

    const settled = await sb.fetchCharge(pending.providerRef)
    expect(settled!.status).toBe('succeeded')
    // idempotency map reflects settlement too
    const replay = await sb.createCharge({ ...base, idempotencyKey: 'k1', msisdn: '+254700001111' })
    expect(replay.status).toBe('succeeded')
  })

  it('rejects a tampered webhook', async () => {
    const sb = new SandboxPaymentProvider()
    const pending = await sb.createCharge({
      ...base,
      idempotencyKey: 'k1',
      msisdn: '+254700001111',
    })
    const { rawBody, signature } = sb.settlePending(pending.providerRef, 'failed')
    expect(sb.verifyWebhook(rawBody.replace('failed', 'succeeded'), signature)).toBeNull()
    expect(sb.verifyWebhook(rawBody, 'deadbeef')).toBeNull()
  })

  it('refunds fully and partially, refuses over-refunds, and is idempotent', async () => {
    const sb = new SandboxPaymentProvider()
    const charge = await sb.createCharge({ ...base, idempotencyKey: 'k1', msisdn: '+254712345678' })

    const partial = await sb.refund({
      providerRef: charge.providerRef,
      amountMinor: 6000,
      idempotencyKey: 'r1',
    })
    expect(partial.status).toBe('succeeded')

    const replay = await sb.refund({
      providerRef: charge.providerRef,
      amountMinor: 6000,
      idempotencyKey: 'r1',
    })
    expect(replay).toEqual(partial)

    const rest = await sb.refund({ providerRef: charge.providerRef, idempotencyKey: 'r2' })
    expect(rest).toMatchObject({ status: 'succeeded', amountMinor: 20000 })

    const over = await sb.refund({
      providerRef: charge.providerRef,
      amountMinor: 1,
      idempotencyKey: 'r3',
    })
    expect(over.status).toBe('failed')
  })

  it('cannot refund a failed charge', async () => {
    const sb = new SandboxPaymentProvider()
    const failed = await sb.createCharge({ ...base, idempotencyKey: 'k1', msisdn: '+254700000000' })
    const refund = await sb.refund({ providerRef: failed.providerRef, idempotencyKey: 'r1' })
    expect(refund.status).toBe('failed')
  })
})
