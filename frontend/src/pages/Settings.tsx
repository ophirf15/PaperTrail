import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api'
import { useAuth, useLibrary, useToast } from '../state'
import { assertNever } from '../types'

type Preview = {
  token: string
  counts: { total: number; new: number; duplicates: number; invalid: number }
  samples: { title: string; authors: string[]; status: string; rating: number | null; existing: boolean }[]
  mappings: Record<string, string>
}

type CoverPhase = 'idle' | 'run' | 'wait' | 'done' | 'timeout' | 'stopped'

type CoverLookup = {
  phase: CoverPhase
  total: number
  remaining: number
  waitLeft: number
}

type CoverBatch = {
  checked: number
  updated: number
  remaining: number
  lastId: number
  exhausted: boolean
}

const COVER_WAIT_MS = 10_000
const COVER_LIMIT_MS = 5 * 60 * 1000

function missingCoverSentence(count: number): string {
  return count === 1 ? '1 cover is still missing.' : `${count} covers are still missing.`
}

function coverMessage(missingNow: number | null, lookup: CoverLookup): string {
  if (lookup.phase === 'idle') {
    if (missingNow == null) return 'Checking which covers are missing.'
    return missingNow === 0 ? 'Every book has a cover.' : missingCoverSentence(missingNow)
  }
  switch (lookup.phase) {
    case 'run':
      return `Looking up covers. ${missingCoverSentence(lookup.remaining)}`
    case 'wait':
      return `Pausing between lookups. ${missingCoverSentence(lookup.remaining)}`
    case 'done':
      return 'Every book has a cover.'
    case 'timeout':
      return `Stopped after 5 minutes. ${missingCoverSentence(lookup.remaining)}`
    case 'stopped':
      return `Stopped. ${missingCoverSentence(lookup.remaining)}`
    default:
      return assertNever(lookup.phase)
  }
}

function pause(ms: number, shouldStop: () => boolean, onTick: (seconds: number) => void): Promise<void> {
  const end = Date.now() + ms
  return new Promise((resolve) => {
    const timer = window.setInterval(() => {
      const left = Math.max(0, end - Date.now())
      onTick(Math.ceil(left / 1000))
      if (left === 0 || shouldStop()) {
        window.clearInterval(timer)
        resolve()
      }
    }, 200)
  })
}

type UpdateInfo = {
  configured: boolean
  current: string
  latest?: string
  updateAvailable?: boolean
  notes?: string
  applyEnabled?: boolean
  asset?: { name: string; url: string } | null
}

