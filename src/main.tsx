import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setTheme } from '@tauri-apps/api/app'
import { isTauri } from './utils/platform'
import './index.css'
import App from './App.tsx'

// Match the hardcoded dark CSS palette with dark native chrome (title bar,
// dialogs). Skip in a plain browser, where Tauri IPC is unavailable.
if (isTauri()) {
  void setTheme('dark').catch((err) => {
    console.warn('[theme] could not set native dark theme:', err)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
