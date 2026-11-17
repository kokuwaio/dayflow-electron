// The Settings page's building blocks (upstream SettingsView): chrome-less
// sections, rows with the label left and the control right, status dots and
// commands to copy.

import { type ReactNode, useState } from 'react'

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

export function StatusDot({ kind, children }: { kind: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`status-dot ${kind}`}>{children}</span>
}

/** A command or config to copy, shown as is. */
export function CommandBlock({ text, label = 'Copy' }: { text: string; label?: string }) {
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
        {copied ? 'Copied' : label}
      </button>
    </div>
  )
}
