// Private browser windows, after upstream Dayflow
// (Core/Recording/BrowserWindowClassifier.swift). Upstream also reads toolbar
// labels and the address field through macOS accessibility; on Linux only the
// window title is available, so this ports the title markers.

import type { ActiveWindow } from './blocklist'

type Family = 'chromium' | 'firefox'

/** Linux app IDs (KWin resource class or Flatpak ID, lower case) of the browsers upstream verifies. */
const FAMILIES: Record<string, Family> = {
  'google-chrome': 'chromium',
  'google-chrome-beta': 'chromium',
  'google-chrome-unstable': 'chromium',
  'com.google.chrome': 'chromium',
  chromium: 'chromium',
  'chromium-browser': 'chromium',
  'org.chromium.chromium': 'chromium',
  firefox: 'firefox',
  'firefox-esr': 'firefox',
  'firefox-developer-edition': 'firefox',
  'firefox-nightly': 'firefox',
  'org.mozilla.firefox': 'firefox',
  librewolf: 'firefox',
  'io.gitlab.librewolf-community': 'firefox'
}

/** Chrome's incognito word across its locales (upstream incognitoWords). */
const INCOGNITO_WORDS = [
  'incognito', 'in incognito', 'incógnito', 'modo incógnito', 'navigation privée', 'navigation privee', 'inkognito',
  'anonimowy', 'anônima', 'janela anônima', 'navegação anônima', 'navegacao anonima', 'privé', 'prive', 'incognitomodus',
  'инкогнито', 'режим инкогнито', 'シークレット', 'シークレット モード', '无痕式', '无痕', '無痕式', '無痕', '시크릿',
  '시크릿 모드', 'gizli', 'anonymní', 'anonymni', 'анонімний', 'incognitotila', 'incognito-tila'
]

/** Firefox's private-browsing phrase across its locales (upstream privateBrowsingPhrases). */
const PRIVATE_BROWSING_PHRASES = [
  'private browsing', 'privates surfen', 'navegación privada', 'navegacion privada', 'navegação privada',
  'navegacao privada', 'navigation privée', 'navigation privee', 'navigazione privata', 'privé navigeren',
  'prive navigeren', 'частный доступ', 'プライベートブラウズ', '无痕浏览', '無痕瀏覽', '개인정보 보호 브라우징',
  'yksityinen selaus', 'przeglądanie prywatne', 'przegladanie prywatne', 'gizli gezinti'
]

const TOKENS: Record<Family, string[]> = { chromium: INCOGNITO_WORDS, firefox: PRIVATE_BROWSING_PHRASES }

/** Upstream titleSeparators. */
const SEPARATORS = /[()[\]—–\-,|·•]/

/** Case, accent and width insensitive, single spaces (upstream normalize). */
const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')

/**
 * A title matches when one of its separated pieces is, or ends with, a
 * marker: Chrome's "(Incognito)" or Firefox's "… — Mozilla Firefox Private Browsing".
 */
function matchesTitle(title: string, tokens: string[]): boolean {
  const pieces = title.split(SEPARATORS).map(normalize).filter(Boolean)
  const markers = tokens.map(normalize).filter(Boolean)
  return pieces.some((piece) => markers.some((m) => piece === m || piece.endsWith(` ${m}`)))
}

/** True for a private window of a browser upstream knows; other apps and unknown browsers are never matched. */
export function isPrivateBrowserWindow(window: ActiveWindow): boolean {
  const app = window.app.trim().toLowerCase()
  // Own keys only, so an app ID like "constructor" is just an unknown app.
  return Object.hasOwn(FAMILIES, app) ? matchesTitle(window.title, TOKENS[FAMILIES[app]!]) : false
}
