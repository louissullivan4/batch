import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted Spline Sans (design system font), weights 400/500/600/700. Bundled + precached so the
// till cold-loads offline — never a Google Fonts network request on the order path (CLAUDE.md).
import '@fontsource/spline-sans/latin-400.css'
import '@fontsource/spline-sans/latin-500.css'
import '@fontsource/spline-sans/latin-600.css'
import '@fontsource/spline-sans/latin-700.css'
import './theme/tokens.css'
import './theme/base.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) {
  // Fails loudly at boot rather than silently rendering nothing — index.html always has #root.
  throw new Error('root element not found')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
