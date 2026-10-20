import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../state'

type InstallStatus = {
  needsSetup: boolean
  php: string
  phpOk: boolean
  sqlite: boolean
  dataWritable: boolean
  ready: boolean
}

export function SetupPage() {
  const { needsSetup, loading, user, setup } = useAuth()
  const [status, setStatus] = useState<InstallStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api<InstallStatus>('/api/install-status')
      .then((next) => {
        if (alive) setStatus(next)
      })
      .catch((caught: unknown) => {
        if (alive) setStatusError(caught instanceof Error ? caught.message : 'The installer could not check this server.')
      })
    return () => {
      alive = false
    }
  }, [])

  if (loading || (status === null && statusError === '')) return <p className="page meta">Opening the journal…</p>
  if (user) return <Navigate to="/" replace />
  if (!needsSetup && status?.needsSetup !== true) return <Navigate to="/login" replace />

  const ready = status?.ready === true
  return (
    <div className="page" style={{ maxWidth: 520, margin: '10vh auto 0' }}>
      <p className="kicker">Paper Trail</p>
      <h1>Install the journal.</h1>
      <p className="lede">This folder is the whole site. Choose who it belongs to, and the shelves are created at data/paper-trail.sqlite.</p>
      {statusError !== '' && <p style={{ color: 'var(--rose)' }}>{statusError}</p>}
      {status && (
        <ul className="install-checks">
          <li data-state={status.phpOk ? 'ok' : 'bad'}>{status.phpOk ? 'PHP is ready.' : `PHP ${status.php} is too old. Use 8.1 or newer.`}</li>
          <li data-state={status.sqlite ? 'ok' : 'bad'}>{status.sqlite ? 'SQLite is available.' : 'Enable the PHP SQLite extension (pdo_sqlite).'}</li>
          <li data-state={status.dataWritable ? 'ok' : 'bad'}>{status.dataWritable ? 'The site folder can be written.' : 'Make this folder writable so data/ and .env can be created.'}</li>
        </ul>
      )}
      {ready && (
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
      )}
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
