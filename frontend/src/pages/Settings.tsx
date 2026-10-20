import { useEffect, useState } from 'react'
import { api } from '../api'
import { useAuth, useLibrary, useToast } from '../state'

type Preview = {
  token: string
  counts: { total: number; new: number; duplicates: number; invalid: number }
  samples: { title: string; authors: string[]; status: string; rating: number | null; existing: boolean }[]
  mappings: Record<string, string>
}

type UpdateInfo = {
  configured: boolean
  current: string
  latest?: string
  updateAvailable?: boolean
  notes?: string
  applyEnabled?: boolean
}

export function SettingsPage() {
  const { user, settings, saveSettings, setDisplayName, changePassword, logout } = useAuth()
  const { refresh } = useLibrary()
  const toast = useToast()
  const [name, setName] = useState(user?.displayName ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [goal, setGoal] = useState('24')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [policy, setPolicy] = useState('fill_empty')
  const [summary, setSummary] = useState<string>('')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [errors, setErrors] = useState<{ id: number; message: string; createdAt: string }[]>([])
  const year = new Date().getFullYear()

  useEffect(() => {
    void api<{ target: number | null }>(`/api/goals/${year}`).then((row) => {
      if (row.target) setGoal(String(row.target))
    })
    void api<UpdateInfo>('/api/updates').then(setUpdate).catch(() => setUpdate({ configured: false, current: '' }))
    void api<{ id: number; message: string; createdAt: string }[]>('/api/errors').then(setErrors).catch(() => setErrors([]))
  }, [year])

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
          <p className="meta">Upload the CSV from Goodreads. Covers are looked up afterwards. Your journal, quotes, and people are kept.</p>
          <input
            className="field"
            type="file"
            accept=".csv,text/csv"
            aria-label="Goodreads CSV"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              const form = new FormData()
              form.set('file', file)
              void api<Preview>('/api/import/goodreads/preview', { method: 'POST', form }).then(setPreview)
            }}
          />
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
                  }).then((result) => {
                    setSummary(`Imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}, failed ${result.failed}.`)
                    setPreview(null)
                    return refresh()
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
          <button
            type="button"
            className="btn secondary"
            onClick={() =>
              void api<{ updated: number; remaining: number }>('/api/metadata/refresh-missing', { method: 'POST', json: {} }).then((result) => {
                toast(`Filled ${result.updated} covers. ${result.remaining} still without one.`)
                return refresh()
              })
            }
          >
            Look up missing covers
          </button>
        </section>
        <section className="panel">
          <h2>Updates</h2>
          {update && (
            <p className="meta">
              Version {update.current || 'unknown'}
              {update.configured ? '' : '. Add PAPER_TRAIL_GITHUB_REPO to check GitHub releases.'}
              {update.updateAvailable ? ` A newer release, ${update.latest}, is available.` : update.configured ? ' You are on the latest release.' : ''}
            </p>
          )}
          <button type="button" className="btn secondary" onClick={() => void api<UpdateInfo>('/api/updates').then(setUpdate).then(() => toast('Checked for updates.'))}>
            Check for updates
          </button>
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
