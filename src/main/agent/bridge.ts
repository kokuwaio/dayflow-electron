// The app side of the agent write channel, after upstream Dayflow
// (Core/AgentAccess/AgentBridgeServer.swift). The CLI and its MCP server
// read the database directly; writes come here, so they run through the same
// store and settings code as the window and the window refreshes. The socket
// only exists while "Allow edits" is on; file permissions (0600) are the
// access control, and every request re-checks the setting.

import { appendFileSync, chmodSync, lstatSync, unlinkSync } from 'node:fs'
import { type Server, type Socket, createServer } from 'node:net'
import { BRIDGE_PROTOCOL_VERSION, type BridgeResponse, WRITE_OPERATIONS, type WriteOperation, readLine } from './protocol'
import { AgentWriteError } from './writes'

export interface BridgeDeps {
  editsEnabled(): boolean
  handle(operation: WriteOperation, args: Record<string, unknown>): Promise<Record<string, unknown>>
  /** Appends one NDJSON line to agent-writes.log. */
  log(line: string): void
  now(): Date
}

const failure = (code: string, message: string): BridgeResponse => ({ ok: false, error: { code, message } })

/** Answers one request line. */
export async function handleBridgeLine(line: string, deps: BridgeDeps): Promise<BridgeResponse> {
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    return failure('protocol_error', 'Unreadable request.')
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return failure('protocol_error', 'Unreadable request.')
  const m = message as Record<string, unknown>
  if (m.protocol_version !== BRIDGE_PROTOCOL_VERSION) return failure('protocol_mismatch', 'Update Dayflow. The CLI and app disagree on protocol.')
  // Authoritative permission check, independent of whether the CLI checked.
  if (!deps.editsEnabled()) return failure('edits_disabled', 'Editing is off in Dayflow → Settings → MCP / CLI.')
  const operation = m.operation
  if (typeof operation !== 'string' || !(WRITE_OPERATIONS as readonly string[]).includes(operation)) {
    return failure('unknown_operation', `Unknown operation: ${String(operation)}`)
  }
  const args = m.arguments ?? {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) return failure('invalid_argument', 'arguments must be an object.')
  try {
    const data = await deps.handle(operation as WriteOperation, args as Record<string, unknown>)
    // Every write is recorded, so there is something to inspect if an agent does
    // something unexpected. Arguments only, never returned data.
    deps.log(`${JSON.stringify({ at: deps.now().toISOString(), operation, arguments: args })}\n`)
    return { ok: true, data }
  } catch (err) {
    if (err instanceof AgentWriteError) return failure(err.code, err.message)
    return failure('internal_error', err instanceof Error ? err.message : String(err))
  }
}

export interface BridgeServerOptions {
  socketPath: string
  logFile: string
  editsEnabled(): boolean
  handle(operation: WriteOperation, args: Record<string, unknown>): Promise<Record<string, unknown>>
}

/** The Unix socket the app listens on while edits are on. */
export class BridgeServer {
  private server: Server | null = null
  /** Writes run one after another, so read-modify-write of the settings cannot interleave. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly o: BridgeServerOptions) {}

  get listening(): boolean {
    return this.server !== null
  }

  async start(): Promise<void> {
    if (this.server) return
    removeStaleSocket(this.o.socketPath)
    const server = createServer((socket) => this.serve(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // Owner-only from the first moment; chmod below in case the umask was ignored.
      const umask = process.umask(0o177)
      try {
        server.listen(this.o.socketPath, () => resolve())
      } finally {
        process.umask(umask)
      }
    })
    chmodSync(this.o.socketPath, 0o600)
    this.server = server
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
    try {
      unlinkSync(this.o.socketPath)
    } catch {
      // already gone
    }
  }

  private serve(socket: Socket): void {
    socket.setTimeout(10_000, () => socket.destroy())
    socket.on('error', () => {})
    readLine(socket).then(
      async (line) => {
        // A bare connect (the CLI checking whether the app runs) sends nothing.
        if (!line.trim()) return void socket.end()
        const deps: BridgeDeps = {
          editsEnabled: this.o.editsEnabled,
          handle: this.o.handle,
          log: (entry) => appendFileSync(this.o.logFile, entry, { mode: 0o600 }),
          now: () => new Date()
        }
        const run = this.queue.then(() => handleBridgeLine(line, deps))
        this.queue = run.catch(() => {})
        const response = await run.catch((err: unknown) => failure('internal_error', String(err)))
        socket.end(`${JSON.stringify(response)}\n`)
      },
      () => socket.destroy()
    )
  }
}

/** A socket file left by a crash blocks listen(); anything else at that path is left alone. */
function removeStaleSocket(path: string): void {
  try {
    if (lstatSync(path).isSocket()) unlinkSync(path)
  } catch {
    // nothing there
  }
}
