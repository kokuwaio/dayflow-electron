import { describe, expect, it } from 'vitest'
import { LANGUAGES, resolveLanguage, sanitizeAppLanguage } from './languages'
import { DEFAULT_SETTINGS } from './types'

describe('LANGUAGES', () => {
  it("lists English and upstream's languages by their native names", () => {
    expect(LANGUAGES.map((l) => [l.code, l.name])).toEqual([
      ['en', 'English'],
      ['zh-Hans', '简体中文'],
      ['ko', '한국어'],
      ['de', 'Deutsch'],
      ['ru', 'Русский'],
      ['fr', 'Français'],
      ['zh-Hant', '繁體中文'],
      ['ja', '日本語']
    ])
  })
})

describe('sanitizeAppLanguage', () => {
  it('keeps a supported language and the system setting', () => {
    expect(sanitizeAppLanguage('de')).toBe('de')
    expect(sanitizeAppLanguage('zh-Hant')).toBe('zh-Hant')
    expect(sanitizeAppLanguage('')).toBe('')
  })

  it('falls back to English, the default, for anything else', () => {
    for (const value of [undefined, null, 'xx', 'DE', 'zh', 42]) expect(sanitizeAppLanguage(value)).toBe('en')
    expect(DEFAULT_SETTINGS.appLanguage).toBe('en')
  })
})

describe('resolveLanguage', () => {
  it('uses the chosen language whatever the system says', () => {
    expect(resolveLanguage('de', ['ja-JP'])).toBe('de')
    expect(resolveLanguage('en', ['fr-FR'])).toBe('en')
  })

  it('follows the first supported system language for the system setting', () => {
    expect(resolveLanguage('', ['de-AT', 'en-US'])).toBe('de')
    expect(resolveLanguage('', ['pt-BR', 'fr-CA', 'de'])).toBe('fr')
    expect(resolveLanguage('', ['ru'])).toBe('ru')
    expect(resolveLanguage('', ['ko_KR'])).toBe('ko')
  })

  it('maps Chinese by script, then by region', () => {
    expect(resolveLanguage('', ['zh-Hans-CN'])).toBe('zh-Hans')
    expect(resolveLanguage('', ['zh-Hant-TW'])).toBe('zh-Hant')
    expect(resolveLanguage('', ['zh-CN'])).toBe('zh-Hans')
    expect(resolveLanguage('', ['zh-TW'])).toBe('zh-Hant')
    expect(resolveLanguage('', ['zh-HK'])).toBe('zh-Hant')
    expect(resolveLanguage('', ['zh_MO'])).toBe('zh-Hant')
    expect(resolveLanguage('', ['zh'])).toBe('zh-Hans')
  })

  it('falls back to English without a supported system language', () => {
    expect(resolveLanguage('', ['pt-BR', 'es'])).toBe('en')
    expect(resolveLanguage('', [])).toBe('en')
    expect(resolveLanguage('', ['', 'C', 'en-GB'])).toBe('en')
  })
})
