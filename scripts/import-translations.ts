// Fills the locale files in src/shared/locales from upstream Dayflow's string
// catalog (Dayflow/Dayflow/Localizable.xcstrings, MIT) and merges hand-made
// translations. Node 24 runs this file directly (type stripping):
//
//   node scripts/import-translations.ts <Localizable.xcstrings>
//       Takes upstream's translation for every English text that matches one
//       of upstream's, and prints the keys still missing per language.
//   node scripts/import-translations.ts --merge <lang> <translations.json>
//       Adds translations (flat {"key": "text"}) to a locale and lists their
//       keys in machine-translated.json, so a native speaker can review them.
//
// A match ignores whitespace, reads upstream's "Dayflow" as our "Dayflow
// Electron" (and renames it in the translation), and maps upstream's
// placeholders (%@, %lld, %1$@) onto ours ({{name}}) in order. Existing
// translations are kept; keys English no longer has are dropped.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Unit = { stringUnit?: { state?: string; value?: string } }
type Localization = Unit & { variations?: { plural?: Record<string, Unit> } }
export interface Catalog {
  sourceLanguage: string
  strings: Record<string, { localizations?: Record<string, Localization> }>
}
/** A locale as flat "a.b.c" keys. */
export type Flat = Record<string, string>

const UPSTREAM_NAME = 'Dayflow'
const OUR_NAME = 'Dayflow Electron'
const UPSTREAM_PLACEHOLDER = /%(?:(\d+)\$)?(?:@|lld|ld|d|i|u|f|\.\d+f|s)/g
const OUR_PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/** The form texts are compared in: placeholders as {}, one space, straight quotes, upstream's product name. */
function comparable(text: string, side: 'upstream' | 'ours'): string {
  const named = side === 'ours' ? text.replaceAll(OUR_NAME, UPSTREAM_NAME).replace(OUR_PLACEHOLDER, '{}') : text.replace(UPSTREAM_PLACEHOLDER, '{}').replaceAll('%%', '%')
  return named.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replaceAll('...', '…').replace(/\s+/g, ' ').trim()
}

const placeholderNames = (text: string) => [...text.matchAll(OUR_PLACEHOLDER)].map((m) => m[1]!)

/** Upstream's translation with our placeholders and product name; null when its placeholders do not fit ours. */
function adapt(translation: string, english: string, lang: string): string | null {
  const names = placeholderNames(english)
  let next = 0
  let fits = true
  const used = new Set<number>()
  const text = translation.replace(UPSTREAM_PLACEHOLDER, (_m, position: string | undefined) => {
    const index = position ? Number(position) - 1 : next++
    const name = names[index]
    if (name === undefined) fits = false
    used.add(index)
    return `{{${name}}}`
  })
  if (!fits || used.size !== names.length) return null
  // Rename only when every "Dayflow" in our English is the product.
  const renames = english.split(UPSTREAM_NAME).length === english.split(OUR_NAME).length
  let out = (renames ? text.replace(/Dayflow(?! Electron)/g, OUR_NAME) : text).replaceAll('%%', '%')
  // Korean particles follow the last sound: "Electron" ends in a consonant, "Dayflow" did not.
  if (renames && lang === 'ko') out = out.replace(/Dayflow Electron([가는를와])(?![가-힣])/g, (_m, p: string) => `${OUR_NAME}${KO_AFTER_CONSONANT[p]}`)
  return out.trim() ? out : null
}

const KO_AFTER_CONSONANT: Record<string, string> = { 가: '이', 는: '은', 를: '을', 와: '과' }

const value = (u: Unit | undefined) => u?.stringUnit?.value || undefined

/** Upstream's entries by their comparable English text; plural entries by their "other" form. */
function indexCatalog(catalog: Catalog): Map<string, Record<string, Localization>> {
  const index = new Map<string, Record<string, Localization>>()
  for (const [key, entry] of Object.entries(catalog.strings)) {
    const localizations = entry.localizations ?? {}
    const en = localizations[catalog.sourceLanguage]
    const english = value(en?.variations?.plural?.other) ?? value(en) ?? key
    if (english.trim()) index.set(comparable(english, 'upstream'), localizations)
  }
  return index
}

/** The plural forms a language needs, and those it may take from "other" (French "many" is for millions). */
function pluralForms(lang: string): { all: string[]; required: Set<string> } {
  const rules = new Intl.PluralRules(lang)
  const required = new Set<string>()
  for (let n = 0; n <= 200; n++) required.add(rules.select(n))
  return { all: rules.resolvedOptions().pluralCategories, required }
}

/** Plural keys of a flat English locale, grouped by base key ("n" for "n_one", "n_other"). */
function groups(en: Flat): Array<{ base: string; keys: string[]; plural: boolean }> {
  const out = new Map<string, { base: string; keys: string[]; plural: boolean }>()
  for (const key of Object.keys(en)) {
    const m = PLURAL_SUFFIX.exec(key)
    const base = m ? key.slice(0, -m[0].length) : key
    const group = out.get(base) ?? { base, keys: [], plural: !!m }
    group.keys.push(key)
    out.set(base, group)
  }
  return [...out.values()]
}

/** The keys a language needs for one English key or plural group. */
function wantedKeys(group: { base: string; keys: string[]; plural: boolean }, lang: string): string[] {
  return group.plural ? pluralForms(lang).all.map((c) => `${group.base}_${c}`) : group.keys
}

