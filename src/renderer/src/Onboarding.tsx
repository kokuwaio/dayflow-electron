// First-run setup, after upstream's onboarding (Views/Onboarding/OnboardingFlow.swift,
// Prototype/OnboardingPrototypeChooseProviderStep.swift, LLMProviderSetupView.swift,
// SetupSidebarView.swift, ScreenRecordingPermissionView.swift, Views/UI/ProgressRingView.swift).
// Upstream's intro video, referral survey, personal goal and hosted plan are left out.

import { useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Shield, Sun } from 'lucide-react'
import { CATEGORY_PRESETS, presetCategories } from '@shared/categories'
import { OLLAMA_BASE_URL, OLLAMA_MODEL, cliOf, providerChoice } from '@shared/providers'
import { type PermissionRow, type ScreenPermission, type WindowCheck, permissionsView } from '@shared/permissions'
import { type CliName, DEFAULT_SETTINGS, type ProviderKind, type Settings } from '@shared/types'
import { CommandBlock, StatusDot } from './SettingsLayout'

type Step = 'intro' | 'role' | 'provider' | 'setup' | 'permissions' | 'done'
/** Filled ring segments per step (upstream OnboardingFlow: 6 segments; the video, referral and goal steps are not ported). */
const RING: Record<Step, number | null> = { intro: null, role: 1, provider: null, setup: 3, permissions: 4, done: 6 }

type Level = 'best' | 'medium' | 'basic'
interface Column {
  id: string
  title: string
  kind: ProviderKind
  flavor: 'api' | 'gemini' | 'cli' | 'local' | 'endpoint'
  accuracy: [Level, string]
  subscription: string
  ease: [Level, string]
  notes: string
}

/** Upstream's comparison table and column order, with columns for the providers this app has. */
const COLUMNS: Column[] = [
  { id: 'codex-cli', title: 'ChatGPT', kind: 'codex-cli', flavor: 'cli', accuracy: ['best', 'Best'], subscription: 'ChatGPT paid subscription', ease: ['medium', 'Install Codex CLI'], notes: 'Uses your ChatGPT subscription and less than 1% of your daily limit.' },
  { id: 'claude-cli', title: 'Claude', kind: 'claude-cli', flavor: 'cli', accuracy: ['best', 'Best'], subscription: 'Claude paid subscription', ease: ['medium', 'Install Claude CLI'], notes: 'Uses your Claude subscription and less than 1% of your daily limit.' },
  { id: 'anthropic', title: 'Anthropic API', kind: 'anthropic', flavor: 'api', accuracy: ['best', 'Best'], subscription: 'API credits', ease: ['medium', 'API key'], notes: 'Claude models through the Anthropic API.' },
  { id: 'gemini', title: 'Gemini', kind: 'gemini', flavor: 'gemini', accuracy: ['medium', 'Medium'], subscription: 'Free', ease: ['medium', 'API key'], notes: 'Uses Gemini free tier.' },
  { id: 'openai', title: 'OpenRouter / Custom', kind: 'openai', flavor: 'endpoint', accuracy: ['medium', 'Varies'], subscription: 'API credits', ease: ['medium', 'API key and model'], notes: 'Uses OpenRouter or any OpenAI-compatible endpoint.' },
  { id: 'local', title: 'Local AI', kind: 'openai', flavor: 'local', accuracy: ['basic', 'Passable'], subscription: 'Free', ease: ['basic', 'Extensive setup'], notes: 'Requires 16GB+ RAM and 4GB free disk space. Ollama or LM Studio.' }
]

