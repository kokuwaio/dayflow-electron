import { describe, expect, it } from 'vitest'
import { loginArgs, parseSignedIn, signInUrl, signInVerdict, statusArgs } from './sign-in'

describe('the CLIs\' own sign-in commands (upstream ProviderSignIn)', () => {
  it('runs `claude auth login` and `codex login`, and asks their status the same way', () => {
    expect(loginArgs('claude')).toEqual(['auth', 'login'])
    expect(loginArgs('codex')).toEqual(['login'])
    expect(statusArgs('claude')).toEqual(['auth', 'status'])
    expect(statusArgs('codex')).toEqual(['login', 'status'])
  })
})

describe('reading whether a CLI is signed in', () => {
  it('reads Claude Code\'s JSON', () => {
    expect(parseSignedIn('claude', { stdout: '{"loggedIn": true, "authMethod": "claude.ai"}', stderr: '', code: 0 })).toBe(true)
    expect(parseSignedIn('claude', { stdout: '{"loggedIn": false}', stderr: '', code: 1 })).toBe(false)
  })

  it('reads Codex\'s words', () => {
    expect(parseSignedIn('codex', { stdout: 'Logged in using ChatGPT', stderr: '', code: 0 })).toBe(true)
    expect(parseSignedIn('codex', { stdout: '', stderr: 'Not logged in', code: 1 })).toBe(false)
  })

  it('cannot tell from an old version or a shell banner', () => {
    expect(parseSignedIn('claude', { stdout: 'error: unknown command auth', stderr: '', code: 1 })).toBeNull()
    expect(parseSignedIn('codex', { stdout: 'Welcome back!', stderr: '', code: 0 })).toBeNull()
  })
})

describe('when a sign-in is done', () => {
  const base = { signedInBefore: false, signedIn: null as boolean | null, ended: false, exitCode: null as number | null, timedOut: false }

  it('is done once the CLI says it is signed in, while the login command may still run', () => {
    expect(signInVerdict({ ...base, signedIn: true })).toBe('done')
  })

  it('keeps waiting while the user is in the browser', () => {
    expect(signInVerdict({ ...base, signedIn: false })).toBe('waiting')
  })

  it('trusts only a clean exit when the login looked fine before (a token that cannot be refreshed still reads as signed in)', () => {
    expect(signInVerdict({ ...base, signedInBefore: true, signedIn: true })).toBe('waiting')
    expect(signInVerdict({ ...base, signedInBefore: true, signedIn: true, ended: true, exitCode: 0 })).toBe('done')
  })

  it('takes an old CLI\'s word by its exit code', () => {
    expect(signInVerdict({ ...base, ended: true, exitCode: 0 })).toBe('done')
    expect(signInVerdict({ ...base, ended: true, exitCode: 1 })).toBe('failed')
    expect(signInVerdict({ ...base, signedIn: false, ended: true, exitCode: 0 })).toBe('failed')
  })

  it('gives up after the time limit', () => {
    expect(signInVerdict({ ...base, signedIn: false, timedOut: true })).toBe('failed')
  })
})

describe('the sign-in page', () => {
  it('finds the address the CLI prints for when the browser does not open', () => {
    expect(signInUrl('Opening browser to sign in…\nIf the browser didn\'t open, visit: https://claude.ai/oauth/authorize?code=true&client_id=abc\n')).toBe(
      'https://claude.ai/oauth/authorize?code=true&client_id=abc'
    )
    expect(signInUrl('Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&x=1')).toBe(
      'https://auth.openai.com/oauth/authorize?response_type=code&x=1'
    )
    expect(signInUrl('nothing here')).toBeNull()
  })
})
