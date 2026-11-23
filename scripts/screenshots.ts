// The README screenshots, taken from invented data so no real activity shows up.
//
//   npm run build && npx jiti scripts/screenshots.ts [out-dir]   (from the repo root; default out/screenshots)
//
// Seeds a throwaway data folder (a fictional developer's last week and today),
// starts the built app on it with capture off (DAYFLOW_NO_CAPTURE) and CLI
// paths that do not exist, so nothing is recorded and nothing reaches an AI
// provider, then saves one PNG per view through the DevTools protocol.

import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Store } from '../src/main/db/store'
import { dayCount, dayRange, parseKey, shiftDay, todayKey } from '../src/shared/day'
import type { AppSites, Distraction } from '../src/shared/types'

const WIDTH = 1280
const HEIGHT = 820

interface Activity {
  minutes: number
  title: string
  category: 'Work' | 'Personal' | 'Distraction'
  subcategory: string
  summary: string
  detail: string
  site?: string
  distraction?: { title: string; summary: string; minutes: number }
}

const standup: Activity = {
  minutes: 15,
  title: 'Team standup',
  category: 'Work',
  subcategory: 'Meetings',
  summary: 'Daily sync with the Atlas team on yesterday’s progress and today’s plan.',
  detail: 'Video call with the team. Shared progress on the sync service and agreed to pair on the flaky import test after lunch.',
  site: 'meet.jit.si'
}
const lunch: Activity = {
  minutes: 45,
  title: 'Lunch break',
  category: 'Personal',
  subcategory: 'Break',
  summary: 'Away from the desk.',
  detail: 'No activity on screen.'
}

