// `dayflow link` / `unlink`: the terminal command. Upstream links a binary
// into /usr/local/bin with sudo. Here the CLI is a script run by Electron, so
// a small wrapper goes into ~/.local/bin (no sudo). Inside the Flatpak the
// home folder is out of reach, so the command to run is printed instead.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type Invocation, TERMINAL_COMMAND_PATH, WRAPPER_MARKER, shellLine, terminalInstallCommand, wrapperScript } from '../main/agent/invocation'

export interface LinkEnv {
  inFlatpak: boolean
  home: string
  path: string
  invocation: Invocation
}

export function terminalCommand(remove: boolean, env: LinkEnv): string[] {
  const target = join(env.home, TERMINAL_COMMAND_PATH.replace(/^~\//, ''))
  if (env.inFlatpak) {
    return remove
      ? ['The Flatpak cannot change your home folder. Run this in a terminal to remove the command:', '', `  rm ${TERMINAL_COMMAND_PATH}`]
      : [
          'The Flatpak cannot change your home folder. Run this in a terminal to add `dayflow` to ~/.local/bin:',
          '',
          `  ${terminalInstallCommand(env.invocation)}`
        ]
  }
  const ours = existsSync(target) && readFileSync(target, 'utf8').includes(WRAPPER_MARKER)
  if (remove) {
    if (!ours) throw new Error(`Nothing to remove — ${target} is not a dayflow command.`)
    unlinkSync(target)
    return [`Removed ${target}`]
  }
  if (existsSync(target) && !ours) throw new Error(`${target} exists and was not written by Dayflow, so it was left alone.`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, wrapperScript(env.invocation), { mode: 0o755 })
  const lines = [
    'This adds a `dayflow` command to ~/.local/bin so you can run it from anywhere:',
    '',
    `  ${target} → ${shellLine([env.invocation.command, ...env.invocation.args])}`,
    '',
    'Nothing is downloaded and your shell configuration is not touched.',
    '✓ Installed. Try: dayflow timeline'
  ]
  if (!env.path.split(':').includes(dirname(target))) lines.push(`  (${dirname(target)} is not on your PATH yet; add it in your shell profile.)`)
  return lines
}
