import { Component, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { reportError } from './api'
import { LoginPage, SetupPage } from './pages/Auth'
import { HomePage } from './pages/Home'
import { JournalPage } from './pages/Journal'
import { LibraryPage } from './pages/Library'
import { PeoplePage, PersonPage } from './pages/People'
import { SettingsPage } from './pages/Settings'
import { StatsPage } from './pages/Stats'
import { Shell } from './shell'
import { AuthProvider, LibraryProvider, ToastProvider, useAuth } from './state'

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route element={<Protected />}>
                <Route index element={<HomePage />} />
                <Route path="library" element={<LibraryPage />} />
                <Route path="journal" element={<JournalPage />} />
                <Route path="stats" element={<StatsPage />} />
                <Route path="people" element={<PeoplePage />} />
                <Route path="people/:id" element={<PersonPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}

function Protected() {
  const { user, loading } = useAuth()
  if (loading) return <p className="page meta">Opening the journal…</p>
  if (!user) return <Navigate to="/login" replace />
  return (
    <LibraryProvider>
      <Shell />
    </LibraryProvider>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    reportError(error)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="page">
          <h1>The page stumbled.</h1>
          <p className="lede">Your books are still safe. Reload to continue.</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