/** Five different workdays; each runs from 9:00 to about 17:30. */
const WEEK: Activity[][] = [
  [
    { minutes: 40, title: 'Inbox and planning', category: 'Work', subcategory: 'Email', summary: 'Answered review requests and planned the week in the issue tracker.', detail: 'Triaged notifications, moved three issues into the sprint and answered a question about the release date.', site: 'github.com' },
    standup,
    { minutes: 110, title: 'Sync service: retry queue', category: 'Work', subcategory: 'Coding', summary: 'Added a retry queue to the Atlas sync service with exponential backoff.', detail: 'Wrote the queue, its tests and a migration for the retry table. Ran the suite locally until it passed.', site: 'github.com', distraction: { title: 'Checked the news', summary: 'Skimmed headlines on a news site.', minutes: 6 } },
    lunch,
    { minutes: 75, title: 'Code review', category: 'Work', subcategory: 'Reviews', summary: 'Reviewed two pull requests on the web client and left comments on error handling.', detail: 'Read through the diff for the settings page and the new upload dialog; asked for a test on the empty state.', site: 'github.com' },
    { minutes: 30, title: 'Video break', category: 'Distraction', subcategory: 'Video', summary: 'Watched a few short videos.', detail: 'Browsed recommended videos unrelated to work.', site: 'youtube.com' },
    { minutes: 95, title: 'Retry queue: metrics', category: 'Work', subcategory: 'Coding', summary: 'Exposed queue depth and retry counts as metrics and opened a pull request.', detail: 'Added counters, wrote the pull request description and requested reviews from two teammates.', site: 'github.com' }
  ],
  [
    standup,
    { minutes: 60, title: 'Design doc: offline mode', category: 'Work', subcategory: 'Writing', summary: 'Drafted the offline-mode design for the mobile client.', detail: 'Outlined the conflict rules and the storage limits, with a diagram of the sync states.', site: 'docs.google.com' },
    { minutes: 90, title: 'Flaky import test', category: 'Work', subcategory: 'Debugging', summary: 'Tracked a flaky import test down to a timezone assumption and fixed it.', detail: 'Reproduced the failure with a fixed clock, then made the parser use the configured zone.', site: 'stackoverflow.com', distraction: { title: 'Social feed', summary: 'Scrolled a social feed.', minutes: 8 } },
    lunch,
    { minutes: 50, title: 'Gym booking and errands', category: 'Personal', subcategory: 'Errands', summary: 'Booked a gym class and paid a bill.', detail: 'Booked Thursday’s class and paid the electricity bill online.' },
    { minutes: 120, title: 'Offline mode spike', category: 'Work', subcategory: 'Coding', summary: 'Prototyped the local write queue for offline mode.', detail: 'Built a throwaway queue in the mobile client to check the storage limits from the design doc.', site: 'github.com' },
    { minutes: 20, title: 'Forum browsing', category: 'Distraction', subcategory: 'Browsing', summary: 'Read threads on a tech forum.', detail: 'Read a long thread about keyboard layouts.', site: 'news.ycombinator.com' }
  ],
  [
    { minutes: 30, title: 'Inbox', category: 'Work', subcategory: 'Email', summary: 'Caught up on email and review comments.', detail: 'Answered two review comments on the metrics pull request.', site: 'github.com' },
    standup,
    { minutes: 105, title: 'Address review feedback', category: 'Work', subcategory: 'Coding', summary: 'Reworked the retry metrics after review and merged the pull request.', detail: 'Renamed the counters, added a dashboard link to the docs and merged after approval.', site: 'github.com' },
    lunch,
    { minutes: 60, title: 'Sprint planning', category: 'Work', subcategory: 'Meetings', summary: 'Planned the next sprint with the team.', detail: 'Estimated the offline-mode stories and split the sync work into three tickets.', site: 'meet.jit.si' },
    { minutes: 110, title: 'Release notes and docs', category: 'Work', subcategory: 'Writing', summary: 'Wrote the release notes and updated the setup guide.', detail: 'Collected merged changes, wrote user-facing notes and fixed outdated screenshots in the guide.', site: 'developer.mozilla.org', distraction: { title: 'Online shopping', summary: 'Looked at headphones in a shop.', minutes: 10 } },
    { minutes: 25, title: 'Language course', category: 'Personal', subcategory: 'Learning', summary: 'Did a Spanish lesson.', detail: 'Completed one lesson and a short review.' }
  ],
  [
    standup,
    { minutes: 120, title: 'Search indexing', category: 'Work', subcategory: 'Coding', summary: 'Added incremental indexing to the search worker.', detail: 'Indexed only changed documents and wrote tests for deletes and renames.', site: 'github.com' },
    lunch,
    { minutes: 45, title: 'One-on-one', category: 'Work', subcategory: 'Meetings', summary: 'Weekly one-on-one with the team lead.', detail: 'Talked about the offline-mode timeline and a conference talk proposal.', site: 'meet.jit.si' },
    { minutes: 35, title: 'Video break', category: 'Distraction', subcategory: 'Video', summary: 'Watched videos.', detail: 'Watched a few cooking videos.', site: 'youtube.com' },
    { minutes: 130, title: 'Search indexing: benchmarks', category: 'Work', subcategory: 'Coding', summary: 'Benchmarked the indexer on a large test corpus.', detail: 'Cut a full re-index from 40 to 6 minutes and wrote the numbers into the pull request.', site: 'github.com', distraction: { title: 'Chat with a friend', summary: 'Private messages.', minutes: 7 } }
  ],
  [
    { minutes: 30, title: 'Inbox and reviews', category: 'Work', subcategory: 'Email', summary: 'Answered messages and approved a small fix.', detail: 'Approved a typo fix and answered a support question.', site: 'github.com' },
    standup,
    { minutes: 90, title: 'Bug bash', category: 'Work', subcategory: 'Testing', summary: 'Tested the release candidate with the team.', detail: 'Found two layout bugs on small screens and filed them.', site: 'github.com' },
    lunch,
    { minutes: 75, title: 'Fix layout bugs', category: 'Work', subcategory: 'Coding', summary: 'Fixed the two layout bugs from the bug bash.', detail: 'Changed the grid breakpoints and added a visual test.', site: 'developer.mozilla.org' },
    { minutes: 40, title: 'Demo prep', category: 'Work', subcategory: 'Meetings', summary: 'Prepared and gave the sprint demo.', detail: 'Showed the retry queue metrics and the faster search index.', site: 'meet.jit.si' },
    { minutes: 30, title: 'Weekend plans', category: 'Personal', subcategory: 'Planning', summary: 'Planned a hiking trip.', detail: 'Checked the weather and train times.' }
  ]
]

