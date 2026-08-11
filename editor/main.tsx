import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import 'dockview-react/dist/styles/dockview.css'
import './shell/shell.css'

import { App } from './shell/App'

const container = document.getElementById('root')
if (container === null) throw new Error('The editor page is missing its #root element.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
