import { describe, expect, it } from 'vitest'
import { LOCALES, clockLabel, dateLabel, durationLabel, setLanguage, t } from './i18n'
import { LANGUAGES } from './languages'
import machineTranslated from './locales/machine-translated.json'

const flatten = (nested: object, prefix = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(nested).flatMap(([k, v]) => (v && typeof v === 'object' ? Object.entries(flatten(v, `${prefix}${k}.`)) : [[`${prefix}${k}`, v]]))
  )

const PLURAL = /_(zero|one|two|few|many|other)$/
const en = flatten(LOCALES.en)

/** The keys a language must have: English's, with each plural group in that language's forms. */
function expectedKeys(lang: string): string[] {
  const forms = new Intl.PluralRules(lang).resolvedOptions().pluralCategories
  const keys = new Set<string>()
  for (const key of Object.keys(en)) {
    const m = PLURAL.exec(key)
    if (!m) keys.add(key)
    else for (const form of forms) keys.add(`${key.slice(0, -m[0].length)}_${form}`)
  }
  return [...keys].sort()
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort()
const tags = (text: string) => [...text.matchAll(/<\/?(\w+)\s*\/?>/g)].map((m) => m[0]).sort()
/** The English text a translated key renders: a plural form maps to English's "other". */
const englishOf = (key: string) => en[key] ?? en[key.replace(PLURAL, '_other')]!

describe('locale files', () => {
  const others = LANGUAGES.filter((l) => l.code !== 'en')

  it('exist for every language', () => {
    expect(Object.keys(LOCALES).sort()).toEqual(LANGUAGES.map((l) => l.code).sort())
  })

  it.each(others)('$code has every key of en.json, in its own plural forms, and no others', ({ code }) => {
    const keys = Object.keys(flatten(LOCALES[code])).sort()
    const expected = expectedKeys(code)
    expect(expected.filter((k) => !keys.includes(k)), 'missing').toEqual([])
    expect(keys.filter((k) => !expected.includes(k)), 'not in en.json').toEqual([])
  })

  it.each(others)('$code keeps the placeholders and tags of each English text', ({ code }) => {
    const wrong: string[] = []
    for (const [key, text] of Object.entries(flatten(LOCALES[code]))) {
      const english = englishOf(key)
      if (!english || !text.trim()) {
        wrong.push(`${key}: empty`)
        continue
      }
      // A singular form may spell the number out ("одна", "une").
      const want = placeholders(english).filter((p) => !(p === 'count' && /_(zero|one|two)$/.test(key)))
      const got = placeholders(text).filter((p) => !(p === 'count' && /_(zero|one|two)$/.test(key)))
      if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${key}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`)
      if (JSON.stringify(tags(text)) !== JSON.stringify(tags(english))) wrong.push(`${key}: tags ${tags(text)} vs ${tags(english)}`)
    }
    expect(wrong).toEqual([])
  })

  it('lists only existing keys as machine-translated', () => {
    for (const [code, keys] of Object.entries(machineTranslated as Record<string, string[]>)) {
      const locale = flatten(LOCALES[code as keyof typeof LOCALES])
      expect(keys.filter((k) => !(k in locale)), code).toEqual([])
    }
  })
})

describe('switching the language', () => {
  it('changes texts and formats at once, and English stays as before', async () => {
    const ts = new Date(2026, 10, 17, 14, 30).getTime() / 1000
    expect(t('tray.quit')).toBe('Quit')
    expect(clockLabel(ts)).toBe('2:30 PM')
    expect(durationLabel(135)).toBe('2h 15m')
    await setLanguage('de')
    try {
      expect(t('tray.quit')).toBe('Beenden')
      expect(clockLabel(ts)).toBe('14:30')
      expect(dateLabel('2026-11-17', { weekday: 'long' })).toBe('Dienstag')
      expect(durationLabel(135)).not.toBe('2h 15m')
    } finally {
      await setLanguage('en')
    }
    expect(t('tray.quit')).toBe('Quit')
  })
})
