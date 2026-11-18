// The Settings page's building blocks (upstream SettingsView): chrome-less
// sections, rows with the label left and the control right, status dots and
// commands to copy.

import { type ReactNode, cloneElement, isValidElement, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** A section without a card: 17/600 title, 12 px subtitle, then rows. */
export function Section({ title, sub, children, id }: { title: string; sub?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <section className="s-section" id={id}>
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {children && <div className="rows">{children}</div>}
    </section>
  )
}

/** Label (and subtitle) on the left, control on the right, hairline below. */
export function Row({ label, sub, children, stack, grow }: { label: ReactNode; sub?: ReactNode; children?: ReactNode; stack?: boolean; grow?: boolean }) {
  const id = useId()
  return (
    <div className={`s-row ${stack ? 'stack' : ''}`}>
      <div className="label">
        <b id={`${id}-label`}>{label}</b>
        {sub && <span id={`${id}-sub`}>{sub}</span>}
      </div>
      {children && (
        <div className={`control ${grow ? 'grow' : ''}`} role="group" aria-labelledby={`${id}-label`}>
          {labelled(children, `${id}-label`, sub ? `${id}-sub` : undefined)}
        </div>
      )}
    </div>
  )
}

/** A row's single form field takes the row's label as its name, unless it has its own. */
function labelled(children: ReactNode, labelId: string, subId: string | undefined): ReactNode {
  if (!isValidElement<FieldProps>(children) || !['input', 'select', 'textarea'].includes(children.type as string)) return children
  if (children.props['aria-label'] || children.props['aria-labelledby']) return children
  return cloneElement(children, { 'aria-labelledby': labelId, ...(subId && !children.props['aria-describedby'] ? { 'aria-describedby': subId } : {}) })
}

type FieldProps = { 'aria-label'?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string }

export function StatusDot({ kind, children }: { kind: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`status-dot ${kind}`}>{children}</span>
}

/** A command or config to copy, shown as is. */
export function CommandBlock({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div className="command-block">
      <code className="mono">{text}</code>
      <button
        className="btn-subtle"
        onClick={() => {
          void window.dayflow.copyText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? t('common.copied') : (label ?? t('common.copy'))}
      </button>
    </div>
  )
}
