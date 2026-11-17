// Client side of the write bridge (upstream tools/dayflow-cli/Sources/dayflow/
// Bridge.swift); the protocol is described in src/main/agent/protocol.ts.

import { connect } from 'node:net'
import { BRIDGE_PROTOCOL_VERSION, readLine } from '../main/agent/protocol'
import { BridgeError } from './run'

const NOT_RUNNING = "Dayflow isn't running. Reads work offline; edits need the app open."

/** Sends one operation to the app and returns its `data` payload. */
export function sendToApp(socketPath: string, operation: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    let settled = false
    const finish = (err: BridgeError | null, data?: Record<string, unknown>) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (err) reject(err)
      else resolve(data ?? {})
    }
    socket.setTimeout(timeoutMs, () => finish(new BridgeError('timeout', 'Dayflow did not answer in time.')))
    socket.on('error', (err: NodeJS.ErrnoException) =>
      finish(
        err.code === 'ENOENT' || err.code === 'ECONNREFUSED'
          ? new BridgeError('app_not_running', NOT_RUNNING)
          : // Unix socket paths are limited to about 107 bytes.
            err.code === 'EINVAL' || err.code === 'ENAMETOOLONG'
            ? new BridgeError('socket_error', `The data folder path is too long for a Unix socket: ${socketPath}`)
            : new BridgeError('socket_error', `Could not reach Dayflow: ${err.message}`)
      )
    )
    socket.on('connect', () => {
      readLine(socket).then(
        (line) => {
          let response: unknown
          try {
            response = JSON.parse(line)
          } catch {
            return finish(new BridgeError('protocol_error', 'Unreadable response from Dayflow.'))
          }
          const r = (response ?? {}) as { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } }
          if (r.ok === true) {
            const data = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : {}
            return finish(null, data)
          }
          finish(
            new BridgeError(
              typeof r.error?.code === 'string' ? r.error.code : 'unknown',
              typeof r.error?.message === 'string' ? r.error.message : 'Dayflow reported an error.'
            )
          )
        },
        () => finish(new BridgeError('protocol_error', 'Response too large.'))
      )
      socket.write(`${JSON.stringify({ protocol_version: BRIDGE_PROTOCOL_VERSION, operation, arguments: args })}\n`)
    })
  })
}