const WIZARD: Record<Column['flavor'], string[]> = {
  api: ['Enter API key', 'Test connection', 'Complete'],
  gemini: ['Get API key', 'Enter API key', 'Test connection', 'Complete'],
  cli: ['Before you begin', 'Check installation', 'Test connection', 'Complete'],
  local: ['Before you begin', 'Configure endpoint', 'Test connection', 'Complete'],
  endpoint: ['Configure endpoint', 'Test connection', 'Complete']
}
const WIZARD_TITLE: Record<string, string> = {
  'claude-cli': 'Connect Claude',
  'codex-cli': 'Connect ChatGPT',
  anthropic: 'Connect the Anthropic API',
  gemini: 'Gemini',
  openai: 'Connect an AI endpoint',
  local: 'Use local AI'
}
const CLI_INSTALL: Record<CliName, { install: string; login: string; product: string; subscription: string }> = {
  claude: { install: 'npm install -g @anthropic-ai/claude-code', login: 'claude login', product: 'Claude Code', subscription: 'Claude' },
  codex: { install: 'npm install -g @openai/codex', login: 'codex login', product: 'Codex CLI', subscription: 'ChatGPT' }
}

export function Onboarding({ settings, platform, onDone }: { settings: Settings; platform: string; onDone: () => void }) {
  const [step, setStep] = useState<Step>(resumeStep)
  const [role, setRole] = useState<string | null>(null)
  const [draft, setDraft] = useState(settings)
  const [column, setColumn] = useState<Column | null>(null)

  const save = async (next: Partial<Settings>) => setDraft(await window.dayflow.saveSettings(next))
  const ring = RING[step]

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Set up Dayflow Electron">
      <div className="onb-step" key={step}>
        {step === 'intro' && (
          <div className="onb-center">
            <h2>Your day, as a timeline</h2>
            <div className="onb-text">
              <p>
                Every few seconds the app takes a screenshot of the screen under your mouse. Every 15 minutes an AI model you choose turns them
                into cards that say what you did.
              </p>
              <p className="note">
                Screenshots stay on this computer. Only the provider you pick sees them. There is no telemetry. You can pause any time from the
                tray.
              </p>
            </div>
            <Pill onClick={() => setStep('role')}>Get started</Pill>
          </div>
        )}
        {step === 'role' && (
          <div className="onb-center">
            <h2 className="role-title">Help Dayflow Electron understand your work patterns better.</h2>
            <div className="onb-text">
              <p className="lead">What do you do for work?</p>
              <p className="lead">This will help Dayflow Electron generate categories that are most helpful to you.</p>
            </div>
            <div className="role-chips">
              {Object.keys(CATEGORY_PRESETS).map((r) => (
                <button key={r} className={`role-chip ${role === r ? 'active' : ''}`} aria-pressed={role === r} onClick={() => setRole(r)}>
                  {r}
                </button>
              ))}
            </div>
            {role && <p className="note role-preview">Categories: {presetCategories(role).filter((c) => !c.isIdle).map((c) => c.name).join(', ')}</p>}
            <Pill disabled={!role} onClick={() => role && void save({ categories: presetCategories(role) }).then(() => setStep('provider'))}>
              Continue
            </Pill>
            <BackLink onClick={() => setStep('intro')} />
          </div>
        )}
        {step === 'provider' && (
          <ProviderTable
            onBack={() => setStep('role')}
            onSelect={(c) => {
              setColumn(c)
              void save(providerChoice(c.flavor, c.kind, draft)).then(() => setStep('setup'))
            }}
          />
        )}
        {step === 'setup' && column && (
          <ProviderWizard column={column} draft={draft} save={save} onBack={() => setStep('provider')} onDone={() => setStep('permissions')} />
        )}
        {step === 'permissions' && <Permissions platform={platform} onBack={() => setStep(column ? 'setup' : 'provider')} onNext={() => setStep('done')} />}
        {step === 'done' && (
          <div className="onb-center">
            <span className="onb-logo" aria-hidden="true">
              <Sun size={36} color="#fff" />
            </span>
            <h2 className="done-title">You are ready to go!</h2>
            <p className="onb-done-text">
              To get useful insights, let Dayflow Electron run in the background for an hour or two to gather enough context, then check back in.
            </p>
            <Pill
              onClick={async () => {
                await window.dayflow.completeOnboarding()
                onDone()
              }}
            >
              Launch Dayflow Electron
            </Pill>
            <BackLink onClick={() => setStep('permissions')} />
          </div>
        )}
      </div>
      {ring !== null && <ProgressRing filled={ring} />}
    </div>
  )
}

