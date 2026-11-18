// The app's texts in the chosen language, with i18next. One i18next instance
// per process: the main process (tray, notifications, dialogs) and the
// renderer (wrapped in react-i18next's provider) each set it to the language
// from Settings → Other → App language. English is the source and fallback;
// every language is one JSON file in ./locales, bundled with the app.
// The CLI and MCP server never change it, so they stay English.

import i18next from 'i18next'
import { formatClock, hourLabel, parseKey } from './day'
import { LANGUAGE_CODES, type Language } from './languages'
import de from './locales/de.json'
import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import zhHans from './locales/zh-Hans.json'
import zhHant from './locales/zh-Hant.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}

/** Every language's texts, keyed by language code. */
export const LOCALES: Record<Language, object> = { en, de, fr, ja, ko, ru, 'zh-Hans': zhHans, 'zh-Hant': zhHant }

export const i18n = i18next.createInstance()
void i18n.init({
  resources: Object.fromEntries(Object.entries(LOCALES).map(([code, translation]) => [code, { translation }])),
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGE_CODES],
  // "zh-Hans" is a language of its own here, not a variant of "zh".
  load: 'currentOnly',
  initAsync: false,
  returnNull: false,
  // React escapes, and the main process writes plain text.
  interpolation: { escapeValue: false },
  // Keys are paths like "settings.other.appLanguage"; texts may contain ":".
  nsSeparator: false
})

/** The text of a key in the current language (i18next's t). */
export const t: typeof i18n.t = i18n.t.bind(i18n) as typeof i18n.t

export const currentLanguage = (): Language => i18n.language as Language

/** Switches the texts of this process; resolves once listeners (React) heard of it. */
export function setLanguage(language: Language): Promise<unknown> {
  return i18n.changeLanguage(language)
}

/** The locale for Intl date and number formats: US English for English, like upstream's "h:mm a". */
const intlLocale = () => (currentLanguage() === 'en' ? 'en-US' : currentLanguage())

/** A clock time for the UI: "2:30 PM" in English, the language's own format otherwise ("14:30"). */
export function clockLabel(ts: number): string {
  if (currentLanguage() === 'en') return formatClock(ts)
  return new Date(ts * 1000).toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' })
}

/** An hour on a chart axis (a clock minute): "9am" in English, "09:00" and the like otherwise. */
export function hourAxisLabel(minute: number): string {
  if (currentLanguage() === 'en') return hourLabel(minute)
  const d = new Date(2000, 0, 1, Math.floor(minute / 60) % 24)
  return d.toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' })
}

/** A day key as a date in the current language. */
export function dateLabel(day: string, options: Intl.DateTimeFormatOptions): string {
  return parseKey(day).toLocaleDateString(intlLocale(), options)
}

/** A month and year, e.g. "November 2026", for the calendar. */
export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' })
}

/** A duration like "2h 15m", "2h" or "45m" in the current language (upstream's short durations). */
export function durationLabel(total: number): string {
  const h = Math.floor(total / 60)
  const m = Math.floor(total % 60)
  return h && m ? t('format.hoursMinutes', { h, m }) : h ? t('format.hours', { h }) : t('format.minutes', { m })
}
