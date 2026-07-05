import type Anthropic from '@anthropic-ai/sdk'

/**
 * Provider-agnostic AI adapter. The coach depends only on this interface;
 * Anthropic is the default implementation, the mock covers tests and
 * keyless dev environments.
 */
export interface AiCompletion {
  text: string
  inputTokens: number
  outputTokens: number
  model: string
}

export interface AiCompleteInput {
  model: string
  system: string
  prompt: string
  maxTokens: number
}

export interface AiProvider {
  readonly id: string
  complete(input: AiCompleteInput): Promise<AiCompletion>
}

export class AnthropicAiProvider implements AiProvider {
  readonly id = 'anthropic'
  private client: Anthropic | null = null

  constructor(private apiKey: string) {}

  private async getClient() {
    if (!this.client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      this.client = new Anthropic({ apiKey: this.apiKey })
    }
    return this.client
  }

  async complete(input: AiCompleteInput): Promise<AiCompletion> {
    const client = await this.getClient()
    const response = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.prompt }],
    })
    const text = response.content
      .filter(
        (b): b is Extract<(typeof response.content)[number], { type: 'text' }> => b.type === 'text',
      )
      .map((b) => b.text)
      .join('\n')
      .trim()
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
    }
  }
}

/** Deterministic provider for tests + keyless dev: echoes grounding markers. */
export class MockAiProvider implements AiProvider {
  readonly id = 'mock'
  public calls: AiCompleteInput[] = []

  async complete(input: AiCompleteInput): Promise<AiCompletion> {
    this.calls.push(input)
    const grounded = input.system.includes('CLASS CONTEXT') ? ' (grounded in your class)' : ''
    const text = `Coach advice for: ${input.prompt.slice(0, 80)}${grounded} [${input.model}]`
    return {
      text: text.slice(0, input.maxTokens),
      inputTokens: Math.ceil((input.system.length + input.prompt.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
      model: input.model,
    }
  }
}
