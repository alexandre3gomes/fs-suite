import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

import type { AiProvider, AiProviderConfig } from './ai-provider.interface';

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);

  async generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    config: AiProviderConfig,
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 16_384,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `Anthropic API error ${response.status}: ${body.slice(0, 200)}`,
      );
      throw new Error(`Anthropic API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      content?: { type: string; text?: string }[];
    };

    const text = data.content?.find((c) => c.type === 'text')?.text;
    if (!text) {
      Sentry.captureMessage('Anthropic returned empty response', {
        level: 'warning',
        tags: { provider: 'anthropic' },
      });
      throw new Error('Anthropic returned empty response');
    }

    return text;
  }
}
