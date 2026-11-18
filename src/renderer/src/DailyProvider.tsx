// Daily's provider picker, after upstream Dayflow (Views/UI/DailyView+Provider.swift):
// a gear button beside Regenerate opens a popover to pick who writes the
// standup, or to turn generation off. Rows that cannot run now are disabled.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Circle, Settings as Gear } from 'lucide-react'
import { type DailyProviderChoice, type DailyProviderOption } from '@shared/daily-provider'
import { providerLabel } from '@shared/provider-problem'
import { cliOf } from '@shared/providers'
import './daily-provider.css'

/** The current choice, saved through Settings; null while it loads. */
export function useDailyProvider(): [DailyProviderChoice | null, (choice: DailyProviderChoice) => void] {
  const [choice, setChoice] = useState<DailyProviderChoice | null>(null)
  useEffect(() => void window.dayflow.getSettings().then((s) => setChoice(s.dailyProvider)), [])
  const pick = (next: DailyProviderChoice) => {
    setChoice(next)
    void window.dayflow.saveSettings({ dailyProvider: next }).then((s) => setChoice(s.dailyProvider))
  }
  return [choice, pick]
}

/** The name the gear's tooltip shows for a choice. */
export function choiceLabel(choice: DailyProviderChoice, t: (key: 'daily.provider.auto' | 'daily.provider.none') => string): string {
  if (choice === 'auto') return t('daily.provider.auto')
  if (choice === 'none') return t('daily.provider.none')
  return providerLabel(choice)
}

export function DailyProviderButton({ choice, onPick, disabled }: { choice: DailyProviderChoice; onPick: (c: DailyProviderChoice) => void; disabled: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<DailyProviderOption[] | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const popover = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let current = true
    setOptions(null)
    void window.dayflow.getDailyProviders().then((o) => {
      if (!current) return
      setOptions(o)
      // The standup sits low on the page: scroll so the whole list shows.
      requestAnimationFrame(() => popover.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    })
    const outside = (e: MouseEvent) => anchor.current && !anchor.current.contains(e.target as Node) && setOpen(false)
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      current = false
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  const pick = (next: DailyProviderChoice) => {
    setOpen(false)
    if (next !== choice) onPick(next)
  }
  const detail = (o: DailyProviderOption) => (o.available ? o.model : cliOf(o.kind) ? t('daily.provider.cliMissing') : t('daily.provider.notSetUp'))
  const rows: Array<{ value: DailyProviderChoice; name: string; sub: string; available: boolean }> = [
    { value: 'auto', name: t('daily.provider.auto'), sub: t('daily.provider.autoSub'), available: true },
    ...(options ?? []).map((o) => ({ value: o.kind, name: o.label, sub: detail(o), available: o.available })),
    { value: 'none', name: t('daily.provider.none'), sub: t('daily.provider.noneSub'), available: true }
  ]

  return (
    <div className="dp-anchor" ref={anchor}>
      <button
        className="btn-glass dp-gear"
        aria-label={t('daily.provider.button')}
        title={t('daily.provider.current', { name: choiceLabel(choice, t) })}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Gear size={15} />
      </button>
      {open && (
        <div className="dp-popover" ref={popover} role="dialog" aria-label={t('daily.provider.title')}>
          <div className="dp-head">
            <div>
              <h3>{t('daily.provider.title')}</h3>
              <p>{t('daily.provider.sub')}</p>
            </div>
            {options === null && <span className="spinner dark" role="status" aria-label={t('daily.provider.checking')} />}
          </div>
          <div className="dp-rows" role="radiogroup" aria-label={t('daily.provider.title')}>
            {rows.map((row) => {
              const on = row.value === choice
              return (
                <button
                  key={row.value}
                  role="radio"
                  aria-checked={on}
                  className={`dp-row ${on ? 'on' : ''}`}
                  disabled={!row.available && !on}
                  onClick={() => pick(row.value)}
                >
                  <span className="dp-text">
                    <b>{row.name}</b>
                    <span>{row.sub}</span>
                  </span>
                  {on ? (
                    <span className="dp-check">
                      <Check size={10} strokeWidth={3.5} />
                    </span>
                  ) : (
                    <Circle size={15} className="dp-circle" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
