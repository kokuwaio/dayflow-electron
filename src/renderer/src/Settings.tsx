import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ArrowRight, Download, FolderOpen, RotateCw } from 'lucide-react'
import { CATEGORY_PRESETS, type Category, presetCategories } from '@shared/categories'
import { todayKey } from '@shared/day'
import { cliOf, needsApiKey } from '@shared/providers'
import { type AppStatus, CAPTURE_INTERVALS, type CliName, type ProviderKind, type Settings } from '@shared/types'
import { PROVIDER_CHOICES } from './providers'

/** Upstream's Settings tabs that the port has (Settings/SettingsView.swift); "categories" opens Other at the category list. */
export type SettingsTab = 'providers' | 'storage' | 'privacy' | 'export' | 'other' | 'categories'
const TABS: Array<{ id: Exclude<SettingsTab, 'categories'>; label: string }> = [
  { id: 'storage', label: 'Storage' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'providers', label: 'Providers' },
  { id: 'export', label: 'Export' },
  { id: 'other', label: 'Other' }
]

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(2)
type Save = (next: Partial<Settings>) => void

/** A section without a card: 17/600 title, 12 px subtitle, then rows. */
function Section({ title, sub, children, id }: { title: string; sub?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <section className="s-section" id={id}>
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {children && <div className="rows">{children}</div>}
    </section>
  )
}

/** Label (and subtitle) on the left, control on the right, hairline below. */
function Row({ label, sub, children, stack, grow }: { label: ReactNode; sub?: ReactNode; children?: ReactNode; stack?: boolean; grow?: boolean }) {
  return (
    <div className={`s-row ${stack ? 'stack' : ''}`}>
      <div className="label">
        <b>{label}</b>
        {sub && <span>{sub}</span>}
      </div>
      {children && <div className={`control ${grow ? 'grow' : ''}`}>{children}</div>}
    </div>
  )
}

function StatusDot({ kind, children }: { kind: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`status-dot ${kind}`}>{children}</span>
}