function Pill({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="onb-pill" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button className="onb-back" onClick={onClick}>
      <ChevronLeft size={14} /> Back
    </button>
  )
}

/** "Choose a way to run Dayflow": providers side by side (upstream OnboardingPrototypeChooseProviderStep). */
function ProviderTable({ onSelect, onBack }: { onSelect: (c: Column) => void; onBack: () => void }) {
  const [installed, setInstalled] = useState<Record<string, boolean>>({})
  useEffect(() => {
    // Like upstream: a CLI that is already there makes that column easy to set up.
    for (const cli of ['claude', 'codex'] as const) void window.dayflow.checkCli(cli).then((r) => setInstalled((m) => ({ ...m, [cli]: r.ok })))
  }, [])
  const ease = (c: Column): [Level, string] => {
    const cli = cliOf(c.kind)
    return cli && installed[cli] ? ['best', 'CLI installed'] : c.ease
  }
  const Rated = ({ value }: { value: [Level, string] }) => (
    <span className="rated">
      <span className={`rating-dot ${value[0]}`} />
      {value[1]}
    </span>
  )
  return (
    <div className="onb-table-step">
      <h2>Choose a way to run Dayflow Electron</h2>
      <div className="onb-table-wrap">
        <div className="onb-table" style={{ gridTemplateColumns: `140px repeat(${COLUMNS.length}, minmax(120px, 1fr))` }}>
          <span />
          {COLUMNS.map((c) => (
            <span key={c.id} className="col-head">
              {c.title}
            </span>
          ))}
          <span className="row-label">Model accuracy</span>
          {COLUMNS.map((c) => (
            <Rated key={c.id} value={c.accuracy} />
          ))}
          <hr />
          <span className="row-label">Subscription requirements</span>
          {COLUMNS.map((c) => (
            <span key={c.id} className="plain">
              {c.subscription}
            </span>
          ))}
          <hr />
          <span className="row-label">Ease of set up</span>
          {COLUMNS.map((c) => (
            <Rated key={c.id} value={ease(c)} />
          ))}
          <hr />
          <span className="row-label">Additional notes</span>
          {COLUMNS.map((c) => (
            <span key={c.id} className="notes">
              {c.notes}
            </span>
          ))}
          <span />
          {COLUMNS.map((c) => (
            <button key={c.id} className="select-pill" onClick={() => onSelect(c)}>
              Select
            </button>
          ))}
        </div>
      </div>
      <BackLink onClick={onBack} />
    </div>
  )
}

type TestResult = { ok: boolean; message: string } | 'running' | null

