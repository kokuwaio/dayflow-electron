import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
// Upstream's fonts (SIL OFL 1.1, texts in licenses/): Figtree for the UI, Instrument Serif for titles.
import '@fontsource-variable/figtree/wght.css'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
// The Modern theme's font (SIL OFL 1.1).
import '@fontsource-variable/inter/wght.css'
import { i18n, setLanguage } from '@shared/i18n'
import { resolveLanguage, sanitizeAppLanguage } from '@shared/languages'
import { sanitizeUiStyle } from '@shared/ui-style'
import { App } from './App'
import { applyUiStyle } from './ui-style'
import './styles.css'

// The main process passes the theme and language in the URL, so the first paint already has them.
const query = new URLSearchParams(location.search)
applyUiStyle(sanitizeUiStyle(query.get('uiStyle')))
const applyLanguage = (language: string) => {
  const lang = resolveLanguage(sanitizeAppLanguage(language), [])
  document.documentElement.lang = lang
  return setLanguage(lang)
}
void applyLanguage(query.get('lang') ?? 'en')
// Settings → Other → App language switches the window's texts without a reload.
window.dayflow.onLanguage?.((language) => void applyLanguage(language))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </StrictMode>
)
