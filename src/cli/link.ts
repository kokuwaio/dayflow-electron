// `dayflow-electron link` / `unlink`: the terminal command. Upstream links a binary
// into /usr/local/bin with sudo. Here the CLI is a script run by Electron, so
// a small wrapper goes into ~/.local/bin on Linux (no sudo) and into
// /usr/local/bin on macOS, which has no user folder on PATH (sudo when needed). Inside the Flatpak the
// home folder is out of reach, so the command to run is printed instead.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { TERMINAL_COMMAND_UNSUPPORTED } from '../shared/agent-clients'
import { type Invocation, WRAPPER_MARKER, posixArgv, shellLine, terminalInstallCommand, terminalRemoveCommand, terminalTarget, wrapperScript } from '../main/agent/invocation'

export interface LinkEnv {
  platform: NodeJS.Platform
  inFlatpak: boolean
  home: string
  path: string
  invocation: Invocation
  /** The folder for the command; terminalTarget's by default (tests point it elsewhere). */
  binDir?: string
}

/** The error codes of a folder the user may not write to. */
const needsAdmin = (err: unknown) => ['EACCES', 'EPERM'].includes((err as { code?: string } | null)?.code ?? '')

export function terminalCommand(remove: boolean, env: LinkEnv): string[] {
  // The wrapper is a shell script that neither cmd.exe nor PowerShell runs.
  if (env.platform === 'win32') throw new Error(TERMINAL_COMMAND_UNSUPPORTED)
  const { dir, sudo } = terminalTarget(env.platform)
  const target = join(env.binDir ?? dir.replace(/^~(?=\/)/, env.home), 'dayflow-electron')
  // The command to run by hand, when the app may not write there itself.
  const byHand = (reason: string) =>
    remove
      ? [`${reason} Run this in a terminal to remove the command:`, '', `  ${terminalRemoveCommand(env.platform)}`]
      : [`${reason} Run this in a terminal to add \`dayflow-electron\` to ${dir}:`, '', `  ${terminalInstallCommand(env.invocation, env.platform)}`]
  if (env.inFlatpak) return byHand('The Flatpak cannot change your home folder.')
  try {
    const ours = existsSync(target) && readFileSync(target, 'utf8').includes(WRAPPER_MARKER)
    if (remove) {
      if (!ours) throw new Error(`Nothing to remove — ${target} is not a dayflow-electron command.`)
      unlinkSync(target)
      return [`Removed ${target}`]
    }
    if (existsSync(target) && !ours) throw new Error(`${target} exists and was not written by Dayflow Electron, so it was left alone.`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, wrapperScript(env.invocation), { mode: 0o755 })
  } catch (err) {
    // /usr/local/bin on macOS belongs to root unless Homebrew took it over.
    if (sudo && needsAdmin(err)) return byHand(`${dir} needs administrator rights.`)
    throw err
  }
  const lines = [
    `This adds a \`dayflow-electron\` command to ${dir} so you can run it from anywhere:`,
    '',
    `  ${target} → ${shellLine(posixArgv(env.invocation))}`,
    '',
    'Nothing is downloaded and your shell configuration is not touched.',
    '✓ Installed. Try: dayflow-electron timeline'
  ]
  if (!env.path.split(':').includes(dirname(target))) lines.push(`  (${dirname(target)} is not on your PATH yet; add it in your shell profile.)`)
  return lines
}
