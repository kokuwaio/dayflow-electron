// Settings → Other → Support, after upstream Views/UI/BugReportView.swift:
// "Copy debug logs" and the log folder. Upstream's chat, email, Discord and
// call booking are its own channels; ours is the GitHub issue tracker.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bug, Copy, FolderOpen } from 'lucide-react'
import { Row, Section, StatusDot } from './SettingsLayout'

const ISSUES_URL = 'https://github.com/kokuwaio/dayflow-electron/issues'

export function SupportSettings() {
  const { t } = useTranslation()
  const [copy, setCopy] = useState<'idle' | 'preparing' | 'copied'>('idle')
  const [error, setError] = useState<string | null>(null)
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (reset.current && clearTimeout(reset.current)), [])

  const copyLogs = async () => {
    if (copy === 'preparing') return
    setCopy('preparing')
    setError(null)
    try {
      await window.dayflow.copyDebugLogs()
      setCopy('copied')
      // Upstream shows "Copied!" for 5 seconds.
      if (reset.current) clearTimeout(reset.current)
      reset.current = setTimeout(() => setCopy('idle'), 5000)
    } catch (err) {
      setCopy('idle')
      setError(String(err))
    }
  }
  const openFolder = async () => {
    setError(null)
    const message = await window.dayflow.openLogFolder()
    if (message) setError(message)
  }

  return (
    <Section title={t('support.title')} sub={t('support.sub')}>
      <Row label={t('support.debugLogs')} sub={error ? <StatusDot kind="bad">{error}</StatusDot> : t('support.debugLogsSub')}>
        <button className="btn-subtle" onClick={() => void openFolder()}>
          <FolderOpen size={14} />
          {t('support.openLogFolder')}
        </button>
        <button className="btn-ink" onClick={() => void copyLogs()} disabled={copy === 'preparing'} aria-live="polite">
          <Copy size={14} />
          {copy === 'copied' ? t('support.copied') : copy === 'preparing' ? t('support.preparing') : t('support.copyDebugLogs')}
        </button>
      </Row>
      <Row label={t('support.reportProblem')} sub={t('support.reportProblemSub')}>
        {/* The window's open handler sends web links to the browser. */}
        <button className="btn-subtle" onClick={() => window.open(ISSUES_URL, '_blank', 'noreferrer')}>
          <Bug size={14} />
          {t('support.openIssues')}
        </button>
      </Row>
    </Section>
  )
}
