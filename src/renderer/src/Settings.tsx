import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { numberLabel } from '@shared/i18n'
import { ArrowRight, Download, FolderOpen, RotateCw } from 'lucide-react'
import { CATEGORY_PRESETS, type Category, presetCategories } from '@shared/categories'
import { todayKey } from '@shared/day'
import { type AppLanguage, LANGUAGES } from '@shared/languages'
import { cliOf, needsApiKey } from '@shared/providers'
import type { UpdateMode } from '@shared/updates'
import { type AppStatus, CAPTURE_INTERVALS, type CliName, type ProviderKind, type Settings, type Theme } from '@shared/types'
import type { UiStyle } from '@shared/ui-style'
import { AgentAccessSettings } from './AgentAccessSettings'
import { Row, Section, StatusDot } from './SettingsLayout'
import { SupportSettings } from './SupportSettings'
import { providerChoices } from './providers'
import { applyUiStyle } from './ui-style'

/** Upstream's Settings tabs that the port has (Settings/SettingsView.swift); "categories" opens Other at the category list. */
export type SettingsTab = 'providers' | 'storage' | 'privacy' | 'agents' | 'export' | 'other' | 'categories'
const TABS: Array<Exclude<SettingsTab, 'categories'>> = ['storage', 'privacy', 'providers', 'agents', 'export', 'other']

/** CATEGORY_PRESETS' role names (stored in English) and their text keys. */
const ROLE_KEYS: Record<string, string> = {
  'Software Engineer': 'softwareEngineer',
  'Founder / Executive': 'founder',
  Designer: 'designer',
  Student: 'student',
  'Product Manager': 'productManager',
  'Data Scientist': 'dataScientist',
  Other: 'other'
}

/** Upstream's sidebar footer links its release notes; ours are the GitHub releases. */
const RELEASE_NOTES_URL = 'https://github.com/kokuwaio/dayflow-electron/releases'
const gb = (bytes: number) => numberLabel(bytes / 1024 ** 3, 2)
type Save = (next: Partial<Settings>) => void

export function SettingsView({ status, tab, onTab }: { status: AppStatus | null; tab: SettingsTab; onTab: (tab: SettingsTab) => void }) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<Settings | null>(null)
  const nav = useRef<HTMLDivElement>(null)
  const [pillTop, setPillTop] = useState(0)
  const current = tab === 'categories' ? 'other' : tab
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => void window.dayflow.getVersion().then(setVersion), [])

  // Reloaded when something else changes them too (an agent's category edit), so a later save
  // here never writes an old category list back.
  useEffect(() => {
    const load = () => void window.dayflow.getSettings().then(setSettings)
    load()
    return window.dayflow.onCardsChanged(load)
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
      <nav className="settings-nav" ref={nav} aria-label={t('settings.sections')}>
        <h1>{t('settings.title')}</h1>
        <span className="tab-pill" style={{ transform: `translateY(${pillTop}px)`, top: 0 }} />
        {TABS.map((id) => (
          <button key={id} data-tab={id} className={`tab ${current === id ? 'active' : ''}`} aria-current={current === id ? 'page' : undefined} onClick={() => onTab(id)}>
            {t(`settings.tabs.${id}`)}
          </button>
        ))}
        <div className="settings-version">
          {version && <span>{t('settings.version', { version })}</span>}
          <a href={RELEASE_NOTES_URL} target="_blank" rel="noreferrer">
            {t('settings.releaseNotes')}
          </a>
        </div>
      </nav>
      <div className="settings-content">
        <div className="settings-tab" key={current}>
          {current === 'providers' && <ProvidersTab settings={settings} status={status} save={save} />}
          {current === 'storage' && <StorageTab settings={settings} status={status} save={save} />}
          {current === 'privacy' && <PrivacyTab settings={settings} status={status} save={save} />}
          {current === 'agents' && <AgentAccessSettings settings={settings} save={save} />}
          {current === 'export' && <ExportTab />}
          {current === 'other' && <OtherTab settings={settings} save={save} />}
        </div>
      </div>
    </div>
  )
}

