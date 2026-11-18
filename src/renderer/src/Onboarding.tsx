// First-run setup, after upstream's onboarding (Views/Onboarding/OnboardingFlow.swift,
// Prototype/OnboardingPrototypeChooseProviderStep.swift, LLMProviderSetupView.swift,
// SetupSidebarView.swift, ScreenRecordingPermissionView.swift, Views/UI/ProgressRingView.swift).
// Upstream's intro video, referral survey, personal goal and hosted plan are left out.

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronLeft, ChevronRight, Shield, Sun } from 'lucide-react'
import { CATEGORY_PRESETS, presetCategories } from '@shared/categories'
import { OLLAMA_BASE_URL, OLLAMA_MODEL, cliOf, providerChoice } from '@shared/providers'
import { type CliName, DEFAULT_SETTINGS, type ProviderKind, type Settings } from '@shared/types'
import { CommandBlock, StatusDot } from './SettingsLayout'
import { PermissionCards, usePermissions } from './PermissionRows'

type Step = 'intro' | 'role' | 'provider' | 'setup' | 'permissions' | 'done'
/** Filled ring segments per step (upstream OnboardingFlow: 6 segments; the video, referral and goal steps are not ported). */
const RING: Record<Step, number | null> = { intro: null, role: 1, provider: null, setup: 3, permissions: 4, done: 6 }

type Level = 'best' | 'medium' | 'basic'
/** A rating dot and the key of its label (onboarding.table.ratings.*). */
type Rating = [Level, 'best' | 'medium' | 'varies' | 'passable' | 'installCodex' | 'installClaude' | 'apiKey' | 'apiKeyAndModel' | 'extensiveSetup' | 'cliInstalled']
/** A column of the table; its texts are onboarding.table.columns.<id>.* (title, subscription, notes) and onboarding.wizard.titles.<id>. */
interface Column {
  id: 'chatgpt' | 'claude' | 'anthropic' | 'gemini' | 'custom' | 'local'
  kind: ProviderKind
  flavor: 'api' | 'gemini' | 'cli' | 'local' | 'endpoint'
  accuracy: Rating
  ease: Rating
}

/** Upstream's comparison table and column order, with columns for the providers this app has. */
const COLUMNS: Column[] = [
  { id: 'chatgpt', kind: 'codex-cli', flavor: 'cli', accuracy: ['best', 'best'], ease: ['medium', 'installCodex'] },
  { id: 'claude', kind: 'claude-cli', flavor: 'cli', accuracy: ['best', 'best'], ease: ['medium', 'installClaude'] },
  { id: 'anthropic', kind: 'anthropic', flavor: 'api', accuracy: ['best', 'best'], ease: ['medium', 'apiKey'] },
  { id: 'gemini', kind: 'gemini', flavor: 'gemini', accuracy: ['medium', 'medium'], ease: ['medium', 'apiKey'] },
  { id: 'custom', kind: 'openai', flavor: 'endpoint', accuracy: ['medium', 'varies'], ease: ['medium', 'apiKeyAndModel'] },
  { id: 'local', kind: 'openai', flavor: 'local', accuracy: ['basic', 'passable'], ease: ['basic', 'extensiveSetup'] }
]

/** The wizard's steps; their names are onboarding.wizard.steps.*. */
type WizardStep = 'getKey' | 'enterKey' | 'test' | 'complete' | 'beforeBegin' | 'checkInstall' | 'endpoint'
const WIZARD: Record<Column['flavor'], WizardStep[]> = {
  api: ['enterKey', 'test', 'complete'],
  gemini: ['getKey', 'enterKey', 'test', 'complete'],
  cli: ['beforeBegin', 'checkInstall', 'test', 'complete'],
  local: ['beforeBegin', 'endpoint', 'test', 'complete'],
  endpoint: ['endpoint', 'test', 'complete']
}
/** The role presets (English keys of CATEGORY_PRESETS, which stay the stored data) and their text keys. */
const ROLE_KEYS: Record<string, 'softwareEngineer' | 'founder' | 'designer' | 'student' | 'productManager' | 'dataScientist' | 'other'> = {
  'Software Engineer': 'softwareEngineer',
  'Founder / Executive': 'founder',
  Designer: 'designer',
  Student: 'student',
  'Product Manager': 'productManager',
  'Data Scientist': 'dataScientist',
  Other: 'other'
}
const CLI_INSTALL: Record<CliName, { install: string; login: string; product: string; subscription: string }> = {
  claude: { install: 'npm install -g @anthropic-ai/claude-code', login: 'claude login', product: 'Claude Code', subscription: 'Claude' },
  codex: { install: 'npm install -g @openai/codex', login: 'codex login', product: 'Codex CLI', subscription: 'ChatGPT' }
}

