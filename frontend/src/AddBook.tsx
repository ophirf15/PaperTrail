import { useEffect, useState } from 'react'
import { api } from './api'
import { useJournalNav } from './shell'
import { useLibrary, useToast } from './state'
import { STATUS_LABEL, type Book, type ReadingStatus, type SearchHit } from './types'
import { Cover } from './covers'
import { Dialog } from './ui'

function SearchSkeleton() {
  return (
    <ul className="person-list" aria-busy="true" aria-label="Searching the catalog">
      {[0, 1, 2].map((row) => (
        <li key={row} className="hit-skeleton">
          <span className="skeleton hit-cover" />
          <span>
            <span className="skeleton hit-line" />
            <span className="skeleton hit-line short" />
          </span>
        </li>
      ))}
    </ul>
  )
}

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
  const [picked, setPicked] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const { upsert } = useLibrary()
  const toast = useToast()
  const { openBook } = useJournalNav()

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHits(null)
    setManual(false)
    setPicked(null)
    setSearching(false)
    setError('')
  }, [open])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits(null)
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    const timer = window.setTimeout(() => {
      api<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((next) => {
          if (!cancelled) setHits(next)
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
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
      {!manual && searching && <SearchSkeleton />}
      {!manual && !searching && hits && hits.length === 0 && <p className="meta">No matches yet. You can enter the book yourself.</p>}
      {!manual && !searching && hits && hits.length > 0 && (
        <ul className="person-list">
          {hits.map((hit) => {
            const key = `${hit.workKey}-${hit.title}`
            const pending = picked === key
            return (
              <li key={key}>
                <button
                  type="button"
                  className="book-face hit-choice"
                  aria-busy={pending}
                  disabled={busy}
                  onClick={() => {
                    if (busy) return
                    setPicked(key)
                    void place({ hit }).finally(() => setPicked(null))
                  }}
                >
                  {pending ? (
                    <span className="hit-skeleton">
                      <span className="skeleton hit-cover" />
                      <span>
                        <span className="skeleton hit-line" />
                        <span className="skeleton hit-line short" />
                      </span>
                    </span>
                  ) : (
                    <>
                      <Cover title={hit.title} authors={hit.authors} coverUrl={hit.coverUrl} />
                      <span className="caption">
                        <strong>{hit.title}</strong>
                        <em>
                          {hit.authors[0] ?? 'Unknown author'}
                          {hit.publishYear ? ` · ${hit.publishYear}` : ''}
                        </em>
                      </span>
                    </>
                  )}
                </button>
              </li>
            )
          })}
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
