import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cliInvocation, manualConfigSnippet, mcpRegistration, posixArgv, shQuote, terminalInstallCommand, wrapperScript } from './invocation'

const flatpak = cliInvocation({ flatpakId: 'io.github.kokuwaio.DayflowElectron', execPath: '/app/x', script: '/app/y' })
const plain = cliInvocation({ execPath: '/opt/Day flow/dayflow-electron', script: "/opt/Day flow/resources/app.asar/out/main/cli.js" })

describe('CLI invocation', () => {
  it('goes through flatpak run inside the Flatpak, else through Electron in Node mode', () => {
    expect(flatpak).toEqual({ command: 'flatpak', args: ['run', '--command=dayflow-cli', 'io.github.kokuwaio.DayflowElectron'], env: {} })
    // No `env` program: Windows has none, so the variable travels separately.
    expect(plain).toEqual({
      command: '/opt/Day flow/dayflow-electron',
      args: ['/opt/Day flow/resources/app.asar/out/main/cli.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
  })

  it('puts the environment in front through env only for POSIX shell lines', () => {
    expect(posixArgv(plain)).toEqual(['env', 'ELECTRON_RUN_AS_NODE=1', '/opt/Day flow/dayflow-electron', '/opt/Day flow/resources/app.asar/out/main/cli.js'])
    expect(posixArgv(flatpak)).toEqual(['flatpak', 'run', '--command=dayflow-cli', 'io.github.kokuwaio.DayflowElectron'])
  })

  it('passes the environment with -e to Claude Code and --env to Codex', () => {
    const server = ['--', '/opt/Day flow/dayflow-electron', '/opt/Day flow/resources/app.asar/out/main/cli.js', 'mcp']
    // The name comes before -e: the option takes several values and would swallow it.
    expect(mcpRegistration('claude', plain).add).toEqual(['mcp', 'add', '--scope', 'user', 'dayflow', '-e', 'ELECTRON_RUN_AS_NODE=1', ...server])
    expect(mcpRegistration('codex', plain).add).toEqual(['mcp', 'add', 'dayflow', '--env', 'ELECTRON_RUN_AS_NODE=1', ...server])
  })

  it('registers the "dayflow" server in user scope for Claude Code and with codex mcp add', () => {
    expect(mcpRegistration('claude', flatpak).add).toEqual([
      'mcp', 'add', '--scope', 'user', 'dayflow', '--', 'flatpak', 'run', '--command=dayflow-cli', 'io.github.kokuwaio.DayflowElectron', 'mcp'
    ])
    expect(mcpRegistration('codex', flatpak)).toEqual({
      add: ['mcp', 'add', 'dayflow', '--', 'flatpak', 'run', '--command=dayflow-cli', 'io.github.kokuwaio.DayflowElectron', 'mcp'],
      remove: ['mcp', 'remove', 'dayflow'],
      get: ['mcp', 'get', 'dayflow', '--json']
    })
  })

  it('gives other clients a config snippet', () => {
    expect(JSON.parse(`{${manualConfigSnippet(flatpak)}}`)).toEqual({
      dayflow: { command: 'flatpak', args: ['run', '--command=dayflow-cli', 'io.github.kokuwaio.DayflowElectron', 'mcp'] }
    })
    expect(JSON.parse(`{${manualConfigSnippet(plain)}}`)).toEqual({
      dayflow: {
        command: '/opt/Day flow/dayflow-electron',
        args: ['/opt/Day flow/resources/app.asar/out/main/cli.js', 'mcp'],
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }
    })
  })

  it('quotes for POSIX shells only where needed', () => {
    expect(shQuote('--command=dayflow-cli')).toBe('--command=dayflow-cli')
    expect(shQuote("it's here")).toBe(`'it'\\''s here'`)
  })

  it('writes a wrapper script that passes the arguments on', () => {
    expect(wrapperScript(flatpak)).toBe(
      '#!/bin/sh\n# dayflow-electron CLI wrapper\nexec flatpak run --command=dayflow-cli io.github.kokuwaio.DayflowElectron "$@"\n'
    )
  })

  // The terminal command is a POSIX shell script for ~/.local/bin; Windows has neither.
  it.skipIf(process.platform === 'win32')('builds a terminal install command that writes exactly that wrapper', () => {
    const home = mkdtempSync(join(tmpdir(), 'dayflow-home-'))
    try {
      execFileSync('sh', ['-c', terminalInstallCommand(plain)], { env: { ...process.env, HOME: home } })
      expect(readFileSync(join(home, '.local/bin/dayflow'), 'utf8')).toBe(wrapperScript(plain))
      const out = execFileSync('sh', ['-c', `sed -n 3p ${join(home, '.local/bin/dayflow')}`]).toString()
      expect(out).toBe(`exec env ELECTRON_RUN_AS_NODE=1 '/opt/Day flow/dayflow-electron' '/opt/Day flow/resources/app.asar/out/main/cli.js' "$@"\n`)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
