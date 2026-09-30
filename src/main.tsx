import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { RouterProvider } from 'react-router-dom'
import { store } from '@/app/store'
import { theme } from '@/app/theme'
import { router } from '@/app/router'
import { flagApi } from '@/services/flagApi'
import '@/styles.css'

// 另一个窗口（如第二个批准窗口）写入 localStorage 后，刷新本窗口的批次/审计缓存
window.addEventListener('storage', (event) => {
  if (event.key === 'feature-flag-release-console-v1' && event.newValue !== event.oldValue) {
    store.dispatch(flagApi.util.invalidateTags(['Batches', 'Audit', 'Flags', 'Dashboard']))
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RouterProvider router={router} />
      </ThemeProvider>
    </Provider>
  </React.StrictMode>,
)