export function SettingsView({ status, tab, onTab }: { status: AppStatus | null; tab: SettingsTab; onTab: (tab: SettingsTab) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const nav = useRef<HTMLDivElement>(null)
  const [pillTop, setPillTop] = useState(0)
  const current = tab === 'categories' ? 'other' : tab

  useEffect(() => {
    void window.dayflow.getSettings().then(setSettings)
  }, [])
  // The selected tab's pill slides to it.
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>(`[data-tab="${current}"]`)
    if (el) setPillTop(el.offsetTop)
  }, [current, settings !== null])
  useEffect(() => {
    if (tab === 'categories' && settings) document.getElementById('settings-categories')?.scrollIntoView({ block: 'start' })
  }, [tab, settings !== null])

  if (!settings) return null
  const save: Save = (next) => void window.dayflow.saveSettings(next).then(setSettings)

  return (
    <div className="settings">
      <nav className="settings-nav" ref={nav} aria-label="Settings sections">
        <h1>Settings</h1>
        <span className="tab-pill" style={{ transform: `translateY(${pillTop}px)`, top: 0 }} />
        {TABS.map((t) => (
          <button key={t.id} data-tab={t.id} className={`tab ${current === t.id ? 'active' : ''}`} aria-current={current === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="settings-content">
        <div className="settings-tab" key={current}>
          {current === 'providers' && <ProvidersTab settings={settings} status={status} save={save} />}
          {current === 'storage' && <StorageTab settings={settings} status={status} save={save} />}
          {current === 'privacy' && <PrivacyTab settings={settings} status={status} save={save} />}
          {current === 'export' && <ExportTab />}
          {current === 'other' && <OtherTab settings={settings} save={save} />}
        </div>
      </div>
    </div>
  )
}

function ProvidersTab({ settings, status, save }: { settings: Settings; status: AppStatus | null; save: Save }) {
  const [key, setKey] = useState('')
  const [keyMessage, setKeyMessage] = useState<string | null>(null)
  const [test, setTest] = useState<{ ok: boolean; message: string } | 'running' | null>(null)
  const [keys, setKeys] = useState(status?.keys)
  useEffect(() => setKeys(status?.keys), [status?.keys])
  const provider = settings.provider

  const saveKey = async () => {
    try {
      await window.dayflow.setApiKey(provider, key)
      setKey('')
      setKeyMessage(key.trim() ? 'Key saved in your keyring.' : 'Key removed.')
      setKeys((await window.dayflow.getStatus()).keys)
    } catch (err) {
      setKeyMessage(String(err))
    }
  }

  return (
    <>
      <Section title="AI provider" sub="Screenshots go only to the providers chosen here. Nothing else leaves this computer.">
        <div className="provider-list" role="radiogroup" aria-label="Provider">
          {PROVIDER_CHOICES.map((p) => (
            <label key={p.kind} className={`provider ${provider === p.kind ? 'active' : ''}`}>
              <input type="radio" name="provider" checked={provider === p.kind} onChange={() => (save({ provider: p.kind }), setTest(null))} />
              <div>
                <strong>{p.label}</strong>
                <br />
                <span>{p.hint}</span>
              </div>
              {provider === p.kind && <span className="badge">In use</span>}
            </label>
          ))}
        </div>
        <Row label="Model" grow>
          <input key={provider} defaultValue={settings.models[provider]} onBlur={(e) => save({ models: { ...settings.models, [provider]: e.target.value } })} />
        </Row>
        {provider === 'openai' && (
          <Row label="Base URL" sub="For example http://localhost:11434/v1 for Ollama." grow>
            <input defaultValue={settings.openaiBaseUrl} onBlur={(e) => save({ openaiBaseUrl: e.target.value })} />
          </Row>
        )}
        {cliOf(provider) && <CliSetup cli={cliOf(provider)!} settings={settings} save={save} />}
        {(needsApiKey(provider, settings.openaiBaseUrl) || provider === 'openai') && (
          <Row
            label="API key"
            sub={keyMessage ?? (keys?.[provider] ? <StatusDot kind="good">Stored in your keyring</StatusDot> : <StatusDot kind="warn">Not set</StatusDot>)}
            grow
          >
            <input
              type="password"
              autoComplete="off"
              placeholder={keys?.[provider] ? 'Enter a new key to replace it' : 'Paste your API key'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn-ink" onClick={() => void saveKey()}>
              {key.trim() || !keys?.[provider] ? 'Save key' : 'Remove key'}
            </button>
          </Row>
        )}
        <Row
          label="Connection"
          sub={
            test === 'running' ? (
              'Asking the model…'
            ) : test ? (
              <StatusDot kind={test.ok ? 'good' : 'bad'}>{test.message}</StatusDot>
            ) : (
              'Sends a small request to the model.'
            )
          }
        >
          <button
            className="btn-subtle"
            disabled={test === 'running'}
            onClick={() => {
              setTest('running')
              void window.dayflow.testProvider().then(setTest)
            }}
          >
            Test connection
          </button>
        </Row>
        <Row label="Fallback provider" sub="Takes over a batch when the main provider fails. Select it above to set its model and key.">
          <select value={settings.fallbackProvider ?? ''} onChange={(e) => save({ fallbackProvider: (e.target.value || null) as ProviderKind | null })}>
            <option value="">None</option>
            {PROVIDER_CHOICES.filter((p) => p.kind !== provider).map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.label} ({settings.models[p.kind]}){needsApiKey(p.kind, settings.openaiBaseUrl) && !keys?.[p.kind] ? ', no key yet' : ''}
              </option>
            ))}
          </select>
        </Row>
        <LanguageRow settings={settings} save={save} />
      </Section>

      <Section title="Prompt" sub="Replace the rules the model follows for titles, summaries and the detailed log. Leave a field empty to use upstream Dayflow's text.">
        {(
          [
            ['title', 'Title rules'],
            ['summary', 'Summary rules'],
            ['detailedSummary', 'Detailed log rules']
          ] as const
        ).map(([field, label]) => (
          <Row key={field} label={label} stack>
            <textarea
              rows={4}
              placeholder="Upstream default"
              defaultValue={settings.promptOverrides[field]}
              onBlur={(e) => save({ promptOverrides: { ...settings.promptOverrides, [field]: e.target.value } })}
            />
          </Row>
        ))}
      </Section>
    </>
  )
}

/** Card language, saved on Save (or blur) and cleared with Reset. */
function LanguageRow({ settings, save }: { settings: Settings; save: Save }) {
  const [value, setValue] = useState(settings.outputLanguage)
  useEffect(() => setValue(settings.outputLanguage), [settings.outputLanguage])
  return (
    <Row label="Output language override" sub="Language for card text. Empty means English." grow>
      <input placeholder="English" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => save({ outputLanguage: value })} />
      <button className="btn-subtle" onClick={() => save({ outputLanguage: value })}>
        Save
      </button>
      <button className="btn-subtle" disabled={!settings.outputLanguage} onClick={() => (setValue(''), save({ outputLanguage: '' }))}>
        Reset
      </button>
    </Row>
  )
}

