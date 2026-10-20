import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth, type InstallDatabase } from '../state'

type InstallDriver = InstallDatabase['driver']

type InstallStatus = {
  needsSetup: boolean
  configured: boolean
  driver: InstallDriver | null
  php: string
  phpOk: boolean
  sqlite: boolean
  mysql: boolean
  dataWritable: boolean
  ready: boolean
}

export function SetupPage() {
  const { needsSetup, loading, user, setup } = useAuth()
  const [status, setStatus] = useState<InstallStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [driver, setDriver] = useState<InstallDriver>('mysql')
  const [dbHost, setDbHost] = useState('localhost')
  const [dbPort, setDbPort] = useState('3306')
  const [dbName, setDbName] = useState('')
  const [dbUser, setDbUser] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!status || status.configured) return
    setDriver(status.mysql ? 'mysql' : 'sqlite')
  }, [status])

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

  const driverReady = status?.configured === true || (driver === 'mysql' ? status?.mysql === true : status?.sqlite === true)
  const ready = status?.phpOk === true && status.dataWritable && driverReady
  return (
    <div className="page" style={{ maxWidth: 560, margin: '8vh auto 0' }}>
      <p className="kicker">Paper Trail</p>
      <h1>Install the journal.</h1>
      <p className="lede">
        {status?.configured
          ? 'The database is already connected. Choose who the journal belongs to.'
          : 'MySQL keeps the shelves on the database server. A SQLite file is only for your own computer. The journal password is the key to the library.'}
      </p>
      {statusError !== '' && <p style={{ color: 'var(--rose)' }}>{statusError}</p>}
      {status && (
        <ul className="install-checks">
          <li data-state={status.phpOk ? 'ok' : 'bad'}>{status.phpOk ? 'PHP is ready.' : `PHP ${status.php} is too old. Use 8.1 or newer.`}</li>
          <li data-state={status.mysql ? 'ok' : 'bad'}>{status.mysql ? 'MySQL is available.' : 'Enable the PHP MySQL extension (pdo_mysql) to use a database server.'}</li>
          <li data-state={status.sqlite ? 'ok' : 'bad'}>{status.sqlite ? 'SQLite is available.' : 'Enable the PHP SQLite extension (pdo_sqlite) to keep a local file.'}</li>
          <li data-state={status.dataWritable ? 'ok' : 'bad'}>{status.dataWritable ? 'The site folder can be written.' : 'Make this folder writable so .env can be created.'}</li>
        </ul>
      )}
      {ready && status && (
        <form
          className="settings-grid"
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            const database = installDatabase(status.configured, driver, dbHost, dbPort, dbName, dbUser, dbPassword)
            void setup(name, password, database).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not set up.'))
          }}
        >
          {!status.configured && (
            <>
              <div className="seg" role="radiogroup" aria-label="Database">
                <button type="button" role="radio" aria-checked={driver === 'mysql'} disabled={!status.mysql} onClick={() => setDriver('mysql')}>
                  MySQL
                </button>
                <button type="button" role="radio" aria-checked={driver === 'sqlite'} disabled={!status.sqlite} onClick={() => setDriver('sqlite')}>
                  SQLite file
                </button>
              </div>
              <DatabaseFields
                driver={driver}
                dbHost={dbHost}
                dbPort={dbPort}
                dbName={dbName}
                dbUser={dbUser}
                dbPassword={dbPassword}
                onHost={setDbHost}
                onPort={setDbPort}
                onName={setDbName}
                onUser={setDbUser}
                onPassword={setDbPassword}
              />
            </>
          )}
          <label className="stack">
            <span>What should we call you?</span>
            <input className="field" required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="stack">
            <span>Journal password</span>
            <input className="field" required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
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

function installDatabase(configured: boolean, driver: InstallDriver, host: string, port: string, name: string, user: string, password: string): InstallDatabase | undefined {
  if (configured) return undefined
  switch (driver) {
    case 'sqlite':
      return { driver: 'sqlite' }
    case 'mysql':
      return { driver: 'mysql', host, port: Number(port), name, user, password }
    default: {
      const unexpected: never = driver
      return unexpected
    }
  }
}

function DatabaseFields({
  driver,
  dbHost,
  dbPort,
  dbName,
  dbUser,
  dbPassword,
  onHost,
  onPort,
  onName,
  onUser,
  onPassword,
}: {
  driver: InstallDriver
  dbHost: string
  dbPort: string
  dbName: string
  dbUser: string
  dbPassword: string
  onHost: (value: string) => void
  onPort: (value: string) => void
  onName: (value: string) => void
  onUser: (value: string) => void
  onPassword: (value: string) => void
}) {
  switch (driver) {
    case 'mysql':
      return (
        <>
          <label className="stack">
            <span>MySQL host</span>
            <input className="field" required value={dbHost} onChange={(event) => onHost(event.target.value)} />
          </label>
          <label className="stack">
            <span>Port</span>
            <input className="field" required inputMode="numeric" value={dbPort} onChange={(event) => onPort(event.target.value)} />
          </label>
          <label className="stack">
            <span>Database name</span>
            <input className="field" required value={dbName} onChange={(event) => onName(event.target.value)} />
          </label>
          <label className="stack">
            <span>MySQL username</span>
            <input className="field" required autoComplete="username" value={dbUser} onChange={(event) => onUser(event.target.value)} />
          </label>
          <label className="stack">
            <span>MySQL password</span>
            <input className="field" type="password" autoComplete="current-password" value={dbPassword} onChange={(event) => onPassword(event.target.value)} />
          </label>
        </>
      )
    case 'sqlite':
      return <p className="meta">The shelves will be stored in data/paper-trail.sqlite on this server.</p>
    default: {
      const unexpected: never = driver
      return unexpected
    }
  }
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
