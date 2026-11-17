import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import { openaiProvider } from './openai'
import { type Provider, type ProviderOptions, type ProviderSettings } from './types'

export * from './types'

export function createProvider(
  settings: ProviderSettings,
  apiKey: string | undefined,
  options: ProviderOptions = {}
): Provider {
  switch (settings.kind) {
    case 'anthropic':
      return anthropicProvider(settings.model, apiKey ?? '', options)
    case 'gemini':
      return geminiProvider(settings.model, apiKey ?? '', options)
    case 'openai':
      return openaiProvider(settings.model, apiKey, settings.baseUrl, options)
  }
}
