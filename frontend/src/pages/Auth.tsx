import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../state'

export function SetupPage() {
  const { needsSetup, loading, user, setup } = useAuth()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  if (loading) return <p className="page meta">Opening the journal…</p>
  if (user) return <Navigate to="/" replace />
  if (!needsSetup) return <Navigate to="/login" replace />
  return (
    <div className="page" style={{ maxWidth: 460, margin: '12vh auto 0' }}>
      <p className="kicker">Paper Trail</p>
      <h1>Begin the journal.</h1>
      <p className="lede">One reader, one password, a private library.</p>
      <form
        className="settings-grid"
        onSubmit={(event) => {
          event.preventDefault()
          setError('')
          void setup(name, password).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not set up.'))
        }}
      >
        <label className="stack">
          <span>What should we call you?</span>
          <input className="field" required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="stack">
          <span>Password</span>
          <input className="field" required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p style={{ color: 'var(--rose)' }}>{error}</p>}
        <button className="btn" type="submit">
          Open my library
        </button>
      </form>
    </div>
  )
}

export function LoginPage() {
  const { user, loading, needsSetup, login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  if (loading) return <p className="page meta">Opening the journal…</p>
  if (user) return <Navigate to="/" replace />
  if (needsSetup) return <Navigate to="/setup" replace />
  return (
    <div className="page" style={{ maxWidth: 460, margin: '12vh auto 0' }}>
      <p className="kicker">Paper Trail</p>
      <h1>Welcome back.</h1>
      <p className="lede">The shelves kept your place.</p>
      <form
        className="settings-grid"
        onSubmit={(event) => {
          event.preventDefault()
          setError('')
          void login(password).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not sign in.'))
        }}
      >
        <label className="stack">
          <span>Password</span>
          <input className="field" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        </label>
        {error && <p style={{ color: 'var(--rose)' }}>{error}</p>}
        <button className="btn" type="submit">
          Enter
        </button>
      </form>
    </div>
  )
}
