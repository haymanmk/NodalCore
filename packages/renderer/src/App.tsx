import { useState } from 'react'
import './styles/index.css'
import { StorePage } from './pages/StorePage.js'
import { InstalledPage } from './pages/InstalledPage.js'
import { WorkspacePage } from './pages/WorkspacePage.js'
import { HostMessageToast } from './components/HostMessageToast.js'
import { ContributionsProvider } from './contributions/registry.js'
import { ThemeProvider } from './contributions/ThemeProvider.js'
import { ThemePicker } from './components/ThemePicker.js'
import { StatusBar } from './components/StatusBar.js'

type Tab = 'store' | 'installed' | 'workspace'

export function App() {
  const [tab, setTab] = useState<Tab>('store')

  return (
    <ContributionsProvider>
      <ThemeProvider>
        <div className="app">
          <nav className="app__nav">
            <div className="app__brand">
              <div className="app__logo">
                <svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="7" cy="7" r="2.5"/>
                  <circle cx="7" cy="1.5" r="1.5"/>
                  <circle cx="7" cy="12.5" r="1.5"/>
                  <circle cx="1.5" cy="7" r="1.5"/>
                  <circle cx="12.5" cy="7" r="1.5"/>
                  <line x1="7" y1="3" x2="7" y2="4.5" stroke="white" strokeWidth="1" fill="none"/>
                  <line x1="7" y1="9.5" x2="7" y2="11" stroke="white" strokeWidth="1" fill="none"/>
                  <line x1="3" y1="7" x2="4.5" y2="7" stroke="white" strokeWidth="1" fill="none"/>
                  <line x1="9.5" y1="7" x2="11" y2="7" stroke="white" strokeWidth="1" fill="none"/>
                </svg>
              </div>
              <span className="app__title">NodalCore</span>
            </div>

            <div className="app__tabs">
              <button
                className={`app__tab ${tab === 'store' ? 'app__tab--active' : ''}`}
                onClick={() => setTab('store')}
              >
                Store
              </button>
              <button
                className={`app__tab ${tab === 'installed' ? 'app__tab--active' : ''}`}
                onClick={() => setTab('installed')}
              >
                Installed
              </button>
              <button
                className={`app__tab ${tab === 'workspace' ? 'app__tab--active' : ''}`}
                onClick={() => setTab('workspace')}
              >
                Workspace
              </button>
            </div>

            <div className="app__nav-spacer" />
            <ThemePicker />
          </nav>

          <main className={`app__main ${tab === 'workspace' ? 'app__main--flush' : ''}`}>
            {tab === 'store' && <StorePage />}
            {tab === 'installed' && <InstalledPage />}
            {tab === 'workspace' && <WorkspacePage />}
          </main>

          <StatusBar />
          <HostMessageToast />
        </div>
      </ThemeProvider>
    </ContributionsProvider>
  )
}
