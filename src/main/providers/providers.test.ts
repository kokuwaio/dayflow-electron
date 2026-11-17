import { describe, expect, it } from 'vitest'
import { createProvider } from './index'
import { fakeFetch } from './fake-fetch'
import type { GenerateRequest } from './types'

const img = (s: string) => ({ type: 'image' as const, mediaType: 'image/jpeg' as const, data: Buffer.from(s) })
const b64 = (s: string) => Buffer.from(s).toString('base64')

const anthropicReply = (text: string, extra: Record<string, unknown> = {}) => ({
  json: {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }],
    ...extra
  }
})

const request: GenerateRequest = {
  system: 'You write cards.',
  turns: [
    { role: 'user', parts: [{ type: 'text', text: 'Describe' }, { type: 'text', text: 'Frame at 9:03 AM' }, img('a')] },
    { role: 'assistant', parts: [{ type: 'text', text: '[]' }] },
    { role: 'user', parts: [{ type: 'text', text: 'Fix it' }] }
  ]
}

describe('Anthropic provider', () => {
  it('sends the system prompt and the turns in order and returns the text', async () => {
    const { fetch, requests } = fakeFetch(anthropicReply('[{"title":"x"}]'))
    const provider = createProvider({ kind: 'anthropic', model: 'claude-opus-5-5' }, 'sk-test', { fetch })

    const result = await provider.generate(request)

    expect(result.text).toBe('[{"title":"x"}]')
    const req = requests[0]!
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req.headers.authorization).toBe('Bearer sk-test')
    expect(req.body.model).toBe('claude-opus-5-5')
    expect(req.body.system).toBe('You write cards.')
    expect(req.body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'text', text: 'Frame at 9:03 AM' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64('a') } }
        ]
      },
      { role: 'assistant', content: [{ type: 'text', text: '[]' }] },
      { role: 'user', content: [{ type: 'text', text: 'Fix it' }] }
    ])
  })
})

describe('Anthropic provider errors', () => {
  const anthropic = (fetch: typeof globalThis.fetch) =>
    createProvider({ kind: 'anthropic', model: 'claude-opus-5-5' }, 'sk-secret', { fetch })
  const apiError = (status: number, message: string) => ({
    status,
    json: { type: 'error', error: { type: 'x', message } }
  })

  it('reports a rejected key as not worth retrying, without leaking the key', async () => {
    const { fetch } = fakeFetch(apiError(401, 'invalid x-api-key'))
    const err = await anthropic(fetch).generate(request).catch((e) => e)
    expect(err).toMatchObject({ name: 'ProviderError', status: 401, retryable: false })
    expect(err.message).toContain('invalid x-api-key')
    expect(err.message).not.toContain('sk-secret')
  })

  it('reports rate limits and server errors as retryable', async () => {
    for (const status of [429, 529, 500]) {
      const { fetch } = fakeFetch(apiError(status, 'busy'))
      await expect(anthropic(fetch).generate(request)).rejects.toMatchObject({ status, retryable: true })
    }
  })

  it('reports a refusal as an error rather than empty text', async () => {
    const { fetch } = fakeFetch(anthropicReply('', { stop_reason: 'refusal', content: [] }))
    await expect(anthropic(fetch).generate(request)).rejects.toMatchObject({
      name: 'ProviderError',
      retryable: false,
      message: expect.stringContaining('refused')
    })
  })
})

