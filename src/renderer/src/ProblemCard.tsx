// The provider problem card, bottom right, after upstream Dayflow
// (Views/UI/MainView/Layout.swift TimelineFailureToastView,
// System/TimelineFailureToast.swift): what is wrong, "Sign in" for a signed
// out CLI, "Use X as backup" for another provider that is set up, and how much
// recording is waiting. The waiting and failed cards' details offer the same
// actions.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, X } from 'lucide-react'
import { problemTexts, providerLabel, waitingLabel } from '@shared/provider-problem'
import type { AppStatus, CliName, ProviderProblem, SignInState } from '@shared/types'

const LOGIN_COMMAND: Record<CliName, string> = { claude: 'claude auth login', codex: 'codex login' }

/** Sign in, use a backup, or open the provider settings, as the problem allows. */
export function ProblemActions(props: { problem: ProviderProblem; signIn: SignInState; baseUrl: string; onOpenSettings: () => void }) {
  const { t } = useTranslation()
  const { problem, signIn } = props
  const [copied, setCopied] = useState(false)
  const label = (kind: ProviderProblem['provider']) => providerLabel(kind, props.baseUrl)
  const signingIn = problem.signIn && signIn.state === 'waiting' && signIn.cli === problem.signIn
  const signInFailed = problem.signIn && signIn.state === 'failed' && signIn.cli === problem.signIn

  if (signingIn) {
    return (
      <div className="problem-actions">
        <span className="problem-signing">
          <span className="spinner" />
          {t('waiting.signIn.waiting')}
        </span>
        <div className="problem-links">
          <button className="link" onClick={() => void window.dayflow.signIn(problem.signIn!)}>
            {t('waiting.signIn.tryAgain')}
          </button>
          {signIn.state === 'waiting' && signIn.url && (
            <a className="link" href={signIn.url} target="_blank" rel="noreferrer">
              {t('waiting.signIn.openPage')}
            </a>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="problem-actions">
      <div className="problem-buttons">
        {problem.signIn && (
          <button className="btn-primary" onClick={() => void window.dayflow.signIn(problem.signIn!)}>
            {t('waiting.signIn.button', { provider: label(problem.provider) })}
          </button>
        )}
        {problem.backup && (
          <button className={problem.signIn ? 'btn-subtle' : 'btn-primary'} onClick={() => void window.dayflow.useBackup(problem.backup!)}>
            {t('waiting.backup', { provider: label(problem.backup) })}
          </button>
        )}
        {!problem.signIn && (
          <button className={problem.backup ? 'btn-subtle' : 'btn-primary'} onClick={props.onOpenSettings}>
            {t('app.openSettings')}
          </button>
        )}
      </div>
      {signInFailed && (
        <div className="problem-command">
          <span>{t('waiting.signIn.command')}</span>
          <code>{LOGIN_COMMAND[problem.signIn!]}</code>
          <button
            className="bare"
            aria-label={copied ? t('common.copied') : t('common.copy')}
            onClick={() => void window.dayflow.copyText(LOGIN_COMMAND[problem.signIn!]).then(() => setCopied(true))}
          >
            <Copy size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

/** The card itself; null when there is no problem or it was put away. */
export function ProblemToast(props: { status: AppStatus; baseUrl: string; onOpenSettings: () => void; onDismiss: () => void }) {
  const { t } = useTranslation()
  const { problem, signIn, waiting } = props.status.analysis
  if (!problem) return null
  const label = providerLabel(problem.provider, props.baseUrl)
  const texts = problemTexts(problem.kind, label, problem.message)
  const signingIn = problem.signIn && signIn.state === 'waiting' && signIn.cli === problem.signIn
  const signInFailed = problem.signIn && signIn.state === 'failed' && signIn.cli === problem.signIn
  const title = signingIn ? t('waiting.signIn.finishTitle') : texts.title
  const body = signingIn ? t('waiting.signIn.finishBody', { provider: label }) : signInFailed ? t('waiting.signIn.failed') : texts.body
  const time = waitingLabel(waiting.minutes)
  const note = problem.signIn ? t('waiting.footer.afterSignIn') : problem.backup ? t('waiting.footer.rightAway') : t('waiting.footer.onItsOwn')
  return (
    <div className="toast problem-toast" role="alert">
      <div className="toast-body">
        <div>
          <strong>{title}</strong>
          {body}
        </div>
        <ProblemActions problem={problem} signIn={signIn} baseUrl={props.baseUrl} onOpenSettings={props.onOpenSettings} />
        <div className="problem-footer">
          <span className="problem-dot" />
          {time ? (
            <>
              <span>{t('waiting.footer.time', { time })}</span>
              <span className="problem-note">{note}</span>
            </>
          ) : (
            <span>{t('waiting.footer.catchesUp')}</span>
          )}
        </div>
      </div>
      <button className="bare close" aria-label={t('waiting.notNow')} onClick={props.onDismiss}>
        <X size={14} />
      </button>
    </div>
  )
}
