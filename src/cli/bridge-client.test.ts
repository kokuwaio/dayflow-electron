import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeServer, agentSocketPath } from '../main/agent/bridge'
import { AgentWriteError } from '../main/agent/writes'
import { sendToApp } from './bridge-client'
import { BridgeError } from './bridge-client'

let dir: string
let server: BridgeServer | null
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dayflow-client-'))
  server = null
})
afterEach(async () => {
  await server?.stop()
  rmSync(dir, { recursive: true, force: true })
})

const start = async (edits: boolean) => {
  server = new BridgeServer({
    socketPath: agentSocketPath(dir),
    logFile: join(dir, 'agent-writes.log'),
    editsEnabled: () => edits,
    handle: async (operation, args) => {
      if (args.name === 'Nope') throw new AgentWriteError('not_found', 'No category named "Nope".')
      return { message: `${operation} ${String(args.name)}` }
    }
  })
  await server.start()
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a failure')
    },
    (err: BridgeError) => ({ code: err.code, message: err.message })
  )

describe('CLI ↔ app bridge', () => {
  it('sends a write and returns the app\'s data', async () => {
    await start(true)
    expect(await sendToApp(agentSocketPath(dir), 'category_add', { name: 'Reading' })).toEqual({ message: 'category_add Reading' })
  })

  it('surfaces the app\'s error codes', async () => {
    await start(true)
    expect(await failure(sendToApp(agentSocketPath(dir), 'category_remove', { name: 'Nope' }))).toEqual({ code: 'not_found', message: 'No category named "Nope".' })
    expect((await failure(sendToApp(agentSocketPath(dir), 'drop_tables', {}))).code).toBe('unknown_operation')
  })

  it('reports edits switched off in the app, and an app that is not running', async () => {
    await start(false)
    expect((await failure(sendToApp(agentSocketPath(dir), 'category_add', { name: 'x' }))).code).toBe('edits_disabled')
    await server!.stop()
    expect(await failure(sendToApp(agentSocketPath(dir), 'category_add', { name: 'x' }))).toEqual({
      code: 'app_not_running',
      message: "Dayflow Electron isn't running. Reads work offline; edits need the app open."
    })
  })
})