const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function seedDay(store: Store, day: string, plan: Activity[]): void {
  let at = dayRange(day).start + 5 * 3600 // 9:00
  for (const a of plan) {
    const start = at
    const end = start + a.minutes * 60
    at = end
    // One analyzed batch per 15 minutes, so Daily, Chat and Weekly unlock.
    let batchId = 0
    for (let t = start; t < end; t += 900) {
      const id = store.createBatch({ start: t, end: Math.min(t + 900, end), shotIds: [] })
      store.finishBatch(id, 'analyzed')
      batchId ||= id
    }
    const distractions: Distraction[] = a.distraction
      ? [{ startTime: clock(start + 1800), endTime: clock(start + 1800 + a.distraction.minutes * 60), title: a.distraction.title, summary: a.distraction.summary }]
      : []
    const appSites: AppSites = a.site ? { primary: a.site } : {}
    store.addCards(batchId, [{ start, end, title: a.title, category: a.category, subcategory: a.subcategory, summary: a.summary, detailedSummary: a.detail, distractions, appSites }])
  }
}

/** The fictional week: last week's Monday to Friday, then this week's workdays up to now. */
function seed(dataDir: string): { lastWorkday: string } {
  const today = todayKey()
  const weekday = (parseKey(today).getDay() + 6) % 7 // Monday 0
  const lastMonday = shiftDay(today, -weekday - 7)
  const days = [...Array(5).keys()].map((i) => shiftDay(lastMonday, i))
  for (let i = 0; i < Math.min(weekday, 5); i++) days.push(shiftDay(lastMonday, 7 + i))
  days.push(today)

  writeFileSync(
    join(dataDir, 'settings.json'),
    JSON.stringify({
      onboarded: true,
      provider: 'claude-cli',
      cliPaths: { claude: '/nonexistent/claude', codex: '/nonexistent/codex' },
      showDailyGoalPopups: false,
      checkForUpdates: false,
      // No automatic standup run: today's standup is seeded below, and this stops retries.
      standupAttempts: { day: today, count: 3 },
      chatMemory: ''
    })
  )

  const store = Store.open(join(dataDir, 'dayflow.sqlite'))
  const now = Math.floor(Date.now() / 1000)
  // Today gets a whole day too, so Daily looks the same whatever the hour of the run.
  days.forEach((day, i) => seedDay(store, day, WEEK[i % WEEK.length]!))
  const lastWorkday = days[days.length - 2]!

  store.saveStandup(today, {
    draft: {
      highlightsTitle: 'Yesterday',
      highlights: [
        'Fixed both layout bugs from the bug bash',
        'Gave the sprint demo',
        'Cut a full search re-index from 40 to 6 minutes'
      ],
      tasksTitle: 'Today',
      tasks: ['Start the offline-mode write queue', 'Review the upload dialog pull request', 'Write the conference talk proposal'],
      blockersTitle: 'Blockers',
      blockersBody: 'Waiting for design feedback on the offline conflict screen.'
    },
    sourceDay: lastWorkday,
    provider: 'claude-cli',
    model: 'sonnet',
    generatedAt: now - 3600
  })

  const chat = store.createConversation({ title: 'Where did my focus time go last week?', provider: 'claude-cli', now: now - 600 })
  store.addChatMessage(chat, { role: 'user', content: 'Where did my focus time go last week?', now: now - 600 })
  store.addChatMessage(chat, {
    role: 'assistant',
    now: now - 590,
    content: [
      'Last week you spent about **27 hours on work**, most of it in coding blocks on the sync service and the search indexer.',
      '',
      '```chart type=bar',
      JSON.stringify({ title: 'Focused work per day (hours)', x: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], y: [5.5, 4.5, 5.1, 4.9, 3.9], color: '#B984FF' }),
      '```',
      '',
      '- **Longest block:** Thursday’s 2h 10m benchmark session.',
      '- **Most interruptions:** Tuesday afternoon, with a social feed and a forum break.',
      '- Meetings took about 4 hours, spread over every day.'
    ].join('\n')
  })
  store.close()
  return { lastWorkday }
}

// ---------------------------------------------------------------- DevTools protocol