describe('Gemini provider', () => {
  const gemini = (fetch: typeof globalThis.fetch) =>
    createProvider({ kind: 'gemini', model: 'gemini-4-hydrogen' }, 'g-key', { fetch })
  const reply = (...texts: string[]) => ({
    json: { candidates: [{ content: { role: 'model', parts: texts.map((text) => ({ text })) }, finishReason: 'STOP' }] }
  })

  it('sends inline frames, the system instruction and JSON mode, and joins the reply parts', async () => {
    const { fetch, requests } = fakeFetch(reply('[{"a"', ':1}]'))

    const result = await gemini(fetch).generate({ ...request, json: true })

    expect(result).toEqual({ text: '[{"a":1}]', model: 'gemini-4-hydrogen' })
    const req = requests[0]!
    expect(req.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent')
    expect(req.headers['x-goog-api-key']).toBe('g-key')
    expect(req.body.systemInstruction).toEqual({ parts: [{ text: 'You write cards.' }] })
    expect(req.body.generationConfig.responseMimeType).toBe('application/json')
    expect(req.body.contents).toEqual([
      {
        role: 'user',
        parts: [{ text: 'Describe' }, { text: 'Frame at 9:03 AM' }, { inlineData: { mimeType: 'image/jpeg', data: b64('a') } }]
      },
      { role: 'model', parts: [{ text: '[]' }] },
      { role: 'user', parts: [{ text: 'Fix it' }] }
    ])
  })

  it('maps HTTP errors and blocked replies to ProviderError', async () => {
    const http = (status: number) => ({ status, json: { error: { code: status, message: 'nope', status: 'X' } } })
    const bad = fakeFetch(http(400))
    await expect(gemini(bad.fetch).generate(request)).rejects.toMatchObject({
      status: 400, retryable: false, message: expect.stringContaining('nope')
    })
    for (const status of [429, 503]) {
      const { fetch } = fakeFetch(http(status))
      await expect(gemini(fetch).generate(request)).rejects.toMatchObject({ status, retryable: true })
    }
    const blocked = fakeFetch({ json: { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] } })
    await expect(gemini(blocked.fetch).generate(request)).rejects.toMatchObject({
      retryable: false, message: expect.stringContaining('SAFETY')
    })
  })
})

describe('OpenAI-compatible provider', () => {
  const reply = (content: string) => ({ json: { model: 'gpt-x', choices: [{ message: { role: 'assistant', content } }] } })

  it('sends a system message, data-URL images and the turns to <baseUrl>/chat/completions', async () => {
    const { fetch, requests } = fakeFetch(reply('[]'))
    const provider = createProvider({ kind: 'openai', model: 'gpt-x', baseUrl: 'https://api.example.com/v1/' }, 'o-key', { fetch })

    expect(await provider.generate(request)).toEqual({ text: '[]', model: 'gpt-x' })
    const req = requests[0]!
    expect(req.url).toBe('https://api.example.com/v1/chat/completions')
    expect(req.headers.authorization).toBe('Bearer o-key')
    expect(req.body.model).toBe('gpt-x')
    expect(req.body.messages).toEqual([
      { role: 'system', content: 'You write cards.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'text', text: 'Frame at 9:03 AM' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64('a')}` } }
        ]
      },
      { role: 'assistant', content: '[]' },
      { role: 'user', content: [{ type: 'text', text: 'Fix it' }] }
    ])
  })

  it('needs no key for a local server but refuses a remote one without a key', async () => {
    const local = fakeFetch(reply('ok'))
    const ollama = createProvider({ kind: 'openai', model: 'llava', baseUrl: 'http://localhost:11434/v1' }, undefined, { fetch: local.fetch })
    await ollama.generate(request)
    expect(local.requests[0]!.headers.authorization).toBeUndefined()

    const remote = fakeFetch()
    const openai = createProvider({ kind: 'openai', model: 'gpt-x' }, '', { fetch: remote.fetch })
    await expect(openai.generate(request)).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('API key') })
    expect(remote.requests).toHaveLength(0)
  })

  it('maps HTTP errors to ProviderError', async () => {
    const { fetch } = fakeFetch({ status: 429, json: { error: { message: 'slow down' } } })
    const provider = createProvider({ kind: 'openai', model: 'gpt-x' }, 'o-key', { fetch })
    await expect(provider.generate(request)).rejects.toMatchObject({ status: 429, retryable: true, message: expect.stringContaining('slow down') })
  })
})
