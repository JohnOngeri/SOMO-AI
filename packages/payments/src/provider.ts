import type { Currency } from '@somo/types'

export type PaymentChannel = 'mobile_money' | 'card' | 'airtime'
export type ChargeStatus = 'pending' | 'succeeded' | 'failed'
export type ChargeFailureCode = 'insufficient_funds' | 'declined' | 'timeout' | 'invalid_msisdn'

export interface CreateChargeInput {
  /**
   * Caller-supplied idempotency key (a ULID in practice). Retrying with the
   * same key MUST return the original charge, never a double charge.
   */
  idempotencyKey: string
  amountMinor: number
  currency: Currency
  channel: PaymentChannel
  /** required for mobile_money / airtime */
  msisdn?: string
  customerId: string
  description?: string
  metadata?: Record<string, string>
}

export interface Charge {
  providerRef: string
  status: ChargeStatus
  failureCode?: ChargeFailureCode
  amountMinor: number
  currency: Currency
  channel: PaymentChannel
  customerId: string
  idempotencyKey: string
}

export interface RefundInput {
  providerRef: string
  /** omit for a full refund */
  amountMinor?: number
  idempotencyKey: string
}

export interface Refund {
  refundRef: string
  providerRef: string
  status: 'succeeded' | 'failed'
  amountMinor: number
}

export type WebhookEventType = 'charge.succeeded' | 'charge.failed' | 'refund.succeeded'

export interface WebhookEvent {
  id: string
  type: WebhookEventType
  providerRef: string
  data: Charge | Refund
}

/**
 * Every payment rail (Flutterwave, Paystack, mobile-money direct, airtime,
 * sandbox) implements this. Billing code depends ONLY on this interface.
 */
export interface PaymentProvider {
  readonly id: 'sandbox' | 'flutterwave' | 'paystack' | 'stripe'

  createCharge(input: CreateChargeInput): Promise<Charge>

  fetchCharge(providerRef: string): Promise<Charge | null>

  refund(input: RefundInput): Promise<Refund>

  /**
   * Verify a webhook's signature and normalize its payload.
   * Returns null when the signature is invalid — callers must store the raw
   * body BEFORE calling this, and must treat null as a potential attack.
   */
  verifyWebhook(rawBody: string, signature: string): WebhookEvent | null
}
