import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'

/**
 * Object storage behind an interface. Dev + tests use the filesystem store;
 * production points at S3/MinIO (adapter lands with deploy hardening — the
 * docker-compose MinIO is already provisioned for it).
 */
export interface ObjectStore {
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
}

export class FsObjectStore implements ObjectStore {
  constructor(private rootDir: string) {}

  private resolve(key: string): string {
    const p = path.normalize(path.join(this.rootDir, key))
    if (!p.startsWith(path.normalize(this.rootDir))) throw new Error('invalid storage key')
    return p
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, data)
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key))
      return true
    } catch {
      return false
    }
  }
}