/** Where the agent CLI is and whether the app may start it on the host. */
function CliSetup({ cli, settings, save }: { cli: CliName; settings: Settings; save: Save }) {
  const [check, setCheck] = useState<{ ok: boolean; message: string } | 'running' | null>(null)
  // Check right away, so a missing permission or install shows without a click.
  useEffect(() => {
    setCheck('running')
    void window.dayflow.checkCli(cli).then(setCheck)
  }, [cli])
  return (
    <>
      <Row label={`Path to ${cli}`} sub="Optional; found automatically." grow>
        <input
          key={cli}
          placeholder={`e.g. /home/you/.local/bin/${cli}`}
          defaultValue={settings.cliPaths[cli]}
          onBlur={(e) => save({ cliPaths: { ...settings.cliPaths, [cli]: e.target.value } })}
        />
      </Row>
      <Row
        label={`${cli} CLI`}
        sub={
          <>
            {check === 'running' ? 'Looking…' : check ? <StatusDot kind={check.ok ? 'good' : 'bad'}>{check.message}</StatusDot> : null}
            <br />
            Runs your own {cli} CLI with its login. Images and prompts go to {cli === 'claude' ? 'Anthropic' : 'OpenAI'} under your subscription. In
            the Flatpak this needs a one-time opt-in, because it lets the app start programs on your computer.
          </>
        }
      >
        <button
          className="btn-subtle"
          onClick={() => {
            setCheck('running')
            void window.dayflow.checkCli(cli).then(setCheck)
          }}
        >
          Check {cli}
        </button>
      </Row>
    </>
  )
}

function StorageTab({ settings, status, save }: { settings: Settings; status: AppStatus | null; save: Save }) {
  return (
    <>
      <Section title="Recording" sub="Only the screen under the mouse is recorded. Recording pauses while the screen is locked.">
        <Row label="Capture frequency" sub="How often a screenshot is taken.">
          <select value={settings.captureIntervalSec} onChange={(e) => save({ captureIntervalSec: Number(e.target.value) })}>
            {CAPTURE_INTERVALS.map((s) => (
              <option key={s} value={s}>
                Every {s} s
              </option>
            ))}
          </select>
        </Row>
        <Row label="Resolution">
          <select value={settings.captureHeight} onChange={(e) => save({ captureHeight: Number(e.target.value) === 720 ? 720 : 1080 })}>
            <option value={1080}>1080p</option>
            <option value={720}>720p</option>
          </select>
        </Row>
      </Section>
      <Section title="Storage" sub="When the limit is reached, the oldest screenshots are deleted first. Cards stay.">
        <Row label="Storage limit" sub={status ? `Screenshots use ${gb(status.framesBytes)} GB.` : undefined}>
          <input
            type="number"
            min={1}
            style={{ width: 80 }}
            defaultValue={settings.storageLimitGb}
            onBlur={(e) => save({ storageLimitGb: Number(e.target.value) })}
            aria-label="Storage limit in GB"
          />
          <span className="note">GB</span>
        </Row>
        <Row label="Recordings folder">
          <button className="btn-subtle" onClick={() => void window.dayflow.openRecordings()}>
            <FolderOpen size={14} />
            Open
          </button>
        </Row>
      </Section>
    </>
  )
}

function PrivacyTab({ settings, status, save }: { settings: Settings; status: AppStatus | null; save: Save }) {
  const detection = status?.recorder.windowDetection
  return (
    <Section
      title="Blocked apps"
      sub={
        <>
          While one of these apps is the focused window, nothing is saved and the time shows as "Private". One rule per line: an app ID (e.g.{' '}
          <code>org.keepassxc.KeePassXC</code>) or <code>title:</code> followed by text in the window title.
        </>
      }
    >
      <Row
        label="Rules"
        sub={
          detection === 'unavailable' ? (
            <StatusDot kind="bad">
              Window detection is off, so blocked apps are recorded like any other window. {status?.recorder.windowDetectionError}
            </StatusDot>
          ) : detection === 'ok' ? (
            <StatusDot kind="good">Window detection works.</StatusDot>
          ) : undefined
        }
        stack
      >
        <textarea className="mono" rows={7} defaultValue={settings.blockedApps.join('\n')} onBlur={(e) => save({ blockedApps: e.target.value.split('\n') })} />
      </Row>
    </Section>
  )
}

