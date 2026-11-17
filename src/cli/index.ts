// Entry point of the `dayflow` CLI and MCP server. Electron runs it in Node
// mode (ELECTRON_RUN_AS_NODE=1), so it may use Node only, never the
// `electron` module. In the Flatpak: `flatpak run --command=dayflow-cli
// io.github.kokuwaio.DayflowElectron <args>`.

import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { cliInvocation } from '../main/agent/invocation'
import { sendToApp } from './bridge-client'
import { terminalCommand } from './link'
import { createMcpServer } from './mcp'
import { runCli } from './run'
import { agentPaths, fileSource } from './source'
import { errorMessage } from '../shared/errors'

const paths = agentPaths(process.env, process.platform, homedir())
const source = fileSource(paths)
const send = (operation: string, args: Record<string, unknown>) => sendToApp(paths.socket, operation, args)

/** Reads JSON-RPC lines from stdin and answers each on stdout, in order, until stdin closes. */
async function serveMcp(): Promise<void> {
  const server = createMcpServer({ source, send })
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    const response = await server.handleLine(line)
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
  }
}

const ask = (prompt: string) =>
  new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })

runCli(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  color: !!process.stdout.isTTY,
  interactive: !!process.stdin.isTTY,
  ask,
  source,
  send,
  terminalCommand: async (remove) =>
    terminalCommand(remove, {
      inFlatpak: !!process.env.FLATPAK_ID,
      home: homedir(),
      path: process.env.PATH ?? '',
      invocation: cliInvocation({ flatpakId: process.env.FLATPAK_ID, execPath: process.execPath, script: process.argv[1] ?? '' })
    }),
  mcp: serveMcp
}).then(
  (code) => {
    // Let stdout drain instead of exiting mid-write.
    process.exitCode = code
  },
  (err: unknown) => {
    process.stderr.write(`${errorMessage(err)}\n`)
    process.exitCode = 1
  }
)
