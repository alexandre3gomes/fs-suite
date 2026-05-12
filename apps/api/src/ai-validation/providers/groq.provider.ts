import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

import type { AiProvider, AiProviderConfig } from './ai-provider.interface';

export class GroqProvider implements AiProvider {
  readonly name = 'groq';
  private readonly logger = new Logger(GroqProvider.name);

  async generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    config: AiProviderConfig,
  ): Promise<string> {
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(`Groq API error ${response.status}: ${body.slice(0, 200)}`);
      throw new Error(`Groq API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      Sentry.captureMessage('Groq returned empty response', {
        level: 'warning',
        tags: { provider: 'groq' },
      });
      throw new Error('Groq returned empty response');
    }

    return text;
  }
}
