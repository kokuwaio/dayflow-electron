import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GenerateRequest } from '../types'
import { claudeCliProvider, codexCliProvider } from './cli-providers'
import type { ProcessRunner, RunOptions, RunResult } from './host'

interface Call {
  command: string
  args: string[]
  options: RunOptions | undefined
  imagesSeen: string[]
}

/** Answers discovery with a fixed path and the CLI call with `reply`; records the CLI call. */
function fakeCli(reply: Partial<RunResult>) {
  const calls: Call[] = []
  const runner: ProcessRunner = {
    async run(command, args, options) {
      const line = [command, ...args].join(' ')
      if (line.includes('command -v')) return { code: 0, stdout: '/home/me/bin/cli\n', stderr: '', timedOut: false }
      if (line.includes(' --host true') || line.endsWith('exec --help')) return { code: 0, stdout: 'Options: --ignore-user-config', stderr: '', timedOut: false }
      // Image files must exist while the CLI runs.
      const imagesSeen = args.flatMap((a, i) => (args[i - 1] === '--image' && existsSync(a) ? [readFileSync(a, 'utf8')] : []))
      calls.push({ command, args, options, imagesSeen })
      return { code: 0, stdout: '', stderr: '', timedOut: false, ...reply }
    }
  }
  return { runner, calls }
}

const img = (s: string) => ({ type: 'image' as const, mediaType: 'image/jpeg' as const, data: Buffer.from(s) })
const request: GenerateRequest = {
  system: 'You write cards.',
  turns: [{ role: 'user', parts: [{ type: 'text', text: 'Make cards' }, { type: 'text', text: 'Frame at 9:03 AM' }, img('A')] }],
  json: true
}
const withCorrection: GenerateRequest = {
  ...request,
  turns: [...request.turns, { role: 'assistant', parts: [{ type: 'text', text: '[]' }] }, { role: 'user', parts: [{ type: 'text', text: 'Fix the gap' }] }]
}

const claudeStream = (result: string, isError = false) =>
  [
    '{"type":"system","subtype":"hook_started","session_id":"s"}',
    'motd from a login shell',
    '{"type":"system","subtype":"init","session_id":"s"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}',
    JSON.stringify({ type: 'result', subtype: isError ? 'error' : 'success', is_error: isError, result, session_id: 's' })
  ].join('\n')

let scratch: string
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'dayflow-cli-'))
})
afterEach(() => rmSync(scratch, { recursive: true, force: true }))

const env = () => ({ inFlatpak: true, home: '/home/me', scratchDir: scratch, appId: 'io.example.App' })

describe('Claude Code provider', () => {
  it('runs claude on the host with images on stdin and returns the result event', async () => {
    const { runner, calls } = fakeCli({ stdout: claudeStream('[{"title":"x"}]') })
    const provider = claudeCliProvider('haiku', runner, env())

    expect(await provider.generate(request)).toEqual({ text: '[{"title":"x"}]', model: 'haiku' })

    const call = calls[0]!
    expect(call.command).toBe('flatpak-spawn')
    expect(call.args.slice(0, 5)).toEqual(['--host', 'sh', '-lc', 'exec "$0" "$@"', '/home/me/bin/cli'])
    const cli = call.args.slice(5)
    expect(cli).toEqual(expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']))
    expect(cli.join(' ')).toContain('--tools  --strict-mcp-config')
    expect(cli.join(' ')).toContain('--model haiku')
    expect(cli.join(' ')).toContain('--system-prompt You write cards.')
    expect(cli).not.toContain('--dangerously-skip-permissions')
    const message = JSON.parse(String(call.options?.input).trim())
    expect(message).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Make cards' },
          { type: 'text', text: 'Frame at 9:03 AM' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('A').toString('base64') } }
        ]
      }
    })
  })

  it('sends a correction as one message holding the frames, its previous answer and the issue', async () => {
    const { runner, calls } = fakeCli({ stdout: claudeStream('[]') })
    await claudeCliProvider('haiku', runner, env()).generate(withCorrection)
    const content = JSON.parse(String(calls[0]!.options?.input)).message.content
    expect(content.map((c: { type: string; text?: string }) => c.text ?? c.type)).toEqual([
      'Make cards',
      'Frame at 9:03 AM',
      'image',
      'Your previous answer was:\n[]',
      'Fix the gap'
    ])
  })
})

