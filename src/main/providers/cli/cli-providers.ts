// Claude Code (`claude -p`) and Codex (`codex exec`) as providers, on the
// user's own subscription. Invocations follow upstream Dayflow
// (Core/AI/ChatCLIProcessRunner.swift, ClaudeProvider+Timeline.swift,
// CodexProvider+Timeline.swift). On Linux they run on the host, through the
// login shell so PATH entries from mise, nvm or npm prefixes apply.

import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type GenerateRequest, type GenerateResult, type Part, type Provider, ProviderError } from '../types'
import { type CliLocation, type CliName, type ProcessRunner, findCli, hostAccess, hostCommand } from './host'

export interface CliEnv {
  inFlatpak: boolean
  home: string
  /** A directory the host can read at the same path (for codex image files). */
  scratchDir: string
  /** Flatpak app ID, for the opt-in command shown when host access is missing. */
  appId: string
  configuredPath?: string
}

const TIMEOUT_MS = 300_000

const CLI_INFO: Record<CliName, { login: string; install: string; label: string }> = {
  claude: {
    label: 'Claude Code',
    login: 'run "claude" in a terminal and type /login',
    install: 'npm install -g @anthropic-ai/claude-code'
  },
  codex: { label: 'Codex', login: 'run "codex login" in a terminal', install: 'npm install -g @openai/codex' }
}

const LOGIN = ['please run /login', 'run /login', 'not logged in', 'oauth', 'token has been revoked', 'could not be refreshed', 'log out and sign in']
const LIMIT = ['hit your usage limit', 'hit your limit', 'usage limit', 'session limit', 'weekly limit', 'spend limit', "you've hit your", 'you’ve hit your']
const MISSING = ['cli not found', 'enoent']
const OUTDATED = ['requires a newer version of codex', 'newer version of codex']
const MISCONFIGURED = ['is not supported when using codex with a chatgpt account', 'is not found for api version', 'not_found_error']
const NO_CREDITS = ['prepayment credits', 'insufficient balance', 'spending cap', 'payment required', 'out of credits', 'credit balance']
const TRANSIENT = ['timed out', 'econnreset', 'enotfound', 'connection refused', 'network', 'stream disconnected', '502', '503', '529', 'overloaded', 'service unavailable', 'too many requests', 'internal error']

/** Maps a CLI failure to a ProviderError, like upstream's TimelineFailureClassifier. */
export function classifyCliFailure(cli: CliName, message: string, exitCode: number | null): ProviderError {
  const text = message.toLowerCase()
  const fix = CLI_INFO[cli]
  const has = (patterns: string[]) => patterns.some((p) => text.includes(p))
  if (has(LOGIN)) return new ProviderError(`${fix.label} needs you to log in again: ${fix.login}. (${message.trim()})`, false)
  if (exitCode === 127 || has(MISSING)) return new ProviderError(`${fix.label} was not found. Install it with "${fix.install}".`, false)
  if (has(OUTDATED)) return new ProviderError(`${fix.label} is too old. Update it with "${fix.install}@latest".`, false)
  if (has(MISCONFIGURED)) return new ProviderError(`${fix.label} cannot use this model with your account; pick another in Settings. (${message.trim()})`, false)
  if (has(LIMIT)) return new ProviderError(`${fix.label} usage limit reached: ${message.trim()}`, false)
  if (has(NO_CREDITS)) return new ProviderError(`${fix.label} has no credits left: ${message.trim()}`, false)
  if (has(TRANSIENT)) return new ProviderError(`${fix.label} failed: ${message.trim()}`, true)
  return new ProviderError(`${fix.label} failed${exitCode !== null ? ` (exit ${exitCode})` : ''}: ${message.trim().slice(0, 1000)}`, true)
}

/**
 * One user message from a conversation: a correction (assistant reply plus
 * a new user turn) is folded in after the frames, as fresh CLI sessions keep
 * no history.
 */
function flatten(request: GenerateRequest): Part[] {
  const parts: Part[] = []
  for (const turn of request.turns) {
    if (turn.role === 'assistant') {
      const reply = turn.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
      parts.push({ type: 'text', text: `Your previous answer was:\n${reply}` })
    } else {
      parts.push(...turn.parts)
    }
  }
  return parts
}

