import { useEffect, useState } from 'react'
import { api } from './api'
import { useJournalNav } from './shell'
import { useLibrary, useToast } from './state'
import { STATUS_LABEL, type Book, type ReadingStatus, type SearchHit } from './types'
import { Cover } from './covers'
import { Dialog } from './ui'

export function AddBook({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [status, setStatus] = useState<ReadingStatus>('want')
  const [manual, setManual] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [pages, setPages] = useState('')
  const [year, setYear] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { upsert } = useLibrary()
  const toast = useToast()
  const { openBook } = useJournalNav()

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHits(null)
    setManual(false)
    setError('')
  }, [open])

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits(null)
      return
    }
    const timer = window.setTimeout(() => {
      api<SearchHit[]>(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then(setHits)
        .catch(() => setHits([]))
    }, 280)
    return () => window.clearTimeout(timer)
  }, [query])

  async function place(payload: { hit?: SearchHit; title?: string; authors?: string[]; pageCount?: number; publishYear?: number }) {
    setBusy(true)
    setError('')
    try {
      const book = await api<Book>('/api/books', { method: 'POST', json: { status, ...payload } })
      upsert(book)
      toast(book.alreadyOwned ? 'That book is already on your shelves.' : 'Added to your library.')
      onClose()
      openBook(book.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The book could not be added.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} title="Add a book" onClose={onClose}>
      <label className="stack">
        <span>Shelf</span>
        <select className="select" value={status} onChange={(event) => setStatus(event.target.value as ReadingStatus)}>
          {(Object.keys(STATUS_LABEL) as ReadingStatus[]).map((key) => (
            <option key={key} value={key}>
              {STATUS_LABEL[key]}
            </option>
          ))}
        </select>
      </label>
      {!manual && (
        <label className="stack" style={{ marginTop: '0.8rem' }}>
          <span>Title, author, or ISBN</span>
          <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the catalog" autoFocus />
        </label>
      )}
      {error && <p style={{ color: 'var(--rose)' }}>{error}</p>}
      {!manual && hits && hits.length === 0 && <p className="meta">No matches yet. You can enter the book yourself.</p>}
      {!manual && hits && hits.length > 0 && (
        <ul className="person-list">
          {hits.map((hit) => (
            <li key={`${hit.workKey}-${hit.title}`}>
              <button
                type="button"
                className="book-face"
                style={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: '0.8rem', alignItems: 'center', width: '100%', padding: '0.55rem 0' }}
                disabled={busy}
                onClick={() => void place({ hit })}
              >
                <Cover title={hit.title} authors={hit.authors} coverUrl={hit.coverUrl} />
                <span className="caption">
                  <strong>{hit.title}</strong>
                  <em>
                    {hit.authors[0] ?? 'Unknown author'}
                    {hit.publishYear ? ` · ${hit.publishYear}` : ''}
                  </em>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {manual ? (
        <form
          className="settings-grid"
          style={{ marginTop: '0.8rem' }}
          onSubmit={(event) => {
            event.preventDefault()
            void place({
              title,
              authors: [author],
              pageCount: pages ? Number(pages) : undefined,
              publishYear: year ? Number(year) : undefined,
            })
          }}
        >
          <label className="stack">
            <span>Title</span>
            <input className="field" required value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="stack">
            <span>Author</span>
            <input className="field" required value={author} onChange={(event) => setAuthor(event.target.value)} />
          </label>
          <label className="stack">
            <span>Pages</span>
            <input className="field" inputMode="numeric" value={pages} onChange={(event) => setPages(event.target.value)} />
          </label>
          <label className="stack">
            <span>Year</span>
            <input className="field" inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value)} />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Save book
          </button>
        </form>
      ) : (
        <button type="button" className="quiet" onClick={() => setManual(true)}>
          Enter it by hand
        </button>
      )}
    </Dialog>
  )
}
