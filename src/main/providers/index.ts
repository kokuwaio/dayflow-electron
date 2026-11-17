import { cliOf } from '../../shared/providers'
import { anthropicProvider } from './anthropic'
import { claudeCliProvider, codexCliProvider } from './cli/cli-providers'
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
    case 'claude-cli':
    case 'codex-cli': {
      if (!options.cli) throw new Error('agent CLI providers need host access options')
      const { runner, paths, ...env } = options.cli
      const cli = cliOf(settings.kind)!
      const withPath = { ...env, ...(paths[cli] ? { configuredPath: paths[cli] } : {}) }
      return cli === 'claude' ? claudeCliProvider(settings.model, runner, withPath) : codexCliProvider(settings.model, runner, withPath)
    }
  }
}
