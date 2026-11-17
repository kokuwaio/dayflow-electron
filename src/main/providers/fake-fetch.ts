/** A fetch stand-in for provider tests: records requests, replays responses. */
export interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

/** A JSON reply, or a server-sent event stream: each entry is one event's data (objects are JSON-encoded). */
export type FakeResponse = { status?: number; json: unknown } | { sse: Array<unknown | { event: string; data: unknown }> }

const sseBody = (events: Array<unknown | { event: string; data: unknown }>) =>
  events
    .map((e) => {
      const named = e && typeof e === 'object' && 'event' in e && 'data' in e ? (e as { event: string; data: unknown }) : null
      const data = named ? named.data : e
      const line = `data: ${typeof data === 'string' ? data : JSON.stringify(data)}`
      return named ? `event: ${named.event}\n${line}\n\n` : `${line}\n\n`
    })
    .join('')

export function fakeFetch(...responses: FakeResponse[]) {
  const requests: RecordedRequest[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init)
    const text = await req.text()
    requests.push({
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
      body: text ? JSON.parse(text) : undefined
    })
    const next = responses.shift()
    if (!next) throw new Error('fakeFetch: no response left')
    if ('sse' in next) return new Response(sseBody(next.sse), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    return new Response(JSON.stringify(next.json), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  return { fetch: fetchImpl as typeof fetch, requests }
}
