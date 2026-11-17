import { useState } from 'react'
import { CATEGORY_PRESETS, presetCategories } from '@shared/categories'
import { cliOf, needsApiKey } from '@shared/providers'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { PROVIDER_CHOICES } from './providers'


/** First-run setup, after upstream's onboarding: what the app does, your role, an AI provider, then recording. */
export function Onboarding({ settings, platform, onDone }: { settings: Settings; platform: string; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [role, setRole] = useState('Software Engineer')
  const [draft, setDraft] = useState(settings)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [test, setTest] = useState<{ ok: boolean; message: string } | 'running' | null>(null)

  const save = async (next: Partial<Settings>) => setDraft(await window.dayflow.saveSettings(next))
  const provider = draft.provider
  /** Stores a typed key under the current provider; false (with a message) when the keyring refuses it. */
  const storeKey = async (): Promise<boolean> => {
    if (!key.trim()) return true
    try {
      await window.dayflow.setApiKey(provider, key)
      setKeyError(null)
      return true
    } catch (err) {
      setKeyError(String(err))
      return false
    }
  }
  const finish = async () => {
    await window.dayflow.completeOnboarding()
    onDone()
  }

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Set up Dayflow">
      <div className="onboarding-card">
        <p className="note">Step {step + 1} of 4</p>
        {step === 0 && (
          <>
            <h2>Your day, as a timeline</h2>
            <p>
              Every few seconds the app takes a screenshot of the screen under your mouse. Every 15 minutes an AI model you
              choose turns them into cards that say what you did.
            </p>
            <p className="note">
              Screenshots stay on this computer. Only the provider you pick below sees them. There is no telemetry. Password
              managers and other blocked apps are never recorded, and you can pause any time from the tray.
            </p>
            <button onClick={() => setStep(1)}>Get started</button>
          </>
        )}
        {step === 1 && (
          <>
            <h2>What do you do?</h2>
            <p className="note">This picks categories for your cards. You can change them later in Settings.</p>
            <div className="choices">
              {Object.keys(CATEGORY_PRESETS).map((r) => (
                <label key={r} className={`choice ${role === r ? 'active' : ''}`}>
                  <input type="radio" checked={role === r} onChange={() => setRole(r)} />
                  <strong>{r}</strong>
                  <span>{presetCategories(r).filter((c) => !c.isIdle).map((c) => c.name).join(', ')}</span>
                </label>
              ))}
            </div>
            <div className="row">
              <button onClick={() => void save({ categories: presetCategories(role) }).then(() => setStep(2))}>Continue</button>
              <button className="link" onClick={() => setStep(0)}>
                Back
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Choose an AI model</h2>
            <div className="choices">
              {PROVIDER_CHOICES.map((p) => (
                <label key={p.kind} className={`choice ${provider === p.kind ? 'active' : ''}`}>
                  <input type="radio" checked={provider === p.kind} onChange={() => (void save({ provider: p.kind }), setTest(null), setKey(''))} />
                  <strong>{p.label}</strong>
                  <span>{p.hint}</span>
                </label>
              ))}
            </div>
            <label className="field">
              Model
              <input
                key={provider}
                defaultValue={draft.models[provider]}
                onBlur={(e) => void save({ models: { ...draft.models, [provider]: e.target.value || DEFAULT_SETTINGS.models[provider] } })}
              />
            </label>
            {provider === 'openai' && (
              <label className="field">
                Base URL <em>(e.g. http://localhost:11434/v1 for Ollama)</em>
                <input defaultValue={draft.openaiBaseUrl} onBlur={(e) => void save({ openaiBaseUrl: e.target.value })} />
              </label>
            )}
            {needsApiKey(provider, draft.openaiBaseUrl) && !cliOf(provider) && (
              <label className="field">
                API key
                <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
              </label>
            )}
            {cliOf(provider) && (
              <p className="note">
                Install and log in to the {cliOf(provider)} CLI first. In the Flatpak, the app also needs a one-time permission;
                Settings shows the command.
              </p>
            )}
            <div className="row">
              <button
                disabled={test === 'running'}
                onClick={async () => {
                  setTest('running')
                  if (!(await storeKey())) return setTest(null)
                  setTest(await window.dayflow.testProvider().catch((err: unknown) => ({ ok: false, message: String(err) })))
                }}
              >
                Test connection
              </button>
              {test && test !== 'running' && <span className={test.ok ? 'ok' : 'error'}>{test.message}</span>}
            </div>
            {keyError && <p className="error">{keyError}</p>}
            <div className="row">
              <button onClick={async () => (await storeKey()) && setStep(3)}>
                {test && test !== 'running' && test.ok ? 'Continue' : key.trim() ? 'Save and continue' : 'Skip for now'}
              </button>
              <button className="link" onClick={() => setStep(1)}>
                Back
              </button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h2>Start recording</h2>
            {platform === 'linux' ? (
              <p>
                Your desktop now asks which screens to share. Choose <strong>all screens</strong> and allow{' '}
                <strong>restoring the permission</strong>, so it does not ask again. The app keeps only the screen under your
                mouse and pauses while the screen is locked.
              </p>
            ) : (
              <p>
                Screen recording on {platform} is not built yet (see the roadmap). Setup is saved; recording starts once it is
                available.
              </p>
            )}
            <div className="row">
              <button onClick={() => void finish()}>Start recording</button>
              <button className="link" onClick={() => setStep(2)}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