/** The setup wizard: a step list on the left, one step at a time on the right (upstream LLMProviderSetupView). */
function ProviderWizard(props: { column: Column; draft: Settings; save: (s: Partial<Settings>) => Promise<void>; onBack: () => void; onDone: () => void }) {
  const { column, draft, save } = props
  const steps = WIZARD[column.flavor]
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [key, setKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [test, setTest] = useState<TestResult>(null)
  const [cliCheck, setCliCheck] = useState<TestResult>(null)
  const provider = column.kind
  const local = column.flavor === 'local'
  const cli = cliOf(provider)
  const current = steps[index]!
  const isTest = current === 'Test connection'

  const runCliCheck = () => {
    if (!cli) return
    setCliCheck('running')
    void window.dayflow.checkCli(cli).then(setCliCheck)
  }
  useEffect(() => {
    if (current === 'Check installation') runCliCheck()
    if (isTest) setTest(null)
    // Only when the step changes.
  }, [index])

  /** Stores a typed key under the provider; false (with a message) when the keyring refuses it. */
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
  const runTest = async () => {
    setTest('running')
    if (!(await storeKey())) return setTest(null)
    setTest(await window.dayflow.testProvider().catch((err: unknown) => ({ ok: false, message: String(err) })))
  }

  const canContinue =
    current === 'Enter API key' ? key.trim().length > 20 : current === 'Check installation' ? cliCheck !== 'running' && !!cliCheck?.ok : isTest ? test !== 'running' && !!test?.ok : true
  const last = index === steps.length - 1
  const next = async () => {
    if (current === 'Enter API key' && !(await storeKey())) return
    setDone(new Set(done).add(index))
    if (last) props.onDone()
    else setIndex(index + 1)
  }

  const modelField = (
    <label className="onb-field">
      Model
      <input
        key={provider}
        defaultValue={draft.models[provider]}
        onBlur={(e) => void save({ models: { ...draft.models, [provider]: e.target.value.trim() || (local ? OLLAMA_MODEL : DEFAULT_SETTINGS.models[provider]) } })}
      />
    </label>
  )

  return (
    <div className="onb-wizard">
      <aside className="onb-steps">
        <button className="onb-back" onClick={props.onBack}>
          <ChevronLeft size={14} /> Back
        </button>
        <ol>
          {steps.map((s, i) => (
            <li key={s} className={i === index ? 'current' : done.has(i) ? 'done' : 'upcoming'}>
              <button className="bare" onClick={() => setIndex(i)}>
                {i === index ? <ChevronRight size={14} /> : done.has(i) ? <Check size={14} color="#21A638" /> : null}
                {s}
              </button>
            </li>
          ))}
        </ol>
        <button className="onb-skip" onClick={async () => (await storeKey()) && props.onDone()}>
          Skip for now
        </button>
      </aside>
      <section className="onb-wizard-main">
        <h3>{WIZARD_TITLE[column.id]}</h3>
        <div className="onb-wizard-body">
          {current === 'Get API key' && (
            <>
              <h4>Get your Gemini API key</h4>
              <p>Google AI Studio allows you to run Dayflow Electron for free. All you need is a Google account - no credit card required.</p>
              <ol className="onb-numbered">
                <li>Visit Google AI Studio (aistudio.google.com)</li>
                <li>Click "Get API key"</li>
                <li>Create a new API key and copy it</li>
              </ol>
              <CommandBlock text="https://aistudio.google.com/apikey" label="Copy link" />
            </>
          )}
          {current === 'Enter API key' && (
            <>
              <h4>Enter your API key:</h4>
              <label className="onb-field">
                Paste your {column.title} API key below
                <input type="password" autoComplete="off" placeholder={provider === 'gemini' ? 'AQ...' : 'sk-...'} value={key} onChange={(e) => setKey(e.target.value)} />
              </label>
              {modelField}
              {keyError && <p className="error">{keyError}</p>}
            </>
          )}
          {current === 'Before you begin' && cli && (
            <>
              <p>
                Dayflow Electron uses {CLI_INSTALL[cli].product} through your existing {CLI_INSTALL[cli].subscription} subscription. Install it and sign in
                on this computer, then we'll verify the connection.
              </p>
              <CommandBlock text={CLI_INSTALL[cli].install} />
              <CommandBlock text={CLI_INSTALL[cli].login} />
              <p className="note">In the Flatpak, the app also needs a one-time permission to start it; the next step shows the command.</p>
            </>
          )}
          {current === 'Before you begin' && !cli && (
            <>
              <h4>For experienced users</h4>
              <p>
                Run a model on this computer with Ollama or LM Studio. The app sends one small request per screenshot, so a vision model and a
                fast machine help. Expect lower quality than the hosted models.
              </p>
              <CommandBlock text={`ollama pull ${OLLAMA_MODEL}`} />
            </>
          )}
          {current === 'Check installation' && cli && (
            <>
              <p>Checking for the {cli} CLI on this computer.</p>
              <p className={`onb-status ${cliCheck === 'running' || !cliCheck ? '' : cliCheck.ok ? 'ok' : 'bad'}`}>
                <span className="dot" />
                {cliCheck === 'running' || !cliCheck ? 'Checking…' : cliCheck.message}
              </p>
              {modelField}
              <button className="btn-ink" onClick={runCliCheck} disabled={cliCheck === 'running'}>
                Check
              </button>
            </>
          )}
          {current === 'Configure endpoint' && (
            <>
              <label className="onb-field">
                Base URL <em>(e.g. http://localhost:11434/v1 for Ollama, http://localhost:1234/v1 for LM Studio)</em>
                <input defaultValue={draft.openaiBaseUrl} onBlur={(e) => void save({ openaiBaseUrl: e.target.value.trim() || (local ? OLLAMA_BASE_URL : DEFAULT_SETTINGS.openaiBaseUrl) })} />
              </label>
              {modelField}
              {column.flavor === 'endpoint' && (
                <label className="onb-field">
                  API key <em>(not needed for local servers)</em>
                  <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
                </label>
              )}
              {keyError && <p className="error">{keyError}</p>}
            </>
          )}
          {isTest && (
            <>
              <h4>Test Connection</h4>
              <p>{cli ? "We'll ask your CLI a simple question to verify it's working and signed in." : `Click the button below to verify that ${column.title} works.`}</p>
              <button className="btn-ink" disabled={test === 'running'} onClick={() => void runTest()}>
                {test === 'running' ? 'Testing…' : 'Test connection'}
              </button>
              {test && test !== 'running' && (
                <p className={`onb-status ${test.ok ? 'ok' : 'bad'}`}>
                  <span className="dot" />
                  {test.ok ? 'Connection successful.' : test.message}
                </p>
              )}
            </>
          )}
          {current === 'Complete' && (
            <>
              <h4>All set!</h4>
              <p>{column.title} is now configured and ready to use with Dayflow Electron.</p>
            </>
          )}
        </div>
        <button className="onb-next" disabled={!canContinue} onClick={() => void next()}>
          {last ? 'Complete setup' : isTest && !(test && test !== 'running' && test.ok) ? 'Test Required' : (
            <>
              Next <ChevronRight size={14} />
            </>
          )}
        </button>
      </section>
    </div>
  )
}

/** Set before Quit and Reopen, so the restarted app comes back to the Permissions step (upstream keeps the step too). */
const RESUME_KEY = 'onboardingResume'

function resumeStep(): Step {
  try {
    const step = localStorage.getItem(RESUME_KEY)
    localStorage.removeItem(RESUME_KEY)
    return step === 'permissions' ? 'permissions' : 'intro'
  } catch {
    return 'intro'
  }
}

/**
 * "Permissions": one row per permission recording needs here, with its live
 * state and a Grant button (upstream ScreenRecordingPermissionView,
 * SystemPermissionRow). The rows and whether Next is enabled come from
 * permissionsView (src/shared/permissions.ts).
 */
function Permissions({ platform, onBack, onNext }: { platform: string; onBack: () => void; onNext: () => void }) {
  const [screen, setScreen] = useState<ScreenPermission | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [windowCheck, setWindowCheck] = useState<WindowCheck>(CHECKING_WINDOW)

  // macOS: re-check twice a second while the user is in System Settings (upstream SystemPermissionsMonitor).
  useEffect(() => {
    let live = true
    const load = () => void window.dayflow.getScreenPermission().then((p) => live && setScreen(p))
    load()
    const timer = platform === 'darwin' ? setInterval(load, 500) : undefined
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [platform])

  const [windowRun, setWindowRun] = useState(0)
  useEffect(() => {
    if (platform !== 'linux') return
    let live = true
    setWindowCheck(CHECKING_WINDOW)
    void window.dayflow.checkWindowDetection().then((c) => live && setWindowCheck(c))
    return () => {
      live = false
    }
  }, [platform, windowRun])

  const grant = async () => {
    setBusy(true)
    setError(null)
    const result = await window.dayflow.requestScreenPermission()
    setBusy(false)
    if (!result.ok) setError(result.message)
    setScreen(await window.dayflow.getScreenPermission())
  }
  const relaunch = () => {
    try {
      localStorage.setItem(RESUME_KEY, 'permissions')
    } catch {
      // Without storage the app restarts at the beginning of the setup.
    }
    void window.dayflow.relaunch()
  }

  const view = permissionsView({ platform, screen: screen?.screen ?? null, requested: screen?.requested ?? false, busy, error, window: windowCheck })
  return (
    <div className={`onb-perms ${platform === 'darwin' ? '' : 'single'}`}>
      <div className="onb-perms-left">
        <span className="last-step">Last step!</span>
        <h3>Permissions</h3>
        <p className="muted">Dayflow Electron can help understand your day.</p>
        <div className="privacy-box">
          <b>
            <Shield size={14} /> Dayflow Electron is built to be private and secure.
          </b>
          <p>Dayflow Electron stores all recordings locally on your computer and sends screenshots only to the AI provider you chose.</p>
          <p>You are always in control. You can pause or turn off Dayflow Electron whenever you like.</p>
        </div>
        {view.rows.map((r) => (
          <PermissionCard key={r.id} row={r} onGrant={() => void grant()} onRelaunch={relaunch} onRecheck={() => setWindowRun((n) => n + 1)} />
        ))}
      </div>
      {platform === 'darwin' && (
        // A picture of macOS's Screen Recording list next to the rows, like upstream's; not controls.
        <figure className="onb-perms-mock" aria-hidden="true">
          <div className="mock-window">
            <div className="mock-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="mock-row highlight">
              <span className="mock-icon" />
              Dayflow Electron
              <span className="mock-toggle on" />
            </div>
            <div className="mock-row">
              <span className="mock-icon" />
              Browser
              <span className="mock-toggle" />
            </div>
            <div className="mock-row">
              <span className="mock-icon" />
              Terminal
              <span className="mock-toggle" />
            </div>
          </div>
          <figcaption>Example: System Settings → Privacy &amp; Security → Screen Recording</figcaption>
        </figure>
      )}
      <div className="onb-perms-actions">
        {view.skippable && (
          <button className="onb-skip" onClick={onNext}>
            Skip for now
          </button>
        )}
        <button className="onb-secondary" onClick={onBack}>
          Back
        </button>
        <button className="onb-next static" disabled={!view.canContinue} onClick={onNext}>
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

const CHECKING_WINDOW: WindowCheck = { state: 'checking', reason: null, command: null }

/** One permission: title, detail and state, with Grant (and Quit and Reopen) on the right (upstream SystemPermissionRow). */
function PermissionCard({ row, onGrant, onRelaunch, onRecheck }: { row: PermissionRow; onGrant: () => void; onRelaunch: () => void; onRecheck: () => void }) {
  const hasControls = !!row.status || row.actions.length > 0
  return (
    <div className="perm-row">
      <div className="perm-text">
        <b>{row.title}</b>
        <span>{row.detail}</span>
        {row.note && <span className="perm-note">{row.note}</span>}
      </div>
      {hasControls && (
        <div className="perm-controls">
          {row.status && <StatusDot kind={row.status.kind}>{row.status.label}</StatusDot>}
          {row.actions.includes('grant') && (
            <button className="perm-grant" disabled={row.busy} onClick={onGrant}>
              {row.busy ? 'Waiting…' : 'Grant'}
            </button>
          )}
          {row.actions.includes('recheck') && (
            <button className="perm-grant" onClick={onRecheck}>
              Check again
            </button>
          )}
          {row.actions.includes('relaunch') && (
            <button className="perm-link" onClick={onRelaunch}>
              Quit and Reopen
            </button>
          )}
        </div>
      )}
      {row.command && <CommandBlock text={row.command} />}
    </div>
  )
}

/** Six segments filling up with the steps, the share in the middle (upstream ProgressRingView). */
function ProgressRing({ filled }: { filled: number }) {
  const total = 6
  const r = 34
  const c = 2 * Math.PI * r
  const seg = ((1 - 0.035 * total) / total) * c
  return (
    <div className="onb-ring" aria-label={`Setup ${Math.round((filled / total) * 100)}% done`} role="img">
      <svg width="76" height="76" viewBox="0 0 76 76">
        {Array.from({ length: total }, (_, i) => (
          <circle
            key={i}
            cx="38"
            cy="38"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className={i < filled ? 'on' : ''}
            style={{ transitionDelay: `${i * 0.07}s` }}
            strokeDasharray={`${seg} ${c - seg}`}
            transform={`rotate(${(i / total) * 360 - 90} 38 38)`}
          />
        ))}
      </svg>
      <span key={filled}>{Math.round((filled / total) * 100)}%</span>
    </div>
  )
}