/** Child environment outside the sandbox: never let a nested CLI think it runs inside Claude Code. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[key]
  return env
}

function cliRunner(cli: CliName, runner: ProcessRunner, env: CliEnv) {
  let location: CliLocation | null = null
  let hostChecked = false
  return async (args: string[], input?: string) => {
    if (!hostChecked) {
      const access = await hostAccess(runner, env.inFlatpak, env.appId)
      if (!access.ok) throw new ProviderError(access.reason, false)
      hostChecked = true
    }
    location ??= await findCli(runner, cli, env)
    if (!location) throw classifyCliFailure(cli, 'cli not found', 127)
    // Through the shell that found it, so the CLI finds node and friends on PATH.
    const [shell, flags] = location.shell
    const c = hostCommand(env.inFlatpak, shell, [flags, 'exec "$0" "$@"', location.path, ...args])
    const result = await runner.run(c.command, c.args, {
      timeoutMs: TIMEOUT_MS,
      ...(input !== undefined ? { input } : {}),
      ...(env.inFlatpak ? {} : { env: cleanEnv() })
    })
    if (result.timedOut) throw new ProviderError(`${CLI_INFO[cli].label} timed out after ${TIMEOUT_MS / 1000} s`, true)
    if (result.code === 127) location = null // look it up again next time
    return result
  }
}

const jsonLines = (stdout: string): Array<Record<string, any>> =>
  stdout.split('\n').flatMap((line) => {
    try {
      const v = JSON.parse(line)
      return v && typeof v === 'object' ? [v] : []
    } catch {
      return [] // shell banners, hook output
    }
  })

export function claudeCliProvider(model: string, runner: ProcessRunner, env: CliEnv): Provider {
  const run = cliRunner('claude', runner, env)
  return {
    kind: 'claude-cli',
    model,
    local: false,
    async generate(request: GenerateRequest): Promise<GenerateResult> {
      const content = flatten(request).map((p) =>
        p.type === 'text'
          ? { type: 'text', text: p.text }
          : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: Buffer.from(p.data).toString('base64') } }
      )
      const args = [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--disable-slash-commands',
        '--tools', '',
        '--strict-mcp-config',
        '--no-session-persistence',
        '--model', model,
        '--effort', 'medium',
        ...(request.system ? ['--system-prompt', request.system] : [])
      ]
      const input = `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`
      const r = await run(args, input)
      const result = jsonLines(r.stdout).filter((e) => e.type === 'result').at(-1)
      const text = typeof result?.result === 'string' ? result.result : ''
      if (r.code !== 0 || result?.is_error) {
        throw classifyCliFailure('claude', [text, r.stderr.trim()].filter(Boolean).join('\n') || `exit ${r.code}`, r.code)
      }
      if (!text) throw new ProviderError('Claude Code returned no result', true)
      return { text, model }
    }
  }
}

const MODEL_NOT_FOUND = /model_not_found|unsupported_model|unknown model|model not found|\bmodel\b[^\r\n]{0,160}(?:does not exist|not available|not supported|(?:do not|don't|not) have access)/i
/** Upstream's fallbacks when an account cannot use the newest model yet. */
const CODEX_FALLBACK: Record<string, string> = { 'gpt-6-luna': 'gpt-5.6-luna', 'gpt-6.1-sol': 'gpt-5.6-sol' }

export function codexCliProvider(model: string, runner: ProcessRunner, env: CliEnv): Provider {
  const run = cliRunner('codex', runner, env)
  // Upstream skips the user's config.toml (MCP servers, profiles) when this codex supports it.
  let ignoreUserConfig: boolean | null = null

  async function once(request: GenerateRequest, useModel: string): Promise<GenerateResult> {
    const dir = join(env.scratchDir, `codex-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const images: string[] = []
      const lines: string[] = request.system ? [request.system, ''] : []
      const parts = flatten(request)
      parts.forEach((p, i) => {
        if (p.type === 'image') {
          const file = join(dir, `frame_${String(images.length + 1).padStart(2, '0')}.jpg`)
          writeFileSync(file, p.data)
          images.push(file)
        } else if (parts[i + 1]?.type === 'image') {
          // Codex attaches images ahead of the text, so the labels say which is which.
          lines.push(`Image ${images.length + 1}: ${p.text}`)
        } else {
          lines.push(p.text)
        }
      })
      lines.push('', 'Do not run commands or use tools; everything you need is in this message.')
      ignoreUserConfig ??= (await run(['exec', '--help'])).stdout.includes('--ignore-user-config')
      const args = [
        'exec', '--skip-git-repo-check', '--json', '-m', useModel,
        ...(ignoreUserConfig ? ['--ignore-user-config'] : []),
        '-c', 'model_reasoning_effort=high',
        '-c', 'rmcp_client=false',
        '-c', 'web_search=disabled',
        ...images.flatMap((f) => ['--image', f]),
        '--', lines.join('\n')
      ]
      const r = await run(args)
      const events = jsonLines(r.stdout)
      const errors = events.flatMap((e) =>
        e.type === 'error' && typeof e.message === 'string' ? [e.message] : e.type === 'turn.failed' && e.error?.message ? [String(e.error.message)] : []
      )
      const text = events
        .filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message' && typeof e.item.text === 'string')
        .at(-1)?.item.text as string | undefined
      if (r.code !== 0 || (!text && errors.length)) {
        throw classifyCliFailure('codex', [r.stderr.trim(), ...errors].filter(Boolean).join('\n') || `exit ${r.code}`, r.code)
      }
      if (!text) throw new ProviderError('Codex returned no answer', true)
      return { text, model: useModel }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  return {
    kind: 'codex-cli',
    model,
    local: false,
    async generate(request) {
      try {
        return await once(request, model)
      } catch (err) {
        const fallback = CODEX_FALLBACK[model]
        if (fallback && err instanceof Error && MODEL_NOT_FOUND.test(err.message)) return once(request, fallback)
        throw err
      }
    }
  }
}
