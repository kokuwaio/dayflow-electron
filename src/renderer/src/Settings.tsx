import { useEffect, useState } from 'react'
import { CATEGORY_PRESETS, type Category, presetCategories } from '@shared/categories'
import { cliOf, needsApiKey } from '@shared/providers'
import { type AppStatus, CAPTURE_INTERVALS, type CliName, type ProviderKind, type Settings } from '@shared/types'

const PROVIDERS: Array<{ kind: ProviderKind; label: string; hint: string }> = [
  { kind: 'anthropic', label: 'Anthropic', hint: 'Claude models through the Anthropic API.' },
  { kind: 'gemini', label: 'Gemini', hint: 'Google Gemini API; frames are sent inline.' },
  { kind: 'openai', label: 'OpenAI-compatible', hint: 'OpenAI, OpenRouter, or a local Ollama or LM Studio server (no key needed; analyzed in small steps).' },
  { kind: 'claude-cli', label: 'Claude Code', hint: 'Your claude CLI and its subscription; no API key.' },
  { kind: 'codex-cli', label: 'Codex', hint: 'Your codex CLI and its ChatGPT subscription; no API key.' }
]

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(2)

export function SettingsView({ status }: { status: AppStatus | null }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [key, setKey] = useState('')
  const [keyMessage, setKeyMessage] = useState<string | null>(null)
  const [test, setTest] = useState<{ ok: boolean; message: string } | 'running' | null>(null)
  const [keys, setKeys] = useState(status?.keys)

  useEffect(() => {
    void window.dayflow.getSettings().then(setSettings)
  }, [])
  useEffect(() => setKeys(status?.keys), [status?.keys])

  if (!settings) return null

  const save = (next: Partial<Settings>) => void window.dayflow.saveSettings(next).then(setSettings)
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
    <div className="settings">
      <section>
        <h2>AI provider</h2>
        <div className="choices">
          {PROVIDERS.map((p) => (
            <label key={p.kind} className={`choice ${provider === p.kind ? 'active' : ''}`}>
              <input type="radio" name="provider" checked={provider === p.kind} onChange={() => (save({ provider: p.kind }), setTest(null))} />
              <strong>{p.label}</strong>
              <span>{p.hint}</span>
            </label>
          ))}
        </div>
        <label className="field">
          Model
          <input
            key={provider}
            defaultValue={settings.models[provider]}
            onBlur={(e) => save({ models: { ...settings.models, [provider]: e.target.value } })}
          />
        </label>
        {provider === 'openai' && (
          <label className="field">
            Base URL
            <input defaultValue={settings.openaiBaseUrl} onBlur={(e) => save({ openaiBaseUrl: e.target.value })} />
          </label>
        )}
        {cliOf(provider) && <CliSetup cli={cliOf(provider)!} settings={settings} save={save} />}
        {needsApiKey(provider, settings.openaiBaseUrl) || provider === 'openai' ? (
        <label className="field">
          API key {keys?.[provider] ? <em>(stored)</em> : <em>(not set)</em>}
          <span className="row">
            <input
              type="password"
              autoComplete="off"
              placeholder={keys?.[provider] ? 'Enter a new key to replace it' : 'Paste your API key'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button onClick={() => void saveKey()}>{key.trim() || !keys?.[provider] ? 'Save key' : 'Remove key'}</button>
          </span>
        </label>
        ) : null}
        {keyMessage && <p className="note">{keyMessage}</p>}
        <div className="row">
          <button
            disabled={test === 'running'}
            onClick={() => {
              setTest('running')
              void window.dayflow.testProvider().then(setTest)
            }}
          >
            Test connection
          </button>
          {test && test !== 'running' && <span className={test.ok ? 'ok' : 'error'}>{test.message}</span>}
          {test === 'running' && <span className="note">Asking the model…</span>}
        </div>
        <label className="field">
          Fallback provider
          <select
            value={settings.fallbackProvider ?? ''}
            onChange={(e) => save({ fallbackProvider: (e.target.value || null) as ProviderKind | null })}
          >
            <option value="">None</option>
            {PROVIDERS.filter((p) => p.kind !== provider).map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.label} ({settings.models[p.kind]}){needsApiKey(p.kind, settings.openaiBaseUrl) && !keys?.[p.kind] ? ', no key yet' : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="note">
          Takes over a batch when the main provider fails. Select it above to set its model and key.
        </p>
        <label className="field">
          Card language
          <input
            placeholder="English"
            defaultValue={settings.outputLanguage}
            onBlur={(e) => save({ outputLanguage: e.target.value })}
          />
        </label>
        <p className="note">Screenshots go only to the providers chosen here. Nothing else leaves this computer.</p>
      </section>

      <section>
        <h2>Recording</h2>
        <label className="field">
          Screenshot every
          <select value={settings.captureIntervalSec} onChange={(e) => save({ captureIntervalSec: Number(e.target.value) })}>
            {CAPTURE_INTERVALS.map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Resolution
          <select value={settings.captureHeight} onChange={(e) => save({ captureHeight: Number(e.target.value) === 720 ? 720 : 1080 })}>
            <option value={1080}>1080p</option>
            <option value={720}>720p</option>
          </select>
        </label>
        <p className="note">Only the screen under the mouse is recorded. Recording pauses while the screen is locked.</p>
      </section>

      <CategoryEditor categories={settings.categories} save={save} />

      <section>
        <h2>Blocked apps</h2>
        <p className="note">
          While one of these apps is the focused window, nothing is saved and the time shows as "Private". One rule
          per line: an app ID (e.g. <code>org.keepassxc.KeePassXC</code>) or <code>title:</code> followed by text
          in the window title.
        </p>
        <textarea
          rows={6}
          defaultValue={settings.blockedApps.join('\n')}
          onBlur={(e) => save({ blockedApps: e.target.value.split('\n') })}
        />
        {status?.recorder.windowDetection === 'unavailable' && (
          <p className="error">
            Window detection is off, so blocked apps are recorded like any other window.{' '}
            {status.recorder.windowDetectionError}
          </p>
        )}
        {status?.recorder.windowDetection === 'ok' && <p className="ok">Window detection works.</p>}
      </section>

      <section>
        <h2>Storage</h2>
        <label className="field">
          Keep at most (GB)
          <input
            type="number"
            min={1}
            defaultValue={settings.storageLimitGb}
            onBlur={(e) => save({ storageLimitGb: Number(e.target.value) })}
          />
        </label>
        {status && <p className="note">Screenshots use {gb(status.framesBytes)} GB. The oldest are deleted first.</p>}
        <button onClick={() => void window.dayflow.openRecordings()}>Open recordings folder</button>
      </section>

      <section>
        <h2>General</h2>
        <label className="check">
          <input type="checkbox" checked={settings.launchAtLogin} onChange={(e) => save({ launchAtLogin: e.target.checked })} />
          Launch at login
        </label>
      </section>
    </div>
  )
}

/** Where the agent CLI is and whether the app may start it on the host. */
function CliSetup({ cli, settings, save }: { cli: CliName; settings: Settings; save: (next: Partial<Settings>) => void }) {
  const [check, setCheck] = useState<{ ok: boolean; message: string } | 'running' | null>(null)
  // Check right away, so a missing permission or install shows without a click.
  useEffect(() => {
    setCheck('running')
    void window.dayflow.checkCli(cli).then(setCheck)
  }, [cli])
  return (
    <>
      <label className="field">
        Path to {cli} <em>(optional; found automatically)</em>
        <input
          key={cli}
          placeholder={`e.g. /home/you/.local/bin/${cli}`}
          defaultValue={settings.cliPaths[cli]}
          onBlur={(e) => save({ cliPaths: { ...settings.cliPaths, [cli]: e.target.value } })}
        />
      </label>
      <div className="row">
        <button
          onClick={() => {
            setCheck('running')
            void window.dayflow.checkCli(cli).then(setCheck)
          }}
        >
          Check {cli}
        </button>
        {check === 'running' && <span className="note">Looking…</span>}
        {check && check !== 'running' && <span className={check.ok ? 'ok' : 'error'}>{check.message}</span>}
      </div>
      <p className="note">
        Runs your own {cli} CLI with its login. Images and prompts go to {cli === 'claude' ? 'Anthropic' : 'OpenAI'} under your
        subscription. In the Flatpak this needs a one-time opt-in, because it lets the app start programs on your computer.
      </p>
    </>
  )
}

/** Category list: color, name and the description the model sees; presets from upstream's onboarding. */
function CategoryEditor({ categories, save }: { categories: Category[]; save: (next: Partial<Settings>) => void }) {
  const [rows, setRows] = useState(categories)
  // Reset local rows only when the stored categories really changed, so other saves keep unsaved edits.
  const stored = JSON.stringify(categories)
  useEffect(() => setRows(JSON.parse(stored)), [stored])
  const persist = (next: Category[]) => {
    setRows(next)
    save({ categories: next })
  }
  const update = (i: number, change: Partial<Category>) => setRows(rows.map((c, j) => (j === i ? { ...c, ...change } : c)))

  return (
    <section>
      <h2>Categories</h2>
      <p className="note">The description tells the model what belongs in each category. Idle is used for time away.</p>
      <ul className="categories">
        {rows.map((c, i) => (
          <li key={i} className="row">
            <input
              type="color"
              value={c.color}
              aria-label={`Color of ${c.name}`}
              onChange={(e) => update(i, { color: e.target.value })}
              onBlur={() => persist(rows)}
            />
            <input
              className="name"
              value={c.name}
              aria-label="Name"
              onChange={(e) => update(i, { name: e.target.value })}
              onBlur={() => persist(rows)}
            />
            <input
              className="description"
              value={c.description}
              aria-label={`Description of ${c.name}`}
              placeholder={c.isIdle ? 'Time away from the computer' : 'What belongs here'}
              onChange={(e) => update(i, { description: e.target.value })}
              onBlur={() => persist(rows)}
            />
            {!c.isIdle && (
              <button className="link danger" aria-label={`Remove ${c.name}`} onClick={() => persist(rows.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="row">
        <button
          onClick={() => {
            const idle = rows.findIndex((c) => c.isIdle)
            const next = [...rows]
            next.splice(idle < 0 ? next.length : idle, 0, { id: '', name: `Category ${rows.length}`, color: '#6A7EFF', description: '' })
            setRows(next)
          }}
        >
          Add category
        </button>
        <select
          value=""
          aria-label="Apply a preset"
          onChange={(e) => {
            if (e.target.value && confirm(`Replace your categories with the ${e.target.value} preset? Existing cards keep their names.`)) {
              persist(presetCategories(e.target.value))
            }
          }}
        >
          <option value="">Use a preset for…</option>
          {Object.keys(CATEGORY_PRESETS).map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
      </div>
    </section>
  )
}
