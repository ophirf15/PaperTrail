import { Bold, Copy, Italic, List, ListOrdered, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { Cover } from './covers'
import { useLibrary, useToast } from './state'
import {
  STATUS_LABEL,
  assertNever,
  authorLine,
  formatDate,
  progressOf,
  type Book,
  type BookDetail,
  type Contact,
  type Quote,
  type ReadingStatus,
} from './types'
import { Confirm, Dialog, Stars } from './ui'

type Tab = 'overview' | 'journal' | 'quotes' | 'share'

function asTab(value: string | null): Tab {
  if (value === 'journal' || value === 'quotes' || value === 'share' || value === 'overview') return value
  return 'overview'
}

export function BookModal({ bookId, initialTab, onClose }: { bookId: string | null; initialTab: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<BookDetail | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [error, setError] = useState('')
  const { upsert, remove } = useLibrary()
  const toast = useToast()

  useEffect(() => {
    if (!bookId) return
    let alive = true
    setDetail(null)
    setError('')
    setTab(asTab(initialTab))
    api<BookDetail>(`/api/books/${bookId}`)
      .then((book) => {
        if (alive) setDetail(book)
      })
      .catch((caught: unknown) => {
        if (alive) setError(caught instanceof Error ? caught.message : 'Could not open that book.')
      })
    return () => {
      alive = false
    }
  }, [bookId, initialTab])

  async function saveEntry(patch: Record<string, unknown>) {
    if (!detail) return
    const next = await api<Book>(`/api/books/${detail.id}/entry`, { method: 'PATCH', json: patch })
    upsert(next)
    setDetail((current) => (current ? { ...current, ...next } : current))
    if (next.goalReached) window.dispatchEvent(new CustomEvent('pt-goal', { detail: next }))
    return next
  }

  return (
    <Dialog open={bookId != null} title={detail?.title ?? 'Book'} onClose={onClose}>
      {error && <p style={{ color: 'var(--rose)' }}>{error}</p>}
      {!detail && !error && <div className="skeleton" style={{ height: 280 }} />}
      {detail && (
        <div className="book-modal">
          <div>
            <Cover title={detail.title} authors={detail.authors} coverUrl={detail.coverUrl} />
          </div>
          <div>
            <p className="meta" style={{ marginTop: 0 }}>
              {authorLine(detail.authors)}
              {detail.publishYear ? ` · ${detail.publishYear}` : ''}
              {detail.readCount > 1 ? ` · Read ${detail.readCount} times` : ''}
            </p>
            <div className="tabs" role="tablist" aria-label="Book sections">
              {(
                [
                  ['overview', 'Overview'],
                  ['journal', 'Journal'],
                  ['quotes', 'Quotes'],
                  ['share', 'Share'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" className="tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            {tab === 'overview' && <Overview book={detail} onEntry={saveEntry} onMeta={setDetail} onRemove={() => { remove(detail.id); onClose() }} toast={toast} />}
            {tab === 'journal' && <JournalPad key={detail.id} bookId={detail.id} initial={detail.journalHtml} />}
            {tab === 'quotes' && <Quotes bookId={detail.id} initial={detail.quotes} toast={toast} />}
            {tab === 'share' && <Share bookId={detail.id} initial={detail.recommendations} toast={toast} />}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function Overview({
  book,
  onEntry,
  onMeta,
  onRemove,
  toast,
}: {
  book: BookDetail
  onEntry: (patch: Record<string, unknown>) => Promise<Book | undefined>
  onMeta: (book: BookDetail) => void
  onRemove: () => void
  toast: (message: string) => void
}) {
  const [page, setPage] = useState(book.currentPage?.toString() ?? '')
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const progress = progressOf(book)
  useEffect(() => setPage(book.currentPage?.toString() ?? ''), [book.currentPage, book.id])

  return (
    <div>
      <p className="prose">{book.description || 'No description was found for this edition. The story is still yours to keep.'}</p>
      <div className="chips">
        {book.pageCount ? <span className="chip">{book.pageCount} pages</span> : null}
        {book.publisher ? <span className="chip">{book.publisher}</span> : null}
        {book.genres.slice(0, 4).map((genre) => (
          <span className="chip" key={genre}>
            {genre}
          </span>
        ))}
        <span className="chip">{STATUS_LABEL[book.status]}</span>
      </div>
      <label className="stack">
        <span>Reading status</span>
        <select
          className="select"
          value={book.status}
          onChange={(event) => {
            const status = event.target.value as ReadingStatus
            void onEntry({ status, dateFinished: status === 'finished' ? new Date().toISOString().slice(0, 10) : undefined }).then(() => toast(`Moved to ${STATUS_LABEL[status]}.`))
          }}
        >
          {(Object.keys(STATUS_LABEL) as ReadingStatus[]).map((key) => (
            <option key={key} value={key}>
              {STATUS_LABEL[key]}
            </option>
          ))}
        </select>
      </label>
      <div className="section-head">
        <h3>Progress</h3>
        <span className="meta">{progress != null ? `${progress}%` : 'Not started'}</span>
      </div>
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${progress ?? 0}%` }} />
      </div>
      <form
        className="mini-progress"
        onSubmit={(event) => {
          event.preventDefault()
          void onEntry({ currentPage: page === '' ? null : Number(page) }).then(() => toast('Progress saved.'))
        }}
      >
        <input className="field" inputMode="numeric" aria-label="Current page" value={page} onChange={(event) => setPage(event.target.value)} placeholder="Page" />
        {book.pageCount ? <span className="meta">of {book.pageCount}</span> : null}
        <button className="btn secondary" type="submit">
          Update
        </button>
      </form>
      <div className="section-head">
        <h3>Your rating</h3>
      </div>
      <Stars
        value={book.rating}
        onChange={(rating) => {
          void onEntry({ rating }).then(() => toast('Rating saved.'))
        }}
      />
      <div className="settings-grid" style={{ marginTop: '1rem' }}>
        <label className="stack">
          <span>Date started</span>
          <input className="field" type="date" value={book.dateStarted ?? ''} onChange={(event) => void onEntry({ dateStarted: event.target.value || null })} />
        </label>
        <label className="stack">
          <span>Date finished</span>
          <input className="field" type="date" value={book.dateFinished ?? ''} onChange={(event) => void onEntry({ dateFinished: event.target.value || null })} />
        </label>
      </div>
      {book.importedReview && (
        <p className="meta">
          From an imported review: {book.importedReview}
        </p>
      )}
      <div className="actions">
        {book.status === 'finished' && (
          <button type="button" className="btn secondary" onClick={() => void onEntry({ status: 'reading' }).then(() => toast('Opened a new reading.'))}>
            Read again
          </button>
        )}
        <button type="button" className="quiet" onClick={() => setEditing((value) => !value)}>
          {editing ? 'Close details' : 'Edit details'}
        </button>
        <button type="button" className="quiet" onClick={() => void api<BookDetail>(`/api/books/${book.id}/refresh`, { method: 'POST', json: {} }).then(onMeta).then(() => toast('Filled in any missing details.'))}>
          Refresh metadata
        </button>
        <button type="button" className="quiet" onClick={() => setConfirming(true)}>
          Remove
        </button>
      </div>
      {editing && <MetadataForm book={book} onMeta={onMeta} toast={toast} />}
      <Confirm
        open={confirming}
        title="Remove this book?"
        body="Quotes, journal notes, and recommendation links for this book will be removed with it."
        confirmLabel="Remove book"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          void api(`/api/books/${book.id}`, { method: 'DELETE' }).then(() => {
            toast('Removed from your library.')
            onRemove()
          })
        }}
      />
    </div>
  )
}

function MetadataForm({ book, onMeta, toast }: { book: BookDetail; onMeta: (book: BookDetail) => void; toast: (message: string) => void }) {
  const [title, setTitle] = useState(book.title)
  const [authors, setAuthors] = useState(book.authors.join(', '))
  const [description, setDescription] = useState(book.description ?? '')
  const [pages, setPages] = useState(book.pageCount?.toString() ?? '')
  return (
    <form
      className="settings-grid"
      onSubmit={(event) => {
        event.preventDefault()
        void api<BookDetail>(`/api/books/${book.id}`, {
          method: 'PATCH',
          json: {
            title,
            authors: authors.split(',').map((part) => part.trim()).filter(Boolean),
            description,
            pageCount: pages === '' ? null : Number(pages),
          },
        }).then((next) => {
          onMeta({ ...book, ...next })
          toast('Details saved.')
        })
      }}
    >
      <label className="stack">
        <span>Title</span>
        <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="stack">
        <span>Authors</span>
        <input className="field" value={authors} onChange={(event) => setAuthors(event.target.value)} />
      </label>
      <label className="stack">
        <span>Pages</span>
        <input className="field" value={pages} onChange={(event) => setPages(event.target.value)} />
      </label>
      <label className="stack">
        <span>Description</span>
        <textarea className="area" value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <button className="btn" type="submit">
        Save details
      </button>
    </form>
  )
}

function JournalPad({ bookId, initial }: { bookId: number; initial: string }) {
  const [html, setHtml] = useState(initial)
  const [state, setState] = useState<'saved' | 'saving' | 'unsaved'>('saved')

  useEffect(() => {
    const node = document.getElementById(`journal-${bookId}`)
    if (node) node.innerHTML = initial
    setHtml(initial)
    setState('saved')
    // The editor owns later edits. Reset only when this book is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  useEffect(() => {
    if (state !== 'unsaved') return
    const timer = window.setTimeout(() => {
      setState('saving')
      api(`/api/books/${bookId}/journal`, { method: 'PUT', json: { bodyHtml: html } })
        .then(() => setState('saved'))
        .catch(() => setState('unsaved'))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [html, state, bookId])

  function format(command: 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList') {
    document.execCommand(command)
    const node = document.getElementById(`journal-${bookId}`)
    setHtml(node?.innerHTML ?? '')
    setState('unsaved')
  }

  const label = state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved' : 'Saved'

  return (
    <div>
      <div className="editor-bar">
        <button type="button" className="icon-btn" aria-label="Bold" data-tip="Bold" onClick={() => format('bold')}>
          <Bold size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Italic" data-tip="Italic" onClick={() => format('italic')}>
          <Italic size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Bullet list" data-tip="Bullets" onClick={() => format('insertUnorderedList')}>
          <List size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Numbered list" data-tip="Numbers" onClick={() => format('insertOrderedList')}>
          <ListOrdered size={16} />
        </button>
      </div>
      <div
        id={`journal-${bookId}`}
        className="editor"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Journal"
        data-placeholder="What stayed with you?"
        onInput={(event) => {
          setHtml(event.currentTarget.innerHTML)
          setState('unsaved')
        }}
        onPaste={(event) => {
          event.preventDefault()
          const text = event.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, text)
        }}
      />
      <p className="save-state" aria-live="polite">
        {label}
      </p>
    </div>
  )
}

function Quotes({ bookId, initial, toast }: { bookId: number; initial: Quote[]; toast: (message: string) => void }) {
  const [quotes, setQuotes] = useState(initial)
  const [body, setBody] = useState('')
  const [location, setLocation] = useState('')
  const [note, setNote] = useState('')
  const [removeId, setRemoveId] = useState<number | null>(null)
  const [edit, setEdit] = useState<Quote | null>(null)
  useEffect(() => setQuotes(initial), [initial])

  return (
    <div>
      <form
        className="settings-grid"
        onSubmit={(event) => {
          event.preventDefault()
          void api<Quote>(`/api/books/${bookId}/quotes`, { method: 'POST', json: { body, location, note } }).then((quote) => {
            setQuotes((current) => [quote, ...current])
            setBody('')
            setLocation('')
            setNote('')
            toast('Quote saved.')
          })
        }}
      >
        <label className="stack">
          <span>Quote</span>
          <textarea className="area" required value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        <label className="stack">
          <span>Page or location</span>
          <input className="field" value={location} onChange={(event) => setLocation(event.target.value)} />
        </label>
        <label className="stack">
          <span>Note</span>
          <input className="field" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <button className="btn" type="submit">
          Save quote
        </button>
      </form>
      {quotes.length === 0 && <p className="lede">No lines saved yet. Keep the ones you want to find again.</p>}
      {quotes.map((quote) => (
        <blockquote className="quote-card" key={quote.id}>
          <p>“{quote.body}”</p>
          <footer>
            <span>
              {quote.location ? `${quote.location} · ` : ''}
              {formatDate(quote.createdAt)}
              {quote.note ? ` · ${quote.note}` : ''}
            </span>
            <span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Copy quote"
                data-tip="Copy"
                onClick={() => void navigator.clipboard.writeText(quote.body).then(() => toast('Copied.'))}
              >
                <Copy size={16} />
              </button>
              <button type="button" className="quiet" onClick={() => setEdit(quote)}>
                Edit
              </button>
              <button type="button" className="icon-btn" aria-label="Delete quote" data-tip="Delete" onClick={() => setRemoveId(quote.id)}>
                <Trash2 size={16} />
              </button>
            </span>
          </footer>
        </blockquote>
      ))}
      {edit && (
        <form
          className="settings-grid"
          onSubmit={(event) => {
            event.preventDefault()
            void api<Quote>(`/api/quotes/${edit.id}`, {
              method: 'PATCH',
              json: { body: edit.body, location: edit.location, note: edit.note },
            }).then((saved) => {
              setQuotes((current) => current.map((quote) => (quote.id === saved.id ? saved : quote)))
              setEdit(null)
              toast('Quote updated.')
            })
          }}
        >
          <label className="stack">
            <span>Edit quote</span>
            <textarea className="area" value={edit.body} onChange={(event) => setEdit({ ...edit, body: event.target.value })} />
          </label>
          <input className="field" aria-label="Location" value={edit.location ?? ''} onChange={(event) => setEdit({ ...edit, location: event.target.value })} />
          <input className="field" aria-label="Note" value={edit.note ?? ''} onChange={(event) => setEdit({ ...edit, note: event.target.value })} />
          <button className="btn" type="submit">
            Update quote
          </button>
        </form>
      )}
      <Confirm
        open={removeId != null}
        title="Delete this quote?"
        body="This only removes your saved line, not anything from the book."
        confirmLabel="Delete quote"
        onClose={() => setRemoveId(null)}
        onConfirm={() => {
          if (removeId == null) return
          void api(`/api/quotes/${removeId}`, { method: 'DELETE' }).then(() => {
            setQuotes((current) => current.filter((quote) => quote.id !== removeId))
            setRemoveId(null)
            toast('Quote deleted.')
          })
        }}
      />
    </div>
  )
}

function Share({
  bookId,
  initial,
  toast,
}: {
  bookId: number
  initial: BookDetail['recommendations']
  toast: (message: string) => void
}) {
  const [people, setPeople] = useState<Contact[]>([])
  const [links, setLinks] = useState(initial)
  const [name, setName] = useState('')
  useEffect(() => setLinks(initial), [initial])
  useEffect(() => {
    void api<Contact[]>('/api/contacts').then(setPeople)
  }, [])

  function linked(contactId: number) {
    return links.find((item) => item.contactId === contactId)
  }

  return (
    <div>
      <h3>Who I'd share this with</h3>
      <p className="meta">A private note about who might love it. Nothing is sent.</p>
      {people.length === 0 && <p className="lede">Add someone you often think of when a book fits.</p>}
      {people.map((person) => {
        const link = linked(person.id)
        return (
          <div key={person.id} style={{ padding: '0.7rem 0', borderBottom: '1px solid var(--line)' }}>
            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={Boolean(link)}
                onChange={(event) => {
                  if (event.target.checked) {
                    void api<{ id: number; contactId: number; note: string | null; sharedAt: string | null }>(`/api/books/${bookId}/recommendations`, {
                      method: 'POST',
                      json: { contactId: person.id },
                    }).then((created) => {
                      setLinks((current) => [...current, { ...created, name: person.name, nickname: person.nickname }])
                    })
                  } else if (link) {
                    void api(`/api/recommendations/${link.id}`, { method: 'DELETE' }).then(() => {
                      setLinks((current) => current.filter((item) => item.id !== link.id))
                    })
                  }
                }}
              />
              <span className="serif" style={{ fontSize: '1.4rem' }}>
                {person.name}
              </span>
            </label>
            {link && (
              <input
                className="field"
                style={{ marginTop: '0.45rem' }}
                defaultValue={link.note ?? ''}
                aria-label={`Why ${person.name} would enjoy this`}
                placeholder="Why they'd enjoy it"
                onBlur={(event) => {
                  void api(`/api/recommendations/${link.id}`, { method: 'PATCH', json: { note: event.target.value } }).then(() => toast('Note saved.'))
                }}
              />
            )}
          </div>
        )
      })}
      <form
        className="mini-progress"
        style={{ marginTop: '0.8rem' }}
        onSubmit={(event) => {
          event.preventDefault()
          void api<Contact>('/api/contacts', { method: 'POST', json: { name } }).then((person) => {
            setPeople((current) => [...current, person].sort((a, b) => a.name.localeCompare(b.name)))
            setName('')
            toast('Person saved.')
          })
        }}
      >
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Add a person" aria-label="New person" />
        <button className="btn secondary" type="submit">
          Add
        </button>
      </form>
    </div>
  )
}

export function statusText(status: ReadingStatus): string {
  switch (status) {
    case 'want':
    case 'reading':
    case 'finished':
    case 'dnf':
      return STATUS_LABEL[status]
    default:
      return assertNever(status)
  }
}
