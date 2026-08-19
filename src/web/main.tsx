import React from 'react'
import ReactDOM from 'react-dom/client'
import { WebApp } from './App'
import '@/index.css'
import './theme.css'
import { installGlobalErrorHandlers } from '@/core/errorLogger'
import { bootApp } from '@/core/boot'
import { setAppShell } from '@/shared/shell'

setAppShell('web')
installGlobalErrorHandlers()

void bootApp()
  .catch((e) => { console.error('bootApp', e) })
  .then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <WebApp />
      </React.StrictMode>,
    )
  })