function ProvidersTab({ settings, status, save }: { settings: Settings; status: AppStatus | null; save: Save }) {
  const { t } = useTranslation()
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
      setKeyMessage(key.trim() ? t('settings.providers.keySaved') : t('settings.providers.keyRemoved'))
      setKeys((await window.dayflow.getStatus()).keys)
    } catch (err) {
      setKeyMessage(String(err))
    }
  }

  return (
    <>
      <Section title={t('settings.providers.title')} sub={t('settings.providers.sub')}>
        <div className="provider-list" role="radiogroup" aria-label={t('settings.providers.provider')}>
          {providerChoices().map((p) => (
            <label key={p.kind} className={`provider ${provider === p.kind ? 'active' : ''}`}>
              <input type="radio" name="provider" checked={provider === p.kind} onChange={() => (save({ provider: p.kind }), setTest(null))} />
              <div>
                <strong>{p.label}</strong>
                <br />
                <span>{p.hint}</span>
              </div>
              {provider === p.kind && <span className="badge">{t('settings.providers.inUse')}</span>}
            </label>
          ))}
        </div>
        <Row label={t('settings.providers.model')} grow>
          <input key={provider} defaultValue={settings.models[provider]} onBlur={(e) => save({ models: { ...settings.models, [provider]: e.target.value } })} />
        </Row>
        {provider === 'openai' && (
          <Row label={t('settings.providers.baseUrl')} sub={t('settings.providers.baseUrlSub')} grow>
            <input defaultValue={settings.openaiBaseUrl} onBlur={(e) => save({ openaiBaseUrl: e.target.value })} />
          </Row>
        )}
        {cliOf(provider) && <CliSetup cli={cliOf(provider)!} settings={settings} save={save} />}
        {(needsApiKey(provider, settings.openaiBaseUrl) || provider === 'openai') && (
          <Row
            label={t('settings.providers.apiKey')}
            sub={keyMessage ?? (keys?.[provider] ? <StatusDot kind="good">{t('settings.providers.keyStored')}</StatusDot> : <StatusDot kind="warn">{t('settings.providers.keyNotSet')}</StatusDot>)}
            grow
          >
            <input
              type="password"
              aria-label={t('settings.providers.apiKey')}
              autoComplete="off"
              placeholder={keys?.[provider] ? t('settings.providers.keyReplacePlaceholder') : t('settings.providers.keyPlaceholder')}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn-ink" onClick={() => void saveKey()}>
              {key.trim() || !keys?.[provider] ? t('settings.providers.saveKey') : t('settings.providers.removeKey')}
            </button>
          </Row>
        )}
        <Row
          label={t('settings.providers.connection')}
          sub={
            test === 'running' ? (
              t('settings.providers.asking')
            ) : test ? (
              <StatusDot kind={test.ok ? 'good' : 'bad'}>{test.message}</StatusDot>
            ) : (
              t('settings.providers.connectionSub')
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
            {t('settings.providers.testConnection')}
          </button>
        </Row>
        <Row label={t('settings.providers.fallback')} sub={t('settings.providers.fallbackSub')}>
          <select value={settings.fallbackProvider ?? ''} onChange={(e) => save({ fallbackProvider: (e.target.value || null) as ProviderKind | null })}>
            <option value="">{t('settings.providers.none')}</option>
            {providerChoices().filter((p) => p.kind !== provider).map((p) => (
              <option key={p.kind} value={p.kind}>
                {needsApiKey(p.kind, settings.openaiBaseUrl) && !keys?.[p.kind]
                  ? t('settings.providers.fallbackOptionNoKey', { provider: p.label, model: settings.models[p.kind] })
                  : t('settings.providers.fallbackOption', { provider: p.label, model: settings.models[p.kind] })}
              </option>
            ))}
          </select>
        </Row>
        <LanguageRow settings={settings} save={save} />
      </Section>

      <Section title={t('settings.prompt.title')} sub={t('settings.prompt.sub')}>
        {(['title', 'summary', 'detailedSummary'] as const).map((field) => (
          <Row key={field} label={t(`settings.prompt.fields.${field}`)} stack>
            <textarea
              rows={4}
              placeholder={t('settings.prompt.placeholder')}
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
  const { t } = useTranslation()
  const [value, setValue] = useState(settings.outputLanguage)
  useEffect(() => setValue(settings.outputLanguage), [settings.outputLanguage])
  return (
    <Row label={t('settings.providers.outputLanguage')} sub={t('settings.providers.outputLanguageSub')} grow>
      <input placeholder={t('settings.providers.outputLanguagePlaceholder')} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => save({ outputLanguage: value })} />
      <button className="btn-subtle" onClick={() => save({ outputLanguage: value })}>
        {t('common.save')}
      </button>
      <button className="btn-subtle" disabled={!settings.outputLanguage} onClick={() => (setValue(''), save({ outputLanguage: '' }))}>
        {t('common.reset')}
      </button>
    </Row>
  )
}

/** Where the agent CLI is and whether the app may start it on the host. */
function CliSetup({ cli, settings, save }: { cli: CliName; settings: Settings; save: Save }) {
  const { t } = useTranslation()
  const [check, setCheck] = useState<{ ok: boolean; message: string } | 'running' | null>(null)
  // Check right away, so a missing permission or install shows without a click.
  useEffect(() => {
    setCheck('running')
    void window.dayflow.checkCli(cli).then(setCheck)
  }, [cli])
  return (
    <>
      <Row label={t('settings.providers.cliPath', { cli })} sub={t('settings.providers.cliPathSub')} grow>
        <input
          key={cli}
          placeholder={t('settings.providers.cliPathPlaceholder', { cli })}
          defaultValue={settings.cliPaths[cli]}
          onBlur={(e) => save({ cliPaths: { ...settings.cliPaths, [cli]: e.target.value } })}
        />
      </Row>
      <Row
        label={t('settings.providers.cliLabel', { cli })}
        sub={
          <>
            {check === 'running' ? t('settings.providers.looking') : check ? <StatusDot kind={check.ok ? 'good' : 'bad'}>{check.message}</StatusDot> : null}
            <br />
            {t('settings.providers.cliSub', { cli, vendor: cli === 'claude' ? 'Anthropic' : 'OpenAI' })}
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
          {t('settings.providers.checkCli', { cli })}
        </button>
      </Row>
    </>
  )
}

function StorageTab({ settings, status, save }: { settings: Settings; status: AppStatus | null; save: Save }) {
  const { t } = useTranslation()
  return (
    <>
      <Section title={t('settings.storage.recording')} sub={t('settings.storage.recordingSub')}>
        <Row label={t('settings.storage.frequency')} sub={t('settings.storage.frequencySub')}>
          <select value={settings.captureIntervalSec} onChange={(e) => save({ captureIntervalSec: Number(e.target.value) })}>
            {CAPTURE_INTERVALS.map((s) => (
              <option key={s} value={s}>
                {t('settings.storage.everySeconds', { count: s })}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.storage.resolution')}>
          <select value={settings.captureHeight} onChange={(e) => save({ captureHeight: Number(e.target.value) === 1080 ? 1080 : 720 })}>
            <option value={720}>720p</option>
            <option value={1080}>1080p</option>
          </select>
        </Row>
      </Section>
      <Section title={t('settings.storage.title')} sub={t('settings.storage.sub')}>
        <Row label={t('settings.storage.limit')} sub={status ? t('settings.storage.used', { size: gb(status.framesBytes) }) : undefined}>
          <input
            type="number"
            min={1}
            style={{ width: 80 }}
            defaultValue={settings.storageLimitGb}
            onBlur={(e) => save({ storageLimitGb: Number(e.target.value) })}
            aria-label={t('settings.storage.limitAria')}
          />
          <span className="note">GB</span>
        </Row>
        <Row label={t('settings.storage.folder')}>
          <button className="btn-subtle" onClick={() => void window.dayflow.openRecordings()}>
            <FolderOpen size={14} />
            {t('common.open')}
          </button>
        </Row>
      </Section>
    </>
  )
}

function PrivacyTab({ settings, status, save }: { settings: Settings; status: AppStatus | null; save: Save }) {
  const { t } = useTranslation()
  const detection = status?.recorder.windowDetection
  return (
    <Section
      title={t('settings.privacy.title')}
      sub={<Trans i18nKey="settings.privacy.sub" components={{ code: <code /> }} />}
    >
      <Row
        label={t('settings.privacy.rules')}
        sub={
          detection === 'unavailable' ? (
            <StatusDot kind="bad">
              {t('settings.privacy.detectionOff')} {status?.recorder.windowDetectionError}
            </StatusDot>
          ) : detection === 'ok' ? (
            <StatusDot kind="good">{t('settings.privacy.detectionWorks')}</StatusDot>
          ) : undefined
        }
        stack
      >
        <textarea className="mono" rows={7} defaultValue={settings.blockedApps.join('\n')} onBlur={(e) => save({ blockedApps: e.target.value.split('\n') })} />
      </Row>
      <Row
        label={t('settings.privacy.hidePrivate')}
        sub={t('settings.privacy.hidePrivateSub')}
      >
        <input
          type="checkbox"
          className="switch"
          checked={settings.hidePrivateWindows}
          onChange={(e) => save({ hidePrivateWindows: e.target.checked })}
          aria-label={t('settings.privacy.hidePrivate')}
        />
      </Row>
      <Row
        label={t('settings.privacy.hideSecrets')}
        sub={t('settings.privacy.hideSecretsSub')}
      >
        <input
          type="checkbox"
          className="switch"
          checked={settings.hideSecrets}
          onChange={(e) => save({ hideSecrets: e.target.checked })}
          aria-label={t('settings.privacy.hideSecrets')}
        />
      </Row>
    </Section>
  )
}

function ExportTab() {
  const { t } = useTranslation()
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
      <Section title={t('settings.export.title')} sub={t('settings.export.sub')}>
        <Row
          label={t('settings.export.range')}
          sub={invalid ? <StatusDot kind="bad">{t('settings.export.startAfterEnd')}</StatusDot> : result ? <StatusDot kind={result.ok ? 'good' : 'warn'}>{result.message}</StatusDot> : undefined}
        >
          <span className="date-pill">
            <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} aria-label={t('settings.export.from')} />
            <ArrowRight size={14} color="var(--text-muted)" />
            <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} aria-label={t('settings.export.to')} />
          </span>
        </Row>
        <Row label={t('settings.export.asMarkdown')}>
          <button
            className="btn-ink"
            disabled={invalid}
            onClick={() =>
              void window.dayflow
                .exportMarkdown(from, to)
                .then(setResult, (err: unknown) => setResult({ ok: false, message: t('settings.export.saveFailed', { error: String(err) }) }))
            }
          >
            <Download size={14} />
            {t('settings.export.asMarkdown')}
          </button>
        </Row>
      </Section>
      <Section title={t('settings.reprocess.title')} sub={t('settings.reprocess.sub')}>
        <Row label={t('settings.reprocess.day')} sub={reprocessed ?? undefined}>
          <span className="date-pill">
            <input type="date" value={reprocessDay} max={today} onChange={(e) => (setReprocessDay(e.target.value), setArmed(false))} aria-label={t('settings.reprocess.dayAria')} />
          </span>
          <button
            className="btn-subtle"
            disabled={!reprocessDay}
            onClick={() => {
              if (!armed) return setArmed(true)
              setArmed(false)
              void window.dayflow
                .reprocessDay(reprocessDay)
                .then((n) => setReprocessed(n ? t('settings.reprocess.queued', { count: n }) : t('settings.reprocess.nothing')))
            }}
          >
            <RotateCw size={13} />
            {armed ? t('settings.reprocess.confirm') : t('settings.reprocess.button')}
          </button>
        </Row>
      </Section>
    </>
  )
}

function OtherTab({ settings, save }: { settings: Settings; save: Save }) {
  const { t } = useTranslation()
  return (
    <>
      <Section title={t('settings.other.general')}>
        <Row label={t('settings.other.appLanguage')} sub={t('settings.other.appLanguageSub')}>
          <select value={settings.appLanguage} onChange={(e) => save({ appLanguage: e.target.value as AppLanguage })} aria-label={t('settings.other.appLanguage')}>
            <option value="">{t('settings.other.systemDefault')}</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('settings.other.appearance')} sub={t('settings.other.appearanceSub')}>
          <select value={settings.theme} onChange={(e) => save({ theme: e.target.value as Theme })} aria-label={t('settings.other.appearance')}>
            <option value="dark">{t('settings.other.dark')}</option>
            <option value="light">{t('settings.other.light')}</option>
            <option value="system">{t('settings.other.system')}</option>
          </select>
        </Row>
        <Row label={t('settings.other.theme')} sub={t('settings.other.themeSub')}>
          <select
            value={settings.uiStyle}
            onChange={(e) => {
              const uiStyle = e.target.value as UiStyle
              applyUiStyle(uiStyle)
              save({ uiStyle })
            }}
            aria-label={t('settings.other.theme')}
          >
            <option value="modern">{t('settings.other.modern')}</option>
            <option value="dayflow">{t('settings.other.original')}</option>
          </select>
        </Row>
        <Row label={t('settings.other.launchAtLogin')}>
          <input type="checkbox" className="switch" checked={settings.launchAtLogin} onChange={(e) => save({ launchAtLogin: e.target.checked })} aria-label={t('settings.other.launchAtLoginAria')} />
        </Row>
        <Row label={t('settings.other.showIcons')} sub={t('settings.other.showIconsSub')}>
          <input type="checkbox" className="switch" checked={settings.showAppIcons} onChange={(e) => save({ showAppIcons: e.target.checked })} aria-label={t('settings.other.showIconsAria')} />
        </Row>
        <Row label={t('settings.other.goalPopups')} sub={t('settings.other.goalPopupsSub')}>
          <input
            type="checkbox"
            className="switch"
            checked={settings.showDailyGoalPopups}
            onChange={(e) => save({ showDailyGoalPopups: e.target.checked })}
            aria-label={t('settings.other.goalPopups')}
          />
        </Row>
        <UpdatesRow settings={settings} save={save} />
      </Section>
      <CategoryEditor categories={settings.categories} save={save} />
      <SupportSettings />
    </>
  )
}

/** Windows and macOS packages update from GitHub Releases; the Flatpak and development builds show nothing. */
function UpdatesRow({ settings, save }: { settings: Settings; save: Save }) {
  const { t } = useTranslation()
  const [support, setSupport] = useState<UpdateMode | null>(null)
  useEffect(() => void window.dayflow.getUpdateSupport().then(setSupport), [])
  if (!support || support.mode === 'off') return null
  return (
    <>
    <Row label={t('settings.updates.check')} sub={t('settings.updates.checkSub')}>
      <input
        type="checkbox"
        className="switch"
        checked={settings.checkForUpdates}
        onChange={(e) => save({ checkForUpdates: e.target.checked })}
        aria-label={t('settings.updates.check')}
      />
    </Row>
    <Row
      label={t('settings.updates.autoInstall')}
      sub={support.mode === 'notify' ? t('settings.updates.autoInstallUnsigned') : t('settings.updates.autoInstallSub')}
    >
      <input
        type="checkbox"
        className="switch"
        checked={support.mode === 'install' && settings.checkForUpdates && settings.autoInstallUpdates}
        disabled={support.mode !== 'install' || !settings.checkForUpdates}
        onChange={(e) => save({ autoInstallUpdates: e.target.checked })}
        aria-label={t('settings.updates.autoInstall')}
      />
    </Row>
    </>
  )
}

/** Category list: color, name and the description the model sees; presets from upstream's onboarding. */
function CategoryEditor({ categories, save }: { categories: Category[]; save: Save }) {
  const { t } = useTranslation()
  const roleLabel = (role: string) => {
    const key = ROLE_KEYS[role]
    return key ? t(`settings.categories.roles.${key}` as 'settings.categories.roles.other') : role
  }
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
    <Section id="settings-categories" title={t('settings.categories.title')} sub={t('settings.categories.sub')}>
      <ul className="categories">
        {rows.map((c, i) => (
          <li key={i}>
            <input type="color" value={c.color} aria-label={t('settings.categories.colorOf', { name: c.name })} onChange={(e) => update(i, { color: e.target.value })} onBlur={() => persist(rows)} />
            <input className="name" value={c.name} aria-label={t('settings.categories.name')} onChange={(e) => update(i, { name: e.target.value })} onBlur={() => persist(rows)} />
            <input
              className="description"
              value={c.description}
              aria-label={t('settings.categories.descriptionOf', { name: c.name })}
              placeholder={c.isIdle ? t('settings.categories.idlePlaceholder') : t('settings.categories.placeholder')}
              onChange={(e) => update(i, { description: e.target.value })}
              onBlur={() => persist(rows)}
            />
            {!c.isIdle ? (
              <button className="link danger" aria-label={t('settings.categories.remove', { name: c.name })} onClick={() => persist(rows.filter((_, j) => j !== i))}>
                ✕
              </button>
            ) : (
              <span style={{ width: 9 }} />
            )}
          </li>
        ))}
      </ul>
      <Row label={t('settings.categories.addOrReplace')}>
        <button
          className="btn-subtle"
          onClick={() => {
            const idle = rows.findIndex((c) => c.isIdle)
            const next = [...rows]
            next.splice(idle < 0 ? next.length : idle, 0, { id: '', name: t('settings.categories.newName', { n: rows.length }), color: '#6A7EFF', description: '' })
            setRows(next)
          }}
        >
          {t('settings.categories.add')}
        </button>
        <select value={preset ?? ''} aria-label={t('settings.categories.presetAria')} onChange={(e) => setPreset(e.target.value || null)}>
          <option value="">{t('settings.categories.presetPlaceholder')}</option>
          {Object.keys(CATEGORY_PRESETS).map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
        {preset && (
          <button className="btn-ink" onClick={() => (persist(presetCategories(preset)), setPreset(null))} title={t('settings.categories.replaceHint')}>
            {t('settings.categories.replaceWith', { role: roleLabel(preset) })}
          </button>
        )}
      </Row>
    </Section>
  )
}
