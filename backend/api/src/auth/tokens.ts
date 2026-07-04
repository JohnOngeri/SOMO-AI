import { createHash, randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { PrismaClient } from '../db'
import type { Env } from '../env'
import { newUlid } from '../ids'

export interface AccessClaims {
  sub: string // userId
  deviceId: string
  role: string
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export class TokenService {
  private secret: Uint8Array

  constructor(
    private db: PrismaClient,
    private env: Env,
  ) {
    this.secret = new TextEncoder().encode(env.JWT_SECRET)
  }

  async signAccessToken(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.env.ACCESS_TOKEN_TTL_SECONDS * 1000)
    const token = await new SignJWT({ deviceId: claims.deviceId, role: claims.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.secret)
    return { token, expiresAt }
  }

  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret)
      if (!payload.sub || typeof payload.deviceId !== 'string') return null
      return {
        sub: payload.sub,
        deviceId: payload.deviceId,
        role: String(payload.role ?? 'teacher'),
      }
    } catch {
      return null
    }
  }

  /** Issue a fresh refresh token for a device. Stores only the hash. */
  async issueRefreshToken(userId: string, deviceId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url')
    await this.db.refreshToken.create({
      data: {
        id: newUlid(),
        tokenHash: sha256(raw),
        userId,
        deviceId,
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    })
    return raw
  }

  /**
   * Rotate a refresh token. Single use: presenting an already-rotated token
   * is treated as theft and revokes every token on that device.
   */
  async rotateRefreshToken(
    raw: string,
    deviceId: string,
  ): Promise<{ userId: string; newToken: string } | null> {
    const row = await this.db.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } })
    if (!row || row.deviceId !== deviceId) return null

    if (row.revokedAt || row.rotatedAt || row.expiresAt < new Date()) {
      // reuse or stale -> nuke the device's sessions
      await this.db.refreshToken.updateMany({
        where: { deviceId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      return null
    }

    await this.db.refreshToken.update({
      where: { id: row.id },
      data: { rotatedAt: new Date() },
    })
    const newToken = await this.issueRefreshToken(row.userId, deviceId)
    return { userId: row.userId, newToken }
  }
}

export { sha256 }
