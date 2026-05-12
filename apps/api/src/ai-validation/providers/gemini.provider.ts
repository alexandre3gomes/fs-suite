import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

import type { AiProvider, AiProviderConfig } from './ai-provider.interface';

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);

  async generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    config: AiProviderConfig,
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(`Gemini API error ${response.status}: ${body.slice(0, 200)}`);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      Sentry.captureMessage('Gemini returned empty response', {
        level: 'warning',
        tags: { provider: 'gemini' },
      });
      throw new Error('Gemini returned empty response');
    }

    return text;
  }
}
