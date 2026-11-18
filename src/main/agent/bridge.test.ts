import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeServer, agentSocketPath, handleBridgeLine } from './bridge'
import { AgentWriteError } from './writes'

let edits: boolean
let logged: string[]
let handled: Array<{ operation: string; args: unknown }>
let handler: (operation: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

beforeEach(() => {
  edits = true
  logged = []
  handled = []
  handler = async (operation, args) => {
    handled.push({ operation, args })
    return { message: 'Created Reading' }
  }
})

const deps = () => ({
  editsEnabled: () => edits,
  handle: (operation: string, args: Record<string, unknown>) => handler(operation, args),
  log: (line: string) => void logged.push(line),
  now: () => new Date('2026-11-17T08:00:00Z')
})

const POSIX = process.platform !== 'win32'
const request = (o: Record<string, unknown>) => JSON.stringify({ protocol_version: 1, ...o })

describe('bridge messages', () => {
  it('reports a write that happened as done even when its log line cannot be written', async () => {
    const failingLog = { ...deps(), log: () => { throw new Error('disk full') } }
    expect(await handleBridgeLine(request({ operation: 'category_add', arguments: { name: 'Reading' } }), failingLog)).toEqual({
      ok: true,
      data: { message: 'Created Reading' }
    })
  })

  it('runs a write, answers with its data and logs the arguments as one NDJSON line', async () => {
    const r = await handleBridgeLine(request({ operation: 'category_add', arguments: { name: 'Reading' } }), deps())
    expect(r).toEqual({ ok: true, data: { message: 'Created Reading' } })
    expect(handled).toEqual([{ operation: 'category_add', args: { name: 'Reading' } }])
    expect(logged).toEqual(['{"at":"2026-11-17T08:00:00.000Z","operation":"category_add","arguments":{"name":"Reading"}}\n'])
  })

  it('re-checks the edits switch itself', async () => {
    edits = false
    expect(await handleBridgeLine(request({ operation: 'category_add', arguments: { name: 'x' } }), deps())).toEqual({
      ok: false,
      error: { code: 'edits_disabled', message: 'Editing is off in Dayflow Electron → Settings → MCP / CLI.' }
    })
    expect(handled).toEqual([])
    expect(logged).toEqual([])
  })

  it('rejects unreadable requests, other protocol versions and unknown operations', async () => {
    const code = async (line: string) => {
      const r = await handleBridgeLine(line, deps())
      return r.ok ? 'ok' : r.error.code
    }
    expect(await code('not json')).toBe('protocol_error')
    expect(await code('[]')).toBe('protocol_error')
    expect(await code(JSON.stringify({ operation: 'category_add' }))).toBe('protocol_mismatch')
    expect(await code(JSON.stringify({ protocol_version: 2, operation: 'category_add' }))).toBe('protocol_mismatch')
    expect(await code(request({ operation: 'drop_tables' }))).toBe('unknown_operation')
    expect(await code(request({ operation: 'category_add', arguments: ['x'] }))).toBe('invalid_argument')
    expect(handled).toEqual([])
  })

  it('passes handler errors through and logs nothing', async () => {
    handler = async () => {
      throw new AgentWriteError('not_found', 'No category named "Nope".')
    }
    expect(await handleBridgeLine(request({ operation: 'category_remove', arguments: { name: 'Nope' } }), deps())).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'No category named "Nope".' }
    })
    handler = async () => {
      throw new Error('disk full')
    }
    expect(await handleBridgeLine(request({ operation: 'category_remove', arguments: { name: 'Nope' } }), deps())).toEqual({
      ok: false,
      error: { code: 'internal_error', message: 'disk full' }
    })
    expect(logged).toEqual([])
  })
})

describe('bridge socket', () => {
  let dir: string
  let server: BridgeServer
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dayflow-bridge-'))
  })
  afterEach(async () => {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  const exchange = (socketPath: string, payload: string | Buffer) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(socketPath)
      let data = ''
      socket.on('data', (d) => (data += d))
      socket.on('end', () => resolve(data))
      socket.on('close', () => resolve(data))
      // The server may hang up mid-write on an oversized request.
      socket.on('error', (err: NodeJS.ErrnoException) => (err.code === 'EPIPE' || err.code === 'ECONNRESET' ? resolve(data) : reject(err)))
      socket.write(payload)
    })

  it('listens owner-only, answers one line per connection, appends the log and removes the socket on stop', async () => {
    const socketPath = agentSocketPath(dir)
    const logFile = join(dir, 'agent-writes.log')
    server = new BridgeServer({ socketPath, logFile, editsEnabled: () => edits, handle: (op, args) => handler(op, args) })
    await server.start()
    // File modes exist on Linux and macOS; Windows uses a named pipe, which is no file.
    if (POSIX) expect(statSync(socketPath).mode & 0o777).toBe(0o600)

    const answer = await exchange(socketPath, `${request({ operation: 'category_add', arguments: { name: 'Reading' } })}\n`)
    expect(JSON.parse(answer)).toEqual({ ok: true, data: { message: 'Created Reading' } })
    expect(answer.endsWith('\n')).toBe(true)
    expect(JSON.parse(readFileSync(logFile, 'utf8').trim())).toMatchObject({ operation: 'category_add', arguments: { name: 'Reading' } })
    if (POSIX) expect(statSync(logFile).mode & 0o777).toBe(0o600)

    await server.stop()
    if (POSIX) expect(() => statSync(socketPath)).toThrow()
  })

  it('drops requests over 1 MB without handling them', async () => {
    const socketPath = agentSocketPath(dir)
    server = new BridgeServer({ socketPath, logFile: join(dir, 'log'), editsEnabled: () => true, handle: (op, args) => handler(op, args) })
    await server.start()
    const answer = await exchange(socketPath, Buffer.alloc(1_048_577, 0x61))
    expect(answer).toBe('')
    expect(handled).toEqual([])
  })
})

describe('agentSocketPath', () => {
  it('uses agent.sock in the data folder, and a named pipe per data folder on Windows', () => {
    expect(agentSocketPath('/home/me/.config/app', 'linux')).toBe(join('/home/me/.config/app', 'agent.sock'))
    const pipe = agentSocketPath('C:\\Users\\me\\AppData\\Roaming\\app', 'win32')
    expect(pipe).toMatch(/^\\\\\.\\pipe\\dayflow-electron-agent-[0-9a-f]{12}$/)
    expect(agentSocketPath('C:\\other', 'win32')).not.toBe(pipe)
  })
})
