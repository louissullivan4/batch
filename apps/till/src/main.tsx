import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