function ExportTab() {
  const today = todayKey()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [reprocessDay, setReprocessDay] = useState(today)
  const [armed, setArmed] = useState(false)
  const [reprocessed, setReprocessed] = useState<string | null>(null)
  const invalid = from > to
  return (
    <>
      <Section title="Export" sub="Save the timeline of a date range as a Markdown file.">
        <Row
          label="Date range"
          sub={invalid ? <StatusDot kind="bad">Start must be on or before end.</StatusDot> : result ? <StatusDot kind={result.ok ? 'good' : 'warn'}>{result.message}</StatusDot> : undefined}
        >
          <span className="date-pill">
            <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <ArrowRight size={14} color="var(--text-muted)" />
            <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </span>
        </Row>
        <Row label="Export as Markdown">
          <button
            className="btn-ink"
            disabled={invalid}
            onClick={() =>
              void window.dayflow
                .exportMarkdown(from, to)
                .then(setResult, (err: unknown) => setResult({ ok: false, message: `Couldn't save file: ${String(err)}` }))
            }
          >
            <Download size={14} />
            Export as Markdown
          </button>
        </Row>
      </Section>
      <Section title="Reprocess" sub="Analyze a day again. Its cards are replaced; your recordings stay.">
        <Row label="Day" sub={reprocessed ?? undefined}>
          <span className="date-pill">
            <input type="date" value={reprocessDay} max={today} onChange={(e) => (setReprocessDay(e.target.value), setArmed(false))} aria-label="Day to reprocess" />
          </span>
          <button
            className="btn-subtle"
            disabled={!reprocessDay}
            onClick={() => {
              if (!armed) return setArmed(true)
              setArmed(false)
              void window.dayflow
                .reprocessDay(reprocessDay)
                .then((n) => setReprocessed(n ? `${n} ${n === 1 ? 'batch' : 'batches'} queued for analysis.` : 'Nothing recorded on that day.'))
            }}
          >
            <RotateCw size={13} />
            {armed ? 'Confirm' : 'Reprocess day'}
          </button>
        </Row>
      </Section>
    </>
  )
}

function OtherTab({ settings, save }: { settings: Settings; save: Save }) {
  return (
    <>
      <Section title="General">
        <Row label="Launch Dayflow at login">
          <input type="checkbox" className="switch" checked={settings.launchAtLogin} onChange={(e) => save({ launchAtLogin: e.target.checked })} aria-label="Launch at login" />
        </Row>
        <Row
          label="Show app/website icons in timeline"
          sub="Icons are loaded from the websites themselves (e.g. github.com/favicon.ico), which tells those sites your IP address."
        >
          <input type="checkbox" className="switch" checked={settings.showAppIcons} onChange={(e) => save({ showAppIcons: e.target.checked })} aria-label="Show icons" />
        </Row>
      </Section>
      <CategoryEditor categories={settings.categories} save={save} />
    </>
  )
}

/** Category list: color, name and the description the model sees; presets from upstream's onboarding. */
function CategoryEditor({ categories, save }: { categories: Category[]; save: Save }) {
  const [rows, setRows] = useState(categories)
  const [preset, setPreset] = useState<string | null>(null)
  // Reset local rows only when the stored categories really changed, so other saves keep unsaved edits.
  const stored = JSON.stringify(categories)
  useEffect(() => setRows(JSON.parse(stored)), [stored])
  const persist = (next: Category[]) => {
    setRows(next)
    save({ categories: next })
  }
  const update = (i: number, change: Partial<Category>) => setRows(rows.map((c, j) => (j === i ? { ...c, ...change } : c)))

  return (
    <Section id="settings-categories" title="Categories" sub="The description tells the model what belongs in each category. Idle is used for time away.">
      <ul className="categories">
        {rows.map((c, i) => (
          <li key={i}>
            <input type="color" value={c.color} aria-label={`Color of ${c.name}`} onChange={(e) => update(i, { color: e.target.value })} onBlur={() => persist(rows)} />
            <input className="name" value={c.name} aria-label="Name" onChange={(e) => update(i, { name: e.target.value })} onBlur={() => persist(rows)} />
            <input
              className="description"
              value={c.description}
              aria-label={`Description of ${c.name}`}
              placeholder={c.isIdle ? 'Time away from the computer' : 'What belongs here'}
              onChange={(e) => update(i, { description: e.target.value })}
              onBlur={() => persist(rows)}
            />
            {!c.isIdle ? (
              <button className="link danger" aria-label={`Remove ${c.name}`} onClick={() => persist(rows.filter((_, j) => j !== i))}>
                ✕
              </button>
            ) : (
              <span style={{ width: 9 }} />
            )}
          </li>
        ))}
      </ul>
      <Row label="Add or replace">
        <button
          className="btn-subtle"
          onClick={() => {
            const idle = rows.findIndex((c) => c.isIdle)
            const next = [...rows]
            next.splice(idle < 0 ? next.length : idle, 0, { id: '', name: `Category ${rows.length}`, color: '#6A7EFF', description: '' })
            setRows(next)
          }}
        >
          Add category
        </button>
        <select value={preset ?? ''} aria-label="Apply a preset" onChange={(e) => setPreset(e.target.value || null)}>
          <option value="">Use a preset for…</option>
          {Object.keys(CATEGORY_PRESETS).map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
        {preset && (
          <button className="btn-ink" onClick={() => (persist(presetCategories(preset)), setPreset(null))} title="Existing cards keep their names.">
            Replace with {preset}
          </button>
        )}
      </Row>
    </Section>
  )
}
