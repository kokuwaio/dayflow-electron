/** A fetch stand-in for provider tests: records requests, replays responses. */
export interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

export function fakeFetch(...responses: Array<{ status?: number; json: unknown }>) {
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
    return new Response(JSON.stringify(next.json), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  return { fetch: fetchImpl as typeof fetch, requests }
}
