import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Sun } from 'lucide-react'
import type { FeatureAccess } from '@shared/daily'

/**
 * Upstream's shared locked-feature look (DailyAccessLockedViews.swift,
 * Weekly lock, Chat's "Unlock Beta", here "Unlock Chat"): a serif title with an optional BETA badge,
 * the progress as a peach pill and a gradient bar with a round knob. The knob
 * carries a plain sun glyph instead of upstream's logo.
 */
export function LockedFeature(props: { title: string; italic?: boolean; beta?: boolean; access: FeatureAccess; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="locked-page">
      <div className="locked-card">
        <h2 className={props.italic ? '' : 'plain'}>
          {props.title}
          {props.beta && <span className="beta">{t('locked.beta')}</span>}
        </h2>
        {props.children}
        <span className="progress-pill">{props.access.label}</span>
        <ProgressBar value={props.access.progress} label={t('locked.progress', { feature: props.title })} text={props.access.label} />
      </div>
    </div>
  )
}

/** `label` names the bar for screen readers, `text` reads its value out (e.g. "3 of 4 days"). */
export function ProgressBar({ value, label, text }: { value: number; label: string; text?: string }) {
  const share = Math.min(1, Math.max(0, value))
  const pct = `${share * 100}%`
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label={label}
      aria-valuetext={text}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
    >
      <span className="fill" style={{ width: pct }} />
      <span className="knob" style={{ left: `clamp(12px, ${pct}, calc(100% - 12px))` }}>
        <Sun size={14} />
      </span>
    </div>
  )
}
