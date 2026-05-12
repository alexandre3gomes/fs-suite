export interface AiProviderConfig {
  apiKey: string;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  generateCompletion(
    systemPrompt: string,
    userPrompt: string,
    config: AiProviderConfig,
  ): Promise<string>;
}
