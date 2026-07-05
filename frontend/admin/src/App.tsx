import { useEffect, useMemo, useState } from 'react'
import { loadSession, makeClient, saveSession, type StoredSession } from './api'
import { Costs } from './views/Costs'
import { License } from './views/License'
import { Login } from './views/Login'
import { Overview } from './views/Overview'

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export function App() {
  const [session, setSession] = useState<StoredSession | null>(loadSession())
  const route = useHashRoute()
  const api = useMemo(() => makeClient(session?.accessToken), [session])

  if (!session) {
    return (
      <Login
        onLogin={(s) => {
          saveSession(s)
          setSession(s)
        }}
      />
    )
  }

  const logout = () => {
    saveSession(null)
    setSession(null)
    window.location.hash = '#/'
  }

  const licenseMatch = route.match(/^#\/license\/([0-9A-Z]+)$/)
  const costsMatch = route.match(/^#\/costs\/([0-9A-Z]+)$/)

  return (
    <div className="shell">
      <header className="topbar no-print">
        <div className="wordmark">
          SOMO<span> Console</span>
        </div>
        <nav>
          <a href="#/" className={route === '#/' ? 'active' : ''}>
            Overview
          </a>
        </nav>
        <div className="who">
          {session.phone}{' '}
          <button className="small ghost" onClick={logout} style={{ marginLeft: 10 }}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        {licenseMatch ? (
          <License api={api} licenseId={licenseMatch[1]!} />
        ) : costsMatch ? (
          <Costs api={api} licenseId={costsMatch[1]!} />
        ) : (
          <Overview api={api} onAuthFailure={logout} />
        )}
      </main>
    </div>
  )
}
