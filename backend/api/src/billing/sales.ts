import type { PrismaClient } from '../db'
import { newUlid } from '../ids'
import type { SeatService } from '../seats/service'
import { quoteSeats } from './pricing'

export class SalesError extends Error {
  constructor(
    public code: 'not_found' | 'invalid_state' | 'invalid_input',
    message?: string,
  ) {
    super(message ?? code)
  }
}

/**
 * The B2B money pipeline: quote → order → invoice → paid → license
 * provisioned. Provisioning happens ONLY on payment (fail closed, as
 * everywhere); marking paid is idempotent; invoice numbers are sequential
 * and human-quotable.
 */
export class SalesService {
  constructor(
    private db: PrismaClient,
    private seats: SeatService,
  ) {}

  /** Price a deal from the config — no rows written. */
  async priceQuote(institutionId: string, seatCount: number, currency: string) {
    const inst = await this.db.institution.findUnique({ where: { id: institutionId } })
    if (!inst) throw new SalesError('not_found')
    return quoteSeats(inst.type, seatCount, currency)
  }

  async createQuote(input: {
    institutionId: string
    term: string
    startDate: Date
    endDate: Date
    seats: number
    currency: string
  }) {
    if (input.endDate <= input.startDate)
      throw new SalesError('invalid_input', 'term dates invalid')
    const inst = await this.db.institution.findUnique({ where: { id: input.institutionId } })
    if (!inst) throw new SalesError('not_found')
    const quote = quoteSeats(inst.type, input.seats, input.currency)
    return this.db.order.create({
      data: {
        id: newUlid(),
        institutionId: inst.id,
        term: input.term,
        startDate: input.startDate,
        endDate: input.endDate,
        seats: input.seats,
        institutionType: inst.type,
        currency: quote.currency,
        perSeatMinor: quote.perSeatMinor,
        discountPct: quote.discountPct,
        totalMinor: quote.totalMinor,
      },
    })
  }

  async acceptQuote(orderId: string) {
    const order = await this.db.order.findUnique({ where: { id: orderId } })
    if (!order) throw new SalesError('not_found')
    if (order.status !== 'QUOTE')
      throw new SalesError('invalid_state', `cannot accept ${order.status}`)
    return this.db.order.update({ where: { id: orderId }, data: { status: 'ORDERED' } })
  }

  /** Sequential human number: INV-<year>-<n>, per calendar year. */
  private async nextInvoiceNumber(at: Date): Promise<string> {
    const year = at.getUTCFullYear()
    const count = await this.db.invoice.count({
      where: { number: { startsWith: `INV-${year}-` } },
    })
    return `INV-${year}-${String(count + 1).padStart(4, '0')}`
  }

  async issueInvoice(
    orderId: string,
    opts: { dueInDays?: number | undefined; at?: Date | undefined } = {},
  ) {
    const at = opts.at ?? new Date()
    const order = await this.db.order.findUnique({
      where: { id: orderId },
      include: { invoice: true },
    })
    if (!order) throw new SalesError('not_found')
    if (order.invoice) return order.invoice // idempotent
    if (order.status !== 'ORDERED') {
      throw new SalesError('invalid_state', `cannot invoice ${order.status}`)
    }

    const invoice = await this.db.invoice.create({
      data: {
        id: newUlid(),
        number: await this.nextInvoiceNumber(at),
        orderId: order.id,
        institutionId: order.institutionId,
        currency: order.currency,
        totalMinor: order.totalMinor,
        issuedAt: at,
        dueAt: new Date(at.getTime() + (opts.dueInDays ?? 30) * 86_400_000),
      },
    })
    await this.db.order.update({ where: { id: order.id }, data: { status: 'INVOICED' } })
    return invoice
  }

  /**
   * Payment lands (bank transfer reference or provider ref) → the license
   * is provisioned with exactly the ordered seats. Idempotent: a second
   * markPaid returns the same provisioned state.
   */
  async markPaid(invoiceId: string, paymentRef: string, at: Date = new Date()) {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
      include: { order: true },
    })
    if (!invoice) throw new SalesError('not_found')
    if (invoice.paidAt) {
      const license = invoice.order.licenseId
        ? await this.db.license.findUnique({ where: { id: invoice.order.licenseId } })
        : null
      return { invoice, license }
    }

    const paid = await this.db.invoice.update({
      where: { id: invoice.id },
      data: { paidAt: at, paymentRef },
    })

    const license = await this.seats.createLicense({
      institutionId: invoice.order.institutionId,
      term: invoice.order.term,
      startDate: invoice.order.startDate,
      endDate: invoice.order.endDate,
      seatsPurchased: invoice.order.seats,
      pricePerSeatMinor: invoice.order.perSeatMinor,
      currency: invoice.order.currency,
    })
    await this.db.order.update({
      where: { id: invoice.orderId },
      data: { status: 'PAID', licenseId: license.id },
    })
    return { invoice: paid, license }
  }

  async invoicesFor(institutionId: string) {
    return this.db.invoice.findMany({
      where: { institutionId },
      include: { order: true },
      orderBy: { issuedAt: 'desc' },
    })
  }
}