export function SettingsPage() {
  const { user, settings, saveSettings, setDisplayName, changePassword, logout } = useAuth()
  const { books, refresh } = useLibrary()
  const toast = useToast()
  const [name, setName] = useState(user?.displayName ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [goal, setGoal] = useState('24')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [reading, setReading] = useState(false)
  const [importError, setImportError] = useState('')
  const [policy, setPolicy] = useState('fill_empty')
  const [summary, setSummary] = useState<string>('')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [lookup, setLookup] = useState<CoverLookup>({ phase: 'idle', total: 0, remaining: 0, waitLeft: 0 })
  const coverRun = useRef(false)
  const coverStop = useRef(false)
  const alive = useRef(true)
  const [errors, setErrors] = useState<{ id: number; message: string; createdAt: string }[]>([])
  const year = new Date().getFullYear()

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      coverStop.current = true
    }
  }, [])

  useEffect(() => {
    void api<{ target: number | null }>(`/api/goals/${year}`).then((row) => {
      if (row.target) setGoal(String(row.target))
    })
    void api<UpdateInfo>('/api/updates').then(setUpdate).catch(() => setUpdate({ configured: false, current: '' }))
    void api<{ id: number; message: string; createdAt: string }[]>('/api/errors').then(setErrors).catch(() => setErrors([]))
  }, [year])

  const missingNow = books ? books.filter((book) => !book.coverUrl).length : null
  const lookingUp = lookup.phase === 'run' || lookup.phase === 'wait'

  async function lookupCovers() {
    if (coverRun.current || missingNow == null || missingNow === 0) return
    coverRun.current = true
    coverStop.current = false
    const deadline = Date.now() + COVER_LIMIT_MS
    let afterId = 0
    let total = missingNow
    let remaining = missingNow
    let phase: CoverPhase = 'run'
    let failed = false
    const controller = new AbortController()
    const stopWatch = window.setInterval(() => {
      if (coverStop.current) controller.abort()
    }, 200)
    setLookup({ phase: 'run', total, remaining, waitLeft: 0 })
    try {
      while (!coverStop.current && Date.now() < deadline) {
        let batch: CoverBatch
        try {
          batch = await api<CoverBatch>('/api/metadata/refresh-missing', { method: 'POST', json: { afterId }, signal: controller.signal })
        } catch (error) {
          if (!alive.current || coverStop.current || (error instanceof Error && error.name === 'AbortError')) break
          if (error instanceof ApiError && error.status === 401) {
            failed = true
            break
          }
          if (Date.now() + COVER_WAIT_MS >= deadline) {
            phase = 'timeout'
            break
          }
          phase = 'wait'
          setLookup({ phase, total, remaining, waitLeft: COVER_WAIT_MS / 1000 })
          await pause(COVER_WAIT_MS, () => coverStop.current, (seconds) => {
            if (alive.current) setLookup({ phase: 'wait', total, remaining, waitLeft: seconds })
          })
          continue
        }
        if (!alive.current || coverStop.current) break
        total = Math.max(total, batch.remaining + batch.updated)
        remaining = batch.remaining
        phase = 'run'
        setLookup({ phase, total, remaining, waitLeft: 0 })
        try {
          await refresh()
        } catch {
          // The batch is already saved. The shelves catch up on the next pass.
        }
        if (remaining === 0) {
          phase = 'done'
          break
        }
        if (Date.now() + COVER_WAIT_MS >= deadline) {
          phase = 'timeout'
          break
        }
        afterId = batch.exhausted ? 0 : batch.lastId
        phase = 'wait'
        setLookup({ phase, total, remaining, waitLeft: COVER_WAIT_MS / 1000 })
        await pause(COVER_WAIT_MS, () => coverStop.current, (seconds) => {
          if (alive.current) setLookup({ phase: 'wait', total, remaining, waitLeft: seconds })
        })
      }
      if (!alive.current) return
      if (coverStop.current && phase !== 'done') phase = 'stopped'
      else if (failed) phase = 'stopped'
      else if (phase !== 'done' && remaining > 0) phase = 'timeout'
      setLookup({ phase, total, remaining, waitLeft: 0 })
      if (phase === 'done') toast('Every book has a cover.')
      else if (phase === 'timeout') toast(`Stopped after 5 minutes. ${missingCoverSentence(remaining)}`)
      else if (failed) toast(`Cover lookup did not finish. ${missingCoverSentence(remaining)}`)
      else toast(`Stopped. ${missingCoverSentence(remaining)}`)
    } catch {
      if (!alive.current) return
      setLookup({ phase: 'stopped', total, remaining, waitLeft: 0 })
      toast(`Cover lookup did not finish. ${missingCoverSentence(remaining)}`)
    } finally {
      window.clearInterval(stopWatch)
      coverRun.current = false
    }
  }

  return (
    <div className="page">
      <p className="kicker">The endpapers</p>
      <h1>Settings</h1>
      <div className="settings-grid">
        <section className="panel">
          <h2>Your name</h2>
          <form
            className="mini-progress"
            onSubmit={(event) => {
              event.preventDefault()
              void setDisplayName(name).then(() => toast('Name saved.'))
            }}
          >
            <input className="field" aria-label="Display name" value={name} onChange={(event) => setName(event.target.value)} />
            <button className="btn" type="submit">
              Save
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>Password</h2>
          <form
            className="settings-grid"
            onSubmit={(event) => {
              event.preventDefault()
              setPasswordError('')
              if (nextPassword !== confirmPassword) {
                setPasswordError('The new passwords do not match.')
                return
              }
              void changePassword(currentPassword, nextPassword)
                .then(() => {
                  setCurrentPassword('')
                  setNextPassword('')
                  setConfirmPassword('')
                  toast('Password changed.')
                })
                .catch((caught: unknown) => setPasswordError(caught instanceof Error ? caught.message : 'Could not change the password.'))
            }}
          >
            <label className="stack">
              <span>Current password</span>
              <input className="field" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </label>
            <label className="stack">
              <span>New password</span>
              <input className="field" type="password" autoComplete="new-password" minLength={8} required value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} />
            </label>
            <label className="stack">
              <span>Confirm new password</span>
              <input className="field" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
            {passwordError !== '' && <p style={{ color: 'var(--rose)' }}>{passwordError}</p>}
            <button className="btn" type="submit">
              Change password
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>Theme and shelves</h2>
          <div className="seg">
            <button type="button" aria-pressed={settings.theme === 'light'} onClick={() => void saveSettings({ theme: 'light' })}>
              Warm light
            </button>
            <button type="button" aria-pressed={settings.theme === 'dark'} onClick={() => void saveSettings({ theme: 'dark' })}>
              Cozy dark
            </button>
          </div>
          <div className="seg" style={{ marginTop: '0.6rem' }}>
            <button type="button" aria-pressed={settings.shelfView === 'shelf'} onClick={() => void saveSettings({ shelfView: 'shelf' })}>
              Bookshelves
            </button>
            <button type="button" aria-pressed={settings.shelfView === 'gallery'} onClick={() => void saveSettings({ shelfView: 'gallery' })}>
              Gallery
            </button>
            <button type="button" aria-pressed={settings.shelfView === 'ledger'} onClick={() => void saveSettings({ shelfView: 'ledger' })}>
              Ledger
            </button>
          </div>
          <div className="seg" style={{ marginTop: '0.6rem' }}>
            <button type="button" aria-pressed={settings.shelfStyle === 'spines'} onClick={() => void saveSettings({ shelfStyle: 'spines' })}>
              Spines
            </button>
            <button type="button" aria-pressed={settings.shelfStyle === 'mixed'} onClick={() => void saveSettings({ shelfStyle: 'mixed' })}>
              Mixed
            </button>
            <button type="button" aria-pressed={settings.shelfStyle === 'covers'} onClick={() => void saveSettings({ shelfStyle: 'covers' })}>
              Covers
            </button>
          </div>
        </section>
        <section className="panel">
          <h2>Reading goal for {year}</h2>
          <form
            className="mini-progress"
            onSubmit={(event) => {
              event.preventDefault()
              void api(`/api/goals/${year}`, { method: 'PUT', json: { target: Number(goal) } }).then(() => toast('Goal saved.'))
            }}
          >
            <input className="field" inputMode="numeric" aria-label="Books this year" value={goal} onChange={(event) => setGoal(event.target.value)} />
            <button className="btn" type="submit">
              Save goal
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>Sample shelf</h2>
          <p className="meta">A clearly marked preview set. It never mixes into a Goodreads import, and you can remove it in one step.</p>
          <div className="actions">
            <button type="button" className="btn secondary" onClick={() => void api('/api/sample-shelf', { method: 'POST', json: {} }).then(() => refresh()).then(() => toast('Sample shelf added.'))}>
              Preview with sample books
            </button>
            <button type="button" className="btn secondary" onClick={() => void api('/api/sample-shelf', { method: 'DELETE' }).then(() => refresh()).then(() => toast('Sample books removed.'))}>
              Remove samples
            </button>
          </div>
        </section>
        <section className="panel">
          <h2>Goodreads import</h2>
          <p className="meta">Choose the CSV from Goodreads, then upload it. Covers are looked up afterwards. Your journal, quotes, and people are kept.</p>
          <div className="mini-progress">
            <label className="btn secondary file-picker">
              Choose CSV
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="Goodreads CSV"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null
                  setCsvFile(file)
                  setPreview(null)
                  setSummary('')
                  setImportError('')
                }}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={csvFile === null || reading}
              onClick={() => {
                if (!csvFile) return
                const form = new FormData()
                form.set('file', csvFile)
                setReading(true)
                setImportError('')
                void api<Preview>('/api/import/goodreads/preview', { method: 'POST', form })
                  .then((next) => {
                    setPreview(next)
                    toast('File read. Review the books, then import.')
                  })
                  .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : 'The CSV could not be read.'
                    setPreview(null)
                    setImportError(message)
                    toast(message)
                  })
                  .finally(() => setReading(false))
              }}
            >
              {reading ? 'Reading…' : 'Upload CSV'}
            </button>
          </div>
          {csvFile && <p className="meta">{csvFile.name}</p>}
          {importError && <p className="meta">{importError}</p>}
          {preview && (
            <div>
              <p>
                {preview.counts.total} rows · {preview.counts.new} new · {preview.counts.duplicates} already on your shelves
              </p>
              <ul>
                {preview.samples.map((sample) => (
                  <li key={sample.title}>
                    {sample.title} — {sample.authors[0] ?? 'Unknown'} · {sample.status}
                    {sample.existing ? ' · already here' : ''}
                  </li>
                ))}
              </ul>
              <label className="stack">
                <span>When a book is already here</span>
                <select className="select" value={policy} onChange={(event) => setPolicy(event.target.value)}>
                  <option value="fill_empty">Fill only blank ratings, dates, and status</option>
                  <option value="keep_local">Keep my edits</option>
                  <option value="use_import">Use the Goodreads values</option>
                </select>
              </label>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void api<{ imported: number; updated: number; skipped: number; failed: number }>('/api/import/goodreads/commit', {
                    method: 'POST',
                    json: { token: preview.token, policy },
                  })
                    .then((result) => {
                      setSummary(`Imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}, failed ${result.failed}.`)
                      setPreview(null)
                      setCsvFile(null)
                      return refresh()
                    })
                    .catch((error: unknown) => {
                      const message = error instanceof Error ? error.message : 'The import did not finish.'
                      setImportError(message)
                      toast(message)
                    })
                }
              >
                Import books
              </button>
            </div>
          )}
          {summary && <p>{summary}</p>}
        </section>
        <section className="panel">
          <h2>Take it with you</h2>
          <div className="actions">
            <button type="button" className="btn secondary" onClick={() => void download('/api/export/json', 'paper-trail-backup.json')}>
              Download backup
            </button>
            <button type="button" className="btn secondary" onClick={() => void download('/api/export/csv', 'paper-trail-library.csv')}>
              Download CSV
            </button>
          </div>
          <label className="stack" style={{ marginTop: '0.8rem' }}>
            <span>Restore a backup</span>
            <input
              className="field"
              type="file"
              accept="application/json"
              aria-label="Backup file"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                if (!window.confirm('Replace your current shelves with this backup?')) return
                const form = new FormData()
                form.set('file', file)
                form.set('confirm', 'yes')
                void api('/api/import/backup', { method: 'POST', form }).then(() => refresh()).then(() => toast('Library restored.'))
              }}
            />
          </label>
        </section>
        <section className="panel">
          <h2>Missing covers</h2>
          <p className="meta" aria-live="polite">
            {coverMessage(missingNow, lookup)}
          </p>
          {lookup.total > 0 && lookup.phase !== 'idle' && (
            <div
              className="progress cover-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={lookup.total}
              aria-valuenow={Math.max(0, lookup.total - lookup.remaining)}
              aria-label="Cover lookup"
            >
              <span style={{ width: `${Math.min(100, Math.round(((lookup.total - lookup.remaining) / lookup.total) * 100))}%` }} />
            </div>
          )}
          {lookup.phase === 'wait' && <p className="meta">Next lookup in {lookup.waitLeft} {lookup.waitLeft === 1 ? 'second' : 'seconds'}.</p>}
          <div className="cover-actions">
            <button
              type="button"
              className={`btn secondary${lookingUp ? ' is-busy' : ''}`}
              disabled={lookingUp || missingNow == null || missingNow === 0}
              aria-busy={lookingUp}
              onClick={() => void lookupCovers()}
            >
              {lookingUp ? 'Looking up covers…' : 'Look up missing covers'}
            </button>
            {lookingUp && (
              <button type="button" className="btn secondary" onClick={() => { coverStop.current = true }}>
                Stop
              </button>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Updates</h2>
          {update && (
            <p className="meta">
              Version {update.current || 'unknown'}
              {update.updateAvailable
                ? ` A newer release, ${update.latest}, is ready. Installing keeps your library and password.`
                : update.configured
                  ? ' You are on the latest release.'
                  : ''}
            </p>
          )}
          {update?.notes ? <p className="meta">{update.notes}</p> : null}
          <div className="mini-progress">
            <button type="button" className="btn secondary" disabled={installing} onClick={() => void api<UpdateInfo>('/api/updates').then(setUpdate).then(() => toast('Checked for updates.'))}>
              Check for updates
            </button>
            {update?.updateAvailable && update.asset?.url ? (
              <button
                type="button"
                className="btn"
                disabled={installing}
                onClick={() => {
                  if (!update.latest || installing) return
                  if (!window.confirm(`Install Paper Trail ${update.latest} now? Your library and password stay. This page reloads when it finishes.`)) return
                  setInstalling(true)
                  void api('/api/updates/apply', { method: 'POST', json: { version: update.latest } })
                    .then(() => {
                      toast('Updated. Reloading…')
                      window.setTimeout(() => window.location.reload(), 800)
                    })
                    .catch((error: unknown) => {
                      toast(error instanceof Error ? error.message : 'Could not install the update.')
                      setInstalling(false)
                    })
                }}
              >
                {installing ? 'Installing…' : `Install ${update.latest}`}
              </button>
            ) : null}
          </div>
        </section>
        <section className="panel">
          <h2>Recent errors</h2>
          {errors.length === 0 ? <p className="meta">Nothing recorded in the last 30 days.</p> : (
            <ul>
              {errors.slice(0, 6).map((error) => (
                <li key={error.id}>
                  {error.message}
                </li>
              ))}
            </ul>
          )}
        </section>
        <button type="button" className="btn secondary" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </div>
  )
}

async function download(path: string, filename: string) {
  const blob = await api<Blob>(path)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
