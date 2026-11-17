// The write bridge between the `dayflow` CLI (and its MCP server) and the
// running app, after upstream Dayflow (Core/AgentAccess/AgentBridgeServer.swift,
// tools/dayflow-cli/Sources/dayflow/Bridge.swift).
//
// Transport: a Unix socket `agent.sock` (mode 0600) in the data folder that
// the app opens only while "Allow edits" is on. One JSON request line in, one
// JSON response line out, then the connection closes:
//   {"protocol_version":1,"operation":"category_add","arguments":{...}}
//   → {"ok":true,"data":{...}} or {"ok":false,"error":{"code":"...","message":"..."}}

import type { Socket } from 'node:net'

export const BRIDGE_PROTOCOL_VERSION = 1
/** Upstream caps each line at 1 MB. */
export const MAX_LINE_BYTES = 1_048_576
export const AGENT_SOCKET = 'agent.sock'
export const WRITE_LOG = 'agent-writes.log'

export const WRITE_OPERATIONS = ['category_add', 'category_update', 'category_remove', 'activity_update', 'activity_delete', 'goal_set'] as const
export type WriteOperation = (typeof WRITE_OPERATIONS)[number]

export type BridgeResponse = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }

export class LineTooLong extends Error {}

/** Reads up to the first newline (or the end of the stream), at most `max` bytes. */
export function readLine(socket: Socket, max = MAX_LINE_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const done = (err: Error | null, line?: string) => {
      socket.off('data', onData)
      socket.off('end', onEnd)
      socket.off('error', onError)
      if (err) reject(err)
      else resolve(line ?? '')
    }
    const onData = (chunk: Buffer) => {
      const nl = chunk.indexOf(0x0a)
      const part = nl >= 0 ? chunk.subarray(0, nl) : chunk
      size += part.length
      if (size > max) return done(new LineTooLong('Line too long.'))
      chunks.push(part)
      if (nl >= 0) done(null, Buffer.concat(chunks).toString('utf8'))
    }
    const onEnd = () => done(null, Buffer.concat(chunks).toString('utf8'))
    const onError = (err: Error) => done(err)
    socket.on('data', onData)
    socket.on('end', onEnd)
    socket.on('error', onError)
  })
}