describe('Codex provider', () => {
  it('passes frames as image files and returns the last agent message', async () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"thinking out loud"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"[{\\"title\\":\\"y\\"}]"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'
    ].join('\n')
    const { runner, calls } = fakeCli({ stdout })

    expect(await codexCliProvider('gpt-6-luna', runner, env()).generate(request)).toEqual({ text: '[{"title":"y"}]', model: 'gpt-6-luna' })

    const cli = calls[0]!.args.slice(5)
    expect(cli.slice(0, 5)).toEqual(['exec', '--skip-git-repo-check', '--json', '-m', 'gpt-6-luna'])
    expect(cli).toEqual(expect.arrayContaining(['-c', 'model_reasoning_effort=high', '-c', 'web_search=disabled', '--ignore-user-config']))
    expect(calls[0]!.imagesSeen).toEqual(['A'])
    const prompt = cli[cli.length - 1]!
    expect(cli[cli.length - 2]).toBe('--')
    expect(prompt).toContain('You write cards.')
    expect(prompt).toContain('Make cards')
    expect(prompt).toContain('Image 1: Frame at 9:03 AM')
  })

  it('removes its image files after the call', async () => {
    const { runner } = fakeCli({ stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}' })
    await codexCliProvider('gpt-6-luna', runner, env()).generate(request)
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(scratch)).toEqual([])
  })
})

describe('CLI provider errors', () => {
  const failing = async (reply: Partial<RunResult>, kind: 'claude' | 'codex' = 'claude') => {
    const { runner } = fakeCli(reply)
    const provider = kind === 'claude' ? claudeCliProvider('haiku', runner, env()) : codexCliProvider('gpt-6-luna', runner, env())
    return provider.generate(request).catch((e) => e)
  }

  it('asks to log in again when the CLI is signed out, without retrying', async () => {
    const err = await failing({ code: 1, stdout: claudeStream('Invalid API key · Please run /login', true) })
    expect(err).toMatchObject({ name: 'ProviderError', retryable: false })
    expect(err.message).toMatch(/log in/i)
    expect(err.message).toContain('/login')
  })

  it('does not retry when the subscription limit is reached', async () => {
    const err = await failing({ code: 1, stdout: claudeStream("You've hit your limit · resets 9pm", true) })
    expect(err).toMatchObject({ retryable: false, message: expect.stringMatching(/limit/i) })
  })

  it('retries after a timeout', async () => {
    const err = await failing({ code: null, timedOut: true })
    expect(err).toMatchObject({ retryable: true, message: expect.stringMatching(/timed out/i) })
  })

  it('reports codex errors from its event stream', async () => {
    const err = await failing({ code: 1, stdout: '{"type":"turn.failed","error":{"message":"stream disconnected before completion"}}' }, 'codex')
    expect(err).toMatchObject({ retryable: true, message: expect.stringContaining('stream disconnected') })
  })

  it('names the Flatpak opt-in, not a missing install, when host access is denied', async () => {
    const runner: ProcessRunner = { async run() { return { code: 1, stdout: '', stderr: 'Portal call failed', timedOut: false } } }
    const err = await claudeCliProvider('haiku', runner, env()).generate(request).catch((e) => e)
    expect(err).toMatchObject({ retryable: false, message: expect.stringContaining('--talk-name=org.freedesktop.Flatpak') })
  })

  it('keeps the CLI\'s own message when the login shell also wrote to stderr', async () => {
    const err = await failing({ code: 1, stderr: 'mise: some warning', stdout: claudeStream('Please run /login', true) })
    expect(err.message).toContain('Please run /login')
  })

  it('explains how to install a CLI that is missing', async () => {
    const runner: ProcessRunner = {
      async run(command, args) {
        return { code: args.includes('true') ? 0 : 1, stdout: '', stderr: '', timedOut: false }
      }
    }
    const err = await claudeCliProvider('haiku', runner, env()).generate(request).catch((e) => e)
    expect(err).toMatchObject({ retryable: false, message: expect.stringContaining('npm install -g @anthropic-ai/claude-code') })
  })
})
