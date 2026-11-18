import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cliInvocation, manualConfigSnippet, mcpRegistration, posixArgv, shQuote, terminalInstallCommand, terminalRemoveCommand, terminalTarget, wrapperScript } from './invocation'

const flatpak = cliInvocation({ flatpakId: 'io.github.kokuwaio.DayflowElectron', execPath: '/app/x', script: '/app/y' })
const plain = cliInvocation({ execPath: '/opt/Day flow/dayflow-electron', script: "/opt/Day flow/resources/app.asar/out/main/cli.js" })

describe('CLI invocation', () => {
  it('goes through flatpak run inside the Flatpak, else through Electron in Node mode', () => {
    expect(flatpak).toEqual({ command: 'flatpak', args: ['run', '--command=dayflow-electron-cli', 'io.github.kokuwaio.DayflowElectron'], env: {} })
    // No `env` program: Windows has none, so the variable travels separately.
    expect(plain).toEqual({
      command: '/opt/Day flow/dayflow-electron',
      args: ['/opt/Day flow/resources/app.asar/out/main/cli.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
  })

  it('puts the environment in front through env only for POSIX shell lines', () => {
    expect(posixArgv(plain)).toEqual(['env', 'ELECTRON_RUN_AS_NODE=1', '/opt/Day flow/dayflow-electron', '/opt/Day flow/resources/app.asar/out/main/cli.js'])
    expect(posixArgv(flatpak)).toEqual(['flatpak', 'run', '--command=dayflow-electron-cli', 'io.github.kokuwaio.DayflowElectron'])
  })

  it('passes the environment with -e to Claude Code and --env to Codex', () => {
    const server = ['--', '/opt/Day flow/dayflow-electron', '/opt/Day flow/resources/app.asar/out/main/cli.js', 'mcp']
    // The name comes before -e: the option takes several values and would swallow it.
    expect(mcpRegistration('claude', plain).add).toEqual(['mcp', 'add', '--scope', 'user', 'dayflow-electron', '-e', 'ELECTRON_RUN_AS_NODE=1', ...server])
    expect(mcpRegistration('codex', plain).add).toEqual(['mcp', 'add', 'dayflow-electron', '--env', 'ELECTRON_RUN_AS_NODE=1', ...server])
  })

  it('registers the "dayflow-electron" server in user scope for Claude Code and with codex mcp add', () => {
    expect(mcpRegistration('claude', flatpak).add).toEqual([
      'mcp', 'add', '--scope', 'user', 'dayflow-electron', '--', 'flatpak', 'run', '--command=dayflow-electron-cli', 'io.github.kokuwaio.DayflowElectron', 'mcp'
    ])
    expect(mcpRegistration('codex', flatpak)).toEqual({
      add: ['mcp', 'add', 'dayflow-electron', '--', 'flatpak', 'run', '--command=dayflow-electron-cli', 'io.github.kokuwaio.DayflowElectron', 'mcp'],
      remove: ['mcp', 'remove', 'dayflow-electron'],
      get: ['mcp', 'get', 'dayflow-electron', '--json']
    })
  })

  it('gives other clients a config snippet', () => {
    expect(JSON.parse(`{${manualConfigSnippet(flatpak)}}`)).toEqual({
      'dayflow-electron': { command: 'flatpak', args: ['run', '--command=dayflow-electron-cli', 'io.github.kokuwaio.DayflowElectron', 'mcp'] }
    })
    expect(JSON.parse(`{${manualConfigSnippet(plain)}}`)).toEqual({
      'dayflow-electron': {
        command: '/opt/Day flow/dayflow-electron',
        args: ['/opt/Day flow/resources/app.asar/out/main/cli.js', 'mcp'],
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }
    })
  })

  it('quotes for POSIX shells only where needed', () => {
    expect(shQuote('--command=dayflow-electron-cli')).toBe('--command=dayflow-electron-cli')
    expect(shQuote("it's here")).toBe(`'it'\\''s here'`)
  })

  it('writes a wrapper script that passes the arguments on', () => {
    expect(wrapperScript(flatpak)).toBe(
      '#!/bin/sh\n# dayflow-electron CLI wrapper\nexec flatpak run --command=dayflow-electron-cli io.github.kokuwaio.DayflowElectron "$@"\n'
    )
  })

  // The terminal command is a POSIX shell script for ~/.local/bin; Windows has neither.
  it.skipIf(process.platform === 'win32')('builds a terminal install command that writes exactly that wrapper', () => {
    const home = mkdtempSync(join(tmpdir(), 'dayflow-home-'))
    try {
      execFileSync('sh', ['-c', terminalInstallCommand(plain)], { env: { ...process.env, HOME: home } })
      expect(readFileSync(join(home, '.local/bin/dayflow-electron'), 'utf8')).toBe(wrapperScript(plain))
      const out = execFileSync('sh', ['-c', `sed -n 3p ${join(home, '.local/bin/dayflow-electron')}`]).toString()
      expect(out).toBe(`exec env ELECTRON_RUN_AS_NODE=1 '/opt/Day flow/dayflow-electron' '/opt/Day flow/resources/app.asar/out/main/cli.js' "$@"\n`)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('puts the macOS command in /usr/local/bin, on every shell\'s PATH, through sudo', () => {
    expect(terminalTarget('darwin')).toEqual({ dir: '/usr/local/bin', sudo: true })
    expect(terminalTarget('linux')).toEqual({ dir: '~/.local/bin', sudo: false })
    expect(terminalInstallCommand(plain, 'darwin')).toMatch(/^sudo mkdir -p \/usr\/local\/bin && /)
    expect(terminalRemoveCommand('darwin')).toBe('sudo rm -f /usr/local/bin/dayflow-electron')
    expect(terminalRemoveCommand('linux')).toBe('rm -f ~/.local/bin/dayflow-electron')
  })

  it.skipIf(process.platform === 'win32')('runs the macOS install and remove commands as written (sudo and the folder stubbed)', () => {
    const root = mkdtempSync(join(tmpdir(), 'dayflow-mac-'))
    try {
      const fakeBin = join(root, 'fake-bin')
      execFileSync('sh', ['-c', `mkdir -p '${fakeBin}' && printf '#!/bin/sh\\nexec "$@"\\n' > '${fakeBin}/sudo' && chmod +x '${fakeBin}/sudo'`])
      const target = join(root, 'usr-local-bin')
      const run = (command: string) =>
        execFileSync('sh', ['-c', command.split('/usr/local/bin').join(target)], { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } })
      run(terminalInstallCommand(plain, 'darwin'))
      expect(readFileSync(join(target, 'dayflow-electron'), 'utf8')).toBe(wrapperScript(plain))
      run(terminalRemoveCommand('darwin'))
      expect(() => readFileSync(join(target, 'dayflow-electron'))).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
