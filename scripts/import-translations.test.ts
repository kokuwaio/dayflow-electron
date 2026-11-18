import { describe, expect, it } from 'vitest'
import { type Catalog, flatten, importTranslations, mergeMachineTranslations, unflatten } from './import-translations'

const unit = (value: string) => ({ stringUnit: { state: 'needs_review', value } })
const plural = (forms: Record<string, string>) => ({
  variations: { plural: Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, unit(v)])) }
})

const catalog: Catalog = {
  sourceLanguage: 'en',
  strings: {
    Pause: { localizations: { de: unit('Pausieren'), ja: unit('一時停止') } },
    'Weekly view is ready': { localizations: { de: unit('Die Wochenansicht ist bereit') } },
    'Dayflow needs a hand': { localizations: { de: unit('Dayflow braucht Hilfe'), fr: unit('Dayflow a besoin d’aide') } },
    '%@ of recording is waiting.': { localizations: { de: unit('%@ Aufnahme warten.') } },
    '%@ to %@': { localizations: { de: unit('%1$@ bis %2$@'), ja: unit('%2$@まで%1$@から') } },
    '%lld cards': {
      localizations: {
        en: plural({ one: '%lld card', other: '%lld cards' }),
        de: plural({ one: '%lld Karte', other: '%lld Karten' }),
        ru: plural({ one: '%lld карточка', few: '%lld карточки', many: '%lld карточек', other: '%lld карточки' }),
        ja: plural({ other: '%lld件のカード' })
      }
    },
    'Broken %@': { localizations: { de: unit('Kaputt') } },
    'Dayflow is recording': { localizations: { ko: unit('Dayflow가 녹화 중입니다'), de: unit('Dayflow nimmt auf') } }
  }
}

const run = (en: Record<string, string>, existing = {}) => importTranslations(en, catalog, existing, ['de', 'fr', 'ja', 'ru'])

describe('importTranslations', () => {
  it('takes the translation of an exact English match', () => {
    const r = run({ 'pause.pause': 'Pause' })
    expect(r.locales.de).toEqual({ 'pause.pause': 'Pausieren' })
    expect(r.locales.ja).toEqual({ 'pause.pause': '一時停止' })
    expect(r.fromUpstream.de).toEqual(['pause.pause'])
  })

  it('ignores differences in whitespace', () => {
    expect(run({ a: '  Weekly   view is\nready ' }).locales.de).toEqual({ a: 'Die Wochenansicht ist bereit' })
  })

  it('matches "Dayflow Electron" to upstream\'s "Dayflow" and renames it in the translation', () => {
    const r = run({ a: 'Dayflow Electron needs a hand' })
    expect(r.locales.de).toEqual({ a: 'Dayflow Electron braucht Hilfe' })
    expect(r.locales.fr).toEqual({ a: 'Dayflow Electron a besoin d’aide' })
  })

  it('fixes Korean particles after the longer name', () => {
    const r = importTranslations({ a: 'Dayflow Electron is recording' }, catalog, {}, ['ko'])
    expect(r.locales.ko).toEqual({ a: 'Dayflow Electron이 녹화 중입니다' })
  })

  it("turns upstream's placeholders into i18next's, positional ones included", () => {
    expect(run({ a: '{{time}} of recording is waiting.' }).locales.de).toEqual({ a: '{{time}} Aufnahme warten.' })
    const r = run({ a: '{{start}} to {{end}}' })
    expect(r.locales.de).toEqual({ a: '{{start}} bis {{end}}' })
    expect(r.locales.ja).toEqual({ a: '{{end}}まで{{start}}から' })
  })

  it("fills each language's plural forms from upstream's plural variations", () => {
    const r = run({ 'n_one': '{{count}} card', 'n_other': '{{count}} cards' })
    expect(r.locales.de).toEqual({ n_one: '{{count}} Karte', n_other: '{{count}} Karten' })
    expect(r.locales.ru).toEqual({ n_one: '{{count}} карточка', n_few: '{{count}} карточки', n_many: '{{count}} карточек', n_other: '{{count}} карточки' })
    expect(r.locales.ja).toEqual({ n_other: '{{count}}件のカード' })
  })

  it('takes a form that only large numbers use from "other" when upstream lacks it', () => {
    const fr: Catalog = { sourceLanguage: 'en', strings: { x: { localizations: { en: plural({ one: '%lld card', other: '%lld cards' }), fr: plural({ one: '%lld carte', other: '%lld cartes' }) } } } }
    const r = importTranslations({ n_one: '{{count}} card', n_other: '{{count}} cards' }, fr, {}, ['fr'])
    expect(r.locales.fr).toEqual({ n_one: '{{count}} carte', n_many: '{{count}} cartes', n_other: '{{count}} cartes' })
  })

  it('reports keys without a match, or whose placeholders do not fit, as missing', () => {
    const r = run({ a: 'Something new', b: 'Broken {{x}}', 'n_one': '{{count}} card', 'n_other': '{{count}} cards' })
    expect(r.missing.de).toEqual(['a', 'b'])
    // French has a "many" form (for millions) that English lacks.
    expect(r.missing.fr).toEqual(['a', 'b', 'n_one', 'n_many', 'n_other'])
    expect(r.missing.ru).toEqual(['a', 'b'])
  })

  it('keeps existing translations and drops keys English no longer has', () => {
    const r = run({ 'pause.pause': 'Pause', b: 'Something new' }, { de: { 'pause.pause': 'Anhalten', b: 'Etwas Neues', gone: 'Weg' } })
    expect(r.locales.de).toEqual({ 'pause.pause': 'Anhalten', b: 'Etwas Neues' })
    expect(r.missing.de).toEqual([])
    expect(r.fromUpstream.de).toEqual([])
    expect(run({ 'pause.pause': 'Pause' }, { de: { 'pause.pause': 'Pausieren' } }).fromUpstream.de).toEqual(['pause.pause'])
  })
})

describe('mergeMachineTranslations', () => {
  it('adds the translations and records their keys for review, without duplicates', () => {
    const r = mergeMachineTranslations({ a: 'A' }, ['a'], { b: 'B', a: 'A2' })
    expect(r.locale).toEqual({ a: 'A2', b: 'B' })
    expect(r.machine).toEqual(['a', 'b'])
  })
})

describe('flatten and unflatten', () => {
  it('round-trip nested locale files in the given key order', () => {
    const nested = { a: { b: 'x', c: { d: 'y' } }, e: 'z' }
    expect(flatten(nested)).toEqual({ 'a.b': 'x', 'a.c.d': 'y', e: 'z' })
    expect(unflatten({ e: 'z', 'a.c.d': 'y', 'a.b': 'x' }, ['a.b', 'a.c.d', 'e'])).toEqual(nested)
    expect(JSON.stringify(unflatten({ e: 'z', 'a.b': 'x' }, ['a.b', 'e']))).toBe('{"a":{"b":"x"},"e":"z"}')
  })
})
