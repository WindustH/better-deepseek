import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="p-4 text-sm text-center text-black/50 dark:text-white/50">
      Better DeepSeek
    </div>
  </StrictMode>,
)
