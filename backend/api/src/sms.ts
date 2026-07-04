/**
 * SMS delivery abstraction. The real gateway adapter (Africa's Talking)
 * arrives with backend/ussd-gateway in Phase 8; the console sender covers
 * dev, and the memory sender lets tests read the codes that were "sent".
 */
export interface SmsSender {
  send(to: string, message: string): Promise<void>
}

export class ConsoleSmsSender implements SmsSender {
  async send(to: string, message: string): Promise<void> {
    console.log(`[sms -> ${to}] ${message}`)
  }
}

export class MemorySmsSender implements SmsSender {
  public sent: { to: string; message: string }[] = []

  async send(to: string, message: string): Promise<void> {
    this.sent.push({ to, message })
  }

  lastCodeFor(phone: string): string | undefined {
    const msg = [...this.sent].reverse().find((s) => s.to === phone)?.message
    return msg?.match(/\d{6}/)?.[0]
  }
}
