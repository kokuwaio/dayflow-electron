import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Upstream's fonts (SIL OFL 1.1, texts in licenses/): Figtree for the UI, Instrument Serif for titles.
import '@fontsource-variable/figtree/wght.css'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
// The Modern theme's font (SIL OFL 1.1).
import '@fontsource-variable/inter/wght.css'
import { sanitizeUiStyle } from '@shared/ui-style'
import { App } from './App'
import { applyUiStyle } from './ui-style'
import './styles.css'

// The main process passes the theme in the URL, so the first paint already has it.
applyUiStyle(sanitizeUiStyle(new URLSearchParams(location.search).get('uiStyle')))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
