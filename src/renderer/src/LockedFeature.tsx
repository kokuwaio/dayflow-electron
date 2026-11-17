import type { ReactNode } from 'react'
import { Sun } from 'lucide-react'
import type { FeatureAccess } from '@shared/daily'

/**
 * Upstream's shared locked-feature look (DailyAccessLockedViews.swift,
 * Weekly lock, Chat "Unlock Beta"): a serif title with an optional BETA badge,
 * the progress as a peach pill and a gradient bar with a round knob. The knob
 * carries a plain sun glyph instead of upstream's logo.
 */
export function LockedFeature(props: { title: string; italic?: boolean; beta?: boolean; access: FeatureAccess; children?: ReactNode }) {
  return (
    <div className="locked-page">
      <div className="locked-card">
        <h2 className={props.italic ? '' : 'plain'}>
          {props.title}
          {props.beta && <span className="beta">BETA</span>}
        </h2>
        {props.children}
        <span className="progress-pill">{props.access.label}</span>
        <ProgressBar value={props.access.progress} />
      </div>
    </div>
  )
}

export function ProgressBar({ value }: { value: number }) {
  const pct = `${Math.min(1, Math.max(0, value)) * 100}%`
  return (
    <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <span className="fill" style={{ width: pct }} />
      <span className="knob" style={{ left: `clamp(12px, ${pct}, calc(100% - 12px))` }}>
        <Sun size={14} />
      </span>
    </div>
  )
}
