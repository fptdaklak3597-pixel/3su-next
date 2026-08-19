import React from 'react'
import ReactDOM from 'react-dom/client'
import { MobileApp } from './App'
import '@/index.css'
import { installGlobalErrorHandlers } from '@/core/errorLogger'
import { bootApp } from '@/core/boot'
import { setAppShell } from '@/shared/shell'

setAppShell('mobile')
installGlobalErrorHandlers()

void bootApp()
  .catch((e) => { console.error('bootApp', e) })
  .then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <MobileApp />
      </React.StrictMode>,
    )
  })