/** Upstream's translations of one English key or plural group, or null. */
function fromUpstream(group: { base: string; keys: string[]; plural: boolean }, en: Flat, lang: string, index: Map<string, Record<string, Localization>>): Flat | null {
  if (!group.plural) {
    const english = en[group.base]!
    const translated = value(index.get(comparable(english, 'ours'))?.[lang])
    const text = translated && adapt(translated, english, lang)
    return text ? { [group.base]: text } : null
  }
  const english = en[`${group.base}_other`]
  const variations = english && index.get(comparable(english, 'ours'))?.[lang]?.variations?.plural
  if (!english || !variations) return null
  const { all, required } = pluralForms(lang)
  const out: Flat = {}
  for (const category of all) {
    const translated = value(variations[category]) ?? (required.has(category) ? undefined : value(variations.other))
    const text = translated && adapt(translated, english, lang)
    if (!text) return null
    out[`${group.base}_${category}`] = text
  }
  return out
}

/**
 * Each language's locale: existing translations first, then upstream's for
 * the keys still empty. Lists which keys came from upstream and which are missing.
 */
export function importTranslations(
  en: Flat,
  catalog: Catalog,
  existing: Record<string, Flat>,
  langs: string[]
): { locales: Record<string, Flat>; fromUpstream: Record<string, string[]>; missing: Record<string, string[]> } {
  const index = indexCatalog(catalog)
  const locales: Record<string, Flat> = {}
  const imported: Record<string, string[]> = {}
  const missing: Record<string, string[]> = {}
  for (const lang of langs) {
    const own = existing[lang] ?? {}
    const locale: Flat = {}
    imported[lang] = []
    missing[lang] = []
    for (const group of groups(en)) {
      const wanted = wantedKeys(group, lang)
      const upstream = fromUpstream(group, en, lang, index)
      if (wanted.every((k) => own[k])) {
        for (const k of wanted) locale[k] = own[k]!
        if (upstream) imported[lang].push(...wanted.filter((k) => own[k] === upstream[k]))
        continue
      }
      if (upstream) {
        Object.assign(locale, upstream)
        imported[lang].push(...Object.keys(upstream))
      } else {
        for (const k of wanted) if (own[k]) locale[k] = own[k]!
        missing[lang].push(...wanted.filter((k) => !own[k]))
      }
    }
    locales[lang] = locale
  }
  return { locales, fromUpstream: imported, missing }
}

/** Adds hand-made translations to a locale and their keys to the list for review. */
export function mergeMachineTranslations(locale: Flat, machine: string[], translations: Flat): { locale: Flat; machine: string[] } {
  const keys = new Set(machine)
  for (const k of Object.keys(translations)) keys.add(k)
  return { locale: { ...locale, ...translations }, machine: [...keys] }
}

export function flatten(nested: object, prefix = ''): Flat {
  const out: Flat = {}
  for (const [k, v] of Object.entries(nested)) {
    if (v && typeof v === 'object') Object.assign(out, flatten(v as object, `${prefix}${k}.`))
    else out[`${prefix}${k}`] = String(v)
  }
  return out
}

/** Nested JSON from flat keys, in the order of `order` (English's), then the rest. */
export function unflatten(flat: Flat, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const keys = [...order.filter((k) => k in flat), ...Object.keys(flat).filter((k) => !order.includes(k))]
  for (const key of keys) {
    const parts = key.split('.')
    let node = out
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>
    node[parts.at(-1)!] = flat[key]
  }
  return out
}

/** English key order with each plural group expanded to all of a language's forms, so locales read like en.json. */
function keyOrder(en: Flat): string[] {
  return groups(en).flatMap((g) => (g.plural ? ['zero', 'one', 'two', 'few', 'many', 'other'].map((c) => `${g.base}_${c}`) : g.keys))
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'shared', 'locales')
  const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
  const writeJson = (file: string, data: unknown) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
  const en = flatten(readJson(join(dir, 'en.json')))
  const order = keyOrder(en)
  const langs = ['de', 'fr', 'ja', 'ko', 'ru', 'zh-Hans', 'zh-Hant']
  const machineFile = join(dir, 'machine-translated.json')
  const machine: Record<string, string[]> = readJson(machineFile)
  const args = process.argv.slice(2)

  if (args[0] === '--merge' && args[1] && args[2]) {
    const lang = args[1]
    if (!langs.includes(lang)) throw new Error(`Unknown language ${lang}.`)
    const r = mergeMachineTranslations(flatten(readJson(join(dir, `${lang}.json`))), machine[lang] ?? [], readJson(args[2]))
    writeJson(join(dir, `${lang}.json`), unflatten(r.locale, order))
    machine[lang] = r.machine.filter((k) => k in r.locale).sort()
    writeJson(machineFile, machine)
  } else if (args[0] && !args[0].startsWith('-')) {
    const existing = Object.fromEntries(langs.map((l) => [l, flatten(readJson(join(dir, `${l}.json`)))]))
    const r = importTranslations(en, readJson(args[0]), existing, langs)
    for (const lang of langs) {
      writeJson(join(dir, `${lang}.json`), unflatten(r.locales[lang]!, order))
      // Keys that now come from upstream, or that English dropped, need no review.
      machine[lang] = (machine[lang] ?? []).filter((k) => k in r.locales[lang]! && !r.fromUpstream[lang]!.includes(k))
      const total = Object.keys(r.locales[lang]!).length + r.missing[lang]!.length
      console.log(`${lang}: ${r.fromUpstream[lang]!.length} from upstream, ${machine[lang]!.length} machine-translated, ${r.missing[lang]!.length} missing of ${total}`)
      for (const k of r.missing[lang]!) console.log(`  missing ${k}`)
    }
    writeJson(machineFile, machine)
  } else {
    console.error('usage: node scripts/import-translations.ts <Localizable.xcstrings> | --merge <lang> <translations.json>')
    process.exit(2)
  }
}