class Page {
  private id = 0
  private readonly pending = new Map<number, (value: { result?: unknown; error?: unknown }) => void>()
  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; error?: unknown }
      if (m.id) this.pending.get(m.id)?.(m)
    }
  }

  /** The spawned app's window: its own port, from the DevToolsActivePort file in its temporary profile. */
  static async connect(app: ChildProcess, dataDir: string): Promise<Page> {
    for (let i = 0; i < 60; i++) {
      if (app.exitCode !== null || app.signalCode !== null) throw new Error('The app exited before its window opened.')
      try {
        const port = Number(readFileSync(join(dataDir, 'DevToolsActivePort'), 'utf8').split('\n')[0])
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
        const page = list.find((p) => p.type === 'page')
        if (page) {
          const ws = new WebSocket(page.webSocketDebuggerUrl)
          await new Promise((r) => (ws.onopen = r))
          return new Page(ws)
        }
      } catch {
        // not up yet
      }
      await sleep(500)
    }
    throw new Error('The app window did not open.')
  }

  async send<T>(method: string, params: object = {}): Promise<T> {
    const id = ++this.id
    const reply = await new Promise<{ result?: unknown; error?: unknown }>((r) => {
      this.pending.set(id, r)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
    if (reply.error) throw new Error(`${method}: ${JSON.stringify(reply.error)}`)
    return reply.result as T
  }

  async run(expression: string): Promise<unknown> {
    const r = await this.send<{ result: { value?: unknown }; exceptionDetails?: unknown }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`${expression}: ${JSON.stringify(r.exceptionDetails)}`)
    return r.result.value
  }

  async shot(file: string): Promise<void> {
    await sleep(1500)
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(data, 'base64'))
    console.log(file)
  }

  close(): void {
    this.ws.close()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const click = (selector: string, text?: string) =>
  `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) throw new Error('no ${selector}'); el.click() })()`

async function capture(page: Page, outDir: string, lastWorkday: string): Promise<void> {
  await page.send('Page.enable')
  await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false })
  await page.run("new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', r)))")
  // Toasts and the recorder status ("Stopped": capture is off) are about this run, not the app.
  await page.run("document.head.append(Object.assign(document.createElement('style'), { textContent: '.toasts, .pause-status { display: none !important }' }))")
  await sleep(1500)

  for (let i = 1; i < dayCount(lastWorkday, todayKey()); i++) {
    await page.run(click('.nav-arrow[aria-label]'))
    await sleep(200)
  }
  await page.shot(join(outDir, 'timeline.png'))

  await page.run(click('.nav-item', 'Daily'))
  await page.shot(join(outDir, 'daily.png'))

  await page.run(click('.nav-item', 'Weekly'))
  // Weekly opens on the newest week with enough hours; go to the current week, then one back.
  await sleep(500)
  while (await page.run("document.querySelectorAll('.nav-arrow')[1]?.disabled === false")) {
    await page.run("document.querySelectorAll('.nav-arrow')[1].click()")
    await sleep(300)
  }
  await page.run("document.querySelectorAll('.nav-arrow')[0].click()")
  await page.shot(join(outDir, 'weekly.png'))

  await page.run(click('.nav-item', 'Chat'))
  await sleep(500)
  await page.run(click('.chat-header .icon'))
  await sleep(500)
  await page.run(click('.chat-history-row .link'))
  await sleep(500)
  await page.run(click('.chat-header .icon'))
  await page.shot(join(outDir, 'chat.png'))
  page.close()
}

async function main(): Promise<void> {
  const root = process.cwd()
  const outDir = resolve(process.argv[2] ?? join(root, 'out/screenshots'))
  mkdirSync(outDir, { recursive: true })
  const dataDir = mkdtempSync(join(tmpdir(), 'dayflow-screenshots-'))
  let app: ChildProcess | undefined
  try {
    const { lastWorkday } = seed(dataDir)
    const electron = createRequire(join(root, 'package.json'))('electron') as unknown as string
    const env: NodeJS.ProcessEnv = { ...process.env, DAYFLOW_DATA_DIR: dataDir, DAYFLOW_NO_CAPTURE: '1', LANG: 'en_US.UTF-8' }
    delete env.ELECTRON_RUN_AS_NODE
    // Port 0: Chromium picks a free port and writes it to DevToolsActivePort, so no other running app can answer.
    app = spawn(electron, [root, '--remote-debugging-port=0', `--window-size=${WIDTH},${HEIGHT}`], { env, stdio: 'ignore' })
    await capture(await Page.connect(app, dataDir), outDir, lastWorkday)
  } finally {
    app?.kill()
    await sleep(1000)
    rmSync(dataDir, { recursive: true, force: true })
  }
}

await main()
