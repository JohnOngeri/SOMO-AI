import { signPayload, sha256Hex, verifyPayload } from '@somo/packsign'
import type { PackManifest } from '@somo/types'
import type { PrismaClient } from '../db'
import { newUlid } from '../ids'
import type { ObjectStore } from '../storage'

export interface SigningKeys {
  publicKeyId: string
  privateKey: string // base64 pkcs8
  publicKey: string // base64 spki
}

export interface PublishInput {
  slug: string
  title: string
  subject: string
  gradeLevels: string[]
  locale: string
  version: string
  publisherId: string
  lessons: { index: number; title: string; minutes: number }[]
  priceAmountMinor: number
  priceCurrency: string
  archive: Buffer
}

export class PackService {
  constructor(
    private db: PrismaClient,
    private store: ObjectStore,
    private keys: SigningKeys,
  ) {}

  /** Hash + sign + store. The signature covers the FULL manifest incl. contentHash. */
  async publish(input: PublishInput) {
    const id = newUlid()
    const contentHash = sha256Hex(input.archive)
    const storageKey = `packs/${id}/${input.version}.somopack`

    const manifest: PackManifest = {
      id,
      slug: input.slug,
      title: input.title,
      subject: input.subject,
      gradeLevels: input.gradeLevels,
      locale: input.locale as PackManifest['locale'],
      version: input.version,
      publisherId: input.publisherId,
      sizeBytes: input.archive.byteLength,
      contentHash,
      lessons: input.lessons,
      price: {
        amountMinor: input.priceAmountMinor,
        currency: input.priceCurrency as PackManifest['price']['currency'],
      },
      createdAt: new Date().toISOString(),
    }
    const signature = signPayload(manifest, this.keys.privateKey)

    await this.store.put(storageKey, input.archive)
    await this.db.pack.create({
      data: {
        id,
        slug: manifest.slug,
        title: manifest.title,
        subject: manifest.subject,
        gradeLevels: manifest.gradeLevels,
        locale: manifest.locale,
        version: manifest.version,
        publisherId: manifest.publisherId,
        sizeBytes: manifest.sizeBytes,
        contentHash,
        lessons: manifest.lessons,
        priceAmountMinor: manifest.price.amountMinor,
        priceCurrency: manifest.price.currency,
        signature,
        publicKeyId: this.keys.publicKeyId,
        storageKey,
        createdAt: new Date(manifest.createdAt),
      },
    })

    return { manifest, signature, publicKeyId: this.keys.publicKeyId }
  }

  /** Rebuild the signed manifest exactly as it was signed at publish time. */
  toSignedManifest(row: {
    id: string
    slug: string
    title: string
    subject: string
    gradeLevels: string[]
    locale: string
    version: string
    publisherId: string
    sizeBytes: number
    contentHash: string
    lessons: unknown
    priceAmountMinor: number
    priceCurrency: string
    signature: string
    publicKeyId: string
    createdAt: Date
  }) {
    const manifest = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      subject: row.subject,
      gradeLevels: row.gradeLevels,
      locale: row.locale,
      version: row.version,
      publisherId: row.publisherId,
      sizeBytes: row.sizeBytes,
      contentHash: row.contentHash,
      lessons: row.lessons,
      price: { amountMinor: row.priceAmountMinor, currency: row.priceCurrency },
      createdAt: row.createdAt.toISOString(),
    }
    return {
      manifest,
      signature: { alg: 'ed25519' as const, publicKeyId: row.publicKeyId, sig: row.signature },
    }
  }

  verify(manifest: unknown, sig: string): boolean {
    return verifyPayload(manifest, sig, this.keys.publicKey)
  }

  async getArchive(storageKey: string): Promise<Buffer> {
    return this.store.get(storageKey)
  }
}
