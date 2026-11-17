import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Upstream's fonts (SIL OFL 1.1, texts in licenses/): Figtree for the UI, Instrument Serif for titles.
import '@fontsource-variable/figtree/wght.css'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