export function Onboarding({ settings, platform, onDone }: { settings: Settings; platform: string; onDone: () => void }) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(resumeStep)
  const [role, setRole] = useState<string | null>(null)
  const [draft, setDraft] = useState(settings)
  const [column, setColumn] = useState<Column | null>(null)

  const save = async (next: Partial<Settings>) => setDraft(await window.dayflow.saveSettings(next))
  const ring = RING[step]

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label={t('onboarding.dialogLabel')}>
      <div className="onb-step" key={step}>
        {step === 'intro' && (
          <div className="onb-center">
            <h2>{t('onboarding.intro.title')}</h2>
            <div className="onb-text">
              <p>{t('onboarding.intro.body')}</p>
              <p className="note">{t('onboarding.intro.privacy')}</p>
            </div>
            <Pill onClick={() => setStep('role')}>{t('onboarding.intro.start')}</Pill>
          </div>
        )}
        {step === 'role' && (
          <div className="onb-center">
            <h2 className="role-title">{t('onboarding.role.title')}</h2>
            <div className="onb-text">
              <p className="lead">{t('onboarding.role.question')}</p>
              <p className="lead">{t('onboarding.role.why')}</p>
            </div>
            <div className="role-chips">
              {Object.keys(CATEGORY_PRESETS).map((r) => (
                <button key={r} className={`role-chip ${role === r ? 'active' : ''}`} aria-pressed={role === r} onClick={() => setRole(r)}>
                  {ROLE_KEYS[r] ? t(`onboarding.role.roles.${ROLE_KEYS[r]}`) : r}
                </button>
              ))}
            </div>
            {role && (
              <p className="note role-preview">
                {t('onboarding.role.preview', { categories: presetCategories(role).filter((c) => !c.isIdle).map((c) => c.name).join(', ') })}
              </p>
            )}
            <Pill disabled={!role} onClick={() => role && void save({ categories: presetCategories(role) }).then(() => setStep('provider'))}>
              {t('common.continue')}
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
            <h2 className="done-title">{t('onboarding.done.title')}</h2>
            <p className="onb-done-text">{t('onboarding.done.body')}</p>
            <Pill
              onClick={async () => {
                await window.dayflow.completeOnboarding()
                onDone()
              }}
            >
              {t('onboarding.done.launch')}
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
  const { t } = useTranslation()
  return (
    <button className="onb-back" onClick={onClick}>
      <ChevronLeft size={14} /> {t('common.back')}
    </button>
  )
}

/** "Choose a way to run Dayflow": providers side by side (upstream OnboardingPrototypeChooseProviderStep). */
function ProviderTable({ onSelect, onBack }: { onSelect: (c: Column) => void; onBack: () => void }) {
  const { t } = useTranslation()
  const [installed, setInstalled] = useState<Record<string, boolean>>({})
  useEffect(() => {
    // Like upstream: a CLI that is already there makes that column easy to set up.
    for (const cli of ['claude', 'codex'] as const) void window.dayflow.checkCli(cli).then((r) => setInstalled((m) => ({ ...m, [cli]: r.ok })))
  }, [])
  const ease = (c: Column): Rating => {
    const cli = cliOf(c.kind)
    return cli && installed[cli] ? ['best', 'cliInstalled'] : c.ease
  }
  const Rated = ({ value }: { value: Rating }) => (
    <span className="rated">
      <span className={`rating-dot ${value[0]}`} />
      {t(`onboarding.table.ratings.${value[1]}`)}
    </span>
  )
  return (
    <div className="onb-table-step">
      <h2>{t('onboarding.table.title')}</h2>
      <div className="onb-table-wrap">
        <div className="onb-table" style={{ gridTemplateColumns: `140px repeat(${COLUMNS.length}, minmax(120px, 1fr))` }}>
          <span />
          {COLUMNS.map((c) => (
            <span key={c.id} className="col-head">
              {t(`onboarding.table.columns.${c.id}.title`)}
            </span>
          ))}
          <span className="row-label">{t('onboarding.table.accuracy')}</span>
          {COLUMNS.map((c) => (
            <Rated key={c.id} value={c.accuracy} />
          ))}
          <hr />
          <span className="row-label">{t('onboarding.table.subscription')}</span>
          {COLUMNS.map((c) => (
            <span key={c.id} className="plain">
              {t(`onboarding.table.columns.${c.id}.subscription`)}
            </span>
          ))}
          <hr />
          <span className="row-label">{t('onboarding.table.ease')}</span>
          {COLUMNS.map((c) => (
            <Rated key={c.id} value={ease(c)} />
          ))}
          <hr />
          <span className="row-label">{t('onboarding.table.notes')}</span>
          {COLUMNS.map((c) => (
            <span key={c.id} className="notes">
              {t(`onboarding.table.columns.${c.id}.notes`)}
            </span>
          ))}
          <span />
          {COLUMNS.map((c) => (
            <button key={c.id} className="select-pill" onClick={() => onSelect(c)}>
              {t('onboarding.table.select')}
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
  const { t } = useTranslation()
  const { column, draft, save } = props
  const title = t(`onboarding.table.columns.${column.id}.title`)
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
  const isTest = current === 'test'

  const runCliCheck = () => {
    if (!cli) return
    setCliCheck('running')
    void window.dayflow.checkCli(cli).then(setCliCheck)
  }
  useEffect(() => {
    if (current === 'checkInstall') runCliCheck()
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
    current === 'enterKey' ? key.trim().length > 20 : current === 'checkInstall' ? cliCheck !== 'running' && !!cliCheck?.ok : isTest ? test !== 'running' && !!test?.ok : true
  const last = index === steps.length - 1
  const next = async () => {
    if (current === 'enterKey' && !(await storeKey())) return
    setDone(new Set(done).add(index))
    if (last) props.onDone()
    else setIndex(index + 1)
  }

  const modelField = (
    <label className="onb-field">
      {t('onboarding.wizard.model')}
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
          <ChevronLeft size={14} /> {t('common.back')}
        </button>
        <ol>
          {steps.map((s, i) => (
            <li key={s} className={i === index ? 'current' : done.has(i) ? 'done' : 'upcoming'}>
              <button className="bare" onClick={() => setIndex(i)}>
                {i === index ? <ChevronRight size={14} /> : done.has(i) ? <Check size={14} color="#21A638" /> : null}
                {t(`onboarding.wizard.steps.${s}`)}
              </button>
            </li>
          ))}
        </ol>
        <button className="onb-skip" onClick={async () => (await storeKey()) && props.onDone()}>
          {t('onboarding.skip')}
        </button>
      </aside>
      <section className="onb-wizard-main">
        <h3>{t(`onboarding.wizard.titles.${column.id}`)}</h3>
        <div className="onb-wizard-body">
          {current === 'getKey' && (
            <>
              <h4>{t('onboarding.wizard.gemini.title')}</h4>
              <p>{t('onboarding.wizard.gemini.body')}</p>
              <ol className="onb-numbered">
                <li>{t('onboarding.wizard.gemini.step1')}</li>
                <li>{t('onboarding.wizard.gemini.step2')}</li>
                <li>{t('onboarding.wizard.gemini.step3')}</li>
              </ol>
              <CommandBlock text="https://aistudio.google.com/apikey" label={t('onboarding.wizard.gemini.copyLink')} />
            </>
          )}
          {current === 'enterKey' && (
            <>
              <h4>{t('onboarding.wizard.enterKey.title')}</h4>
              <label className="onb-field">
                {t('onboarding.wizard.enterKey.paste', { provider: title })}
                <input type="password" autoComplete="off" placeholder={provider === 'gemini' ? 'AQ...' : 'sk-...'} value={key} onChange={(e) => setKey(e.target.value)} />
              </label>
              {modelField}
              {keyError && <p className="error">{keyError}</p>}
            </>
          )}
          {current === 'beforeBegin' && cli && (
            <>
              <p>{t('onboarding.wizard.cli.intro', { product: CLI_INSTALL[cli].product, subscription: CLI_INSTALL[cli].subscription })}</p>
              <CommandBlock text={CLI_INSTALL[cli].install} />
              <CommandBlock text={CLI_INSTALL[cli].login} />
              <p className="note">{t('onboarding.wizard.cli.flatpak')}</p>
            </>
          )}
          {current === 'beforeBegin' && !cli && (
            <>
              <h4>{t('onboarding.wizard.local.title')}</h4>
              <p>{t('onboarding.wizard.local.body')}</p>
              <CommandBlock text={`ollama pull ${OLLAMA_MODEL}`} />
            </>
          )}
          {current === 'checkInstall' && cli && (
            <>
              <p>{t('onboarding.wizard.cli.checking', { cli })}</p>
              <p className={`onb-status ${cliCheck === 'running' || !cliCheck ? '' : cliCheck.ok ? 'ok' : 'bad'}`}>
                <span className="dot" />
                {cliCheck === 'running' || !cliCheck ? t('onboarding.wizard.checking') : cliCheck.message}
              </p>
              {modelField}
              <button className="btn-ink" onClick={runCliCheck} disabled={cliCheck === 'running'}>
                {t('onboarding.wizard.cli.check')}
              </button>
            </>
          )}
          {current === 'endpoint' && (
            <>
              <label className="onb-field">
                {t('onboarding.wizard.endpoint.baseUrl')} <em>{t('onboarding.wizard.endpoint.baseUrlHint')}</em>
                <input defaultValue={draft.openaiBaseUrl} onBlur={(e) => void save({ openaiBaseUrl: e.target.value.trim() || (local ? OLLAMA_BASE_URL : DEFAULT_SETTINGS.openaiBaseUrl) })} />
              </label>
              {modelField}
              {column.flavor === 'endpoint' && (
                <label className="onb-field">
                  {t('onboarding.wizard.endpoint.apiKey')} <em>{t('onboarding.wizard.endpoint.apiKeyHint')}</em>
                  <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
                </label>
              )}
              {keyError && <p className="error">{keyError}</p>}
            </>
          )}
          {isTest && (
            <>
              <h4>{t('onboarding.wizard.test.title')}</h4>
              <p>{cli ? t('onboarding.wizard.test.cli') : t('onboarding.wizard.test.api', { provider: title })}</p>
              <button className="btn-ink" disabled={test === 'running'} onClick={() => void runTest()}>
                {test === 'running' ? t('onboarding.wizard.test.testing') : t('onboarding.wizard.test.button')}
              </button>
              {test && test !== 'running' && (
                <p className={`onb-status ${test.ok ? 'ok' : 'bad'}`}>
                  <span className="dot" />
                  {test.ok ? t('onboarding.wizard.test.success') : test.message}
                </p>
              )}
            </>
          )}
          {current === 'complete' && (
            <>
              <h4>{t('onboarding.wizard.complete.title')}</h4>
              <p>{t('onboarding.wizard.complete.body', { provider: title })}</p>
            </>
          )}
        </div>
        <button className="onb-next" disabled={!canContinue} onClick={() => void next()}>
          {last ? t('onboarding.wizard.completeSetup') : isTest && !(test && test !== 'running' && test.ok) ? t('onboarding.wizard.testRequired') : (
            <>
              {t('common.next')} <ChevronRight size={14} />
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
  const { t } = useTranslation()
  const view = usePermissions(platform, () => {
    try {
      localStorage.setItem(RESUME_KEY, 'permissions')
    } catch {
      // Without storage the app restarts at the beginning of the setup.
    }
  })
  return (
    <div className={`onb-perms ${platform === 'darwin' ? '' : 'single'}`}>
      <div className="onb-perms-left">
        <span className="last-step">{t('onboarding.permissions.lastStep')}</span>
        <h3>{t('onboarding.permissions.title')}</h3>
        <p className="muted">{t('onboarding.permissions.intro')}</p>
        <div className="privacy-box">
          <b>
            <Shield size={14} /> {t('onboarding.permissions.privateTitle')}
          </b>
          <p>{t('onboarding.permissions.privateLocal')}</p>
          <p>{t('onboarding.permissions.privateControl')}</p>
        </div>
        <PermissionCards permissions={view} />
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
              {t('onboarding.permissions.mockBrowser')}
              <span className="mock-toggle" />
            </div>
            <div className="mock-row">
              <span className="mock-icon" />
              {t('onboarding.permissions.mockTerminal')}
              <span className="mock-toggle" />
            </div>
          </div>
          <figcaption>{t('onboarding.permissions.mockCaption')}</figcaption>
        </figure>
      )}
      <div className="onb-perms-actions">
        {view.skippable && (
          <button className="onb-skip" onClick={onNext}>
            {t('onboarding.skip')}
          </button>
        )}
        <button className="onb-secondary" onClick={onBack}>
          {t('common.back')}
        </button>
        <button className="onb-next static" disabled={!view.canContinue} onClick={onNext}>
          {t('common.next')} <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

/** Six segments filling up with the steps, the share in the middle (upstream ProgressRingView). */
function ProgressRing({ filled }: { filled: number }) {
  const { t } = useTranslation()
  const total = 6
  const r = 34
  const c = 2 * Math.PI * r
  const seg = ((1 - 0.035 * total) / total) * c
  return (
    <div className="onb-ring" aria-label={t('onboarding.ringLabel', { percent: Math.round((filled / total) * 100) })} role="img">
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
