import { useEffect, useState } from 'react'
import { type AppStatus, CAPTURE_INTERVALS, type ProviderKind, type Settings } from '@shared/types'

const PROVIDERS: Array<{ kind: ProviderKind; label: string; hint: string }> = [
  { kind: 'anthropic', label: 'Anthropic', hint: 'Claude models through the Anthropic API.' },
  { kind: 'gemini', label: 'Gemini', hint: 'Google Gemini API; frames are sent inline.' },
  { kind: 'openai', label: 'OpenAI-compatible', hint: 'OpenAI, OpenRouter, or a local Ollama or LM Studio server.' }
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
        <p className="note">Screenshots go only to the provider chosen here. Nothing else leaves this computer.</p>
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
