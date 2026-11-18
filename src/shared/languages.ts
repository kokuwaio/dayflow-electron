// The app's languages, after upstream Dayflow (Utilities/AppLanguagePreferences.swift):
// English plus the languages of upstream's string catalog, each named in itself
// so it stays readable whatever language the app shows.

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh-Hans', name: '简体中文' },
  { code: 'ko', name: '한국어' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ru', name: 'Русский' },
  { code: 'fr', name: 'Français' },
  { code: 'zh-Hant', name: '繁體中文' },
  { code: 'ja', name: '日本語' }
] as const

export type Language = (typeof LANGUAGES)[number]['code']
/** The setting: a language, or '' for the system's language. */
export type AppLanguage = Language | ''

export const LANGUAGE_CODES: readonly Language[] = LANGUAGES.map((l) => l.code)

const isLanguage = (value: unknown): value is Language => (LANGUAGE_CODES as readonly unknown[]).includes(value)

/** A stored or requested setting, or English (the default) when it is unknown. */
export function sanitizeAppLanguage(value: unknown): AppLanguage {
  return value === '' || isLanguage(value) ? value : 'en'
}

const TRADITIONAL_REGIONS = ['tw', 'hk', 'mo']

/** The supported language of one locale like "de-AT", "zh_TW" or "zh-Hant-HK"; null for none. */
function supported(locale: string): Language | null {
  const [lang, ...rest] = locale.toLowerCase().split(/[-_]/)
  if (lang === 'zh') {
    if (rest.includes('hant')) return 'zh-Hant'
    if (rest.includes('hans')) return 'zh-Hans'
    return rest.some((r) => TRADITIONAL_REGIONS.includes(r)) ? 'zh-Hant' : 'zh-Hans'
  }
  return LANGUAGE_CODES.find((code) => code === lang) ?? null
}

/** The language to show: the chosen one, else the first supported system language, else English. */
export function resolveLanguage(setting: AppLanguage, systemLocales: readonly string[]): Language {
  if (setting) return setting
  for (const locale of systemLocales) {
    const match = supported(locale)
    if (match) return match
  }
  return 'en'
}
