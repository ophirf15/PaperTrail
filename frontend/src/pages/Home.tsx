import { BookPlus, NotebookPen, PenLine, Quote } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { Bookcase } from '../bookcase'
import { BookFace } from '../covers'
import { useJournalNav } from '../shell'
import { useAuth, useLibrary, useToast } from '../state'
import { formatDate, progressOf, type Book, type Stats } from '../types'
import { Dialog, EmptyState, SkeletonRow } from '../ui'

const lines = [
  'Your little corner of the literary world.',
  'Between the pages.',
  'Another chapter awaits.',
  'The shelves are listening.',
  'A quiet hour, well spent.',
]

export function HomePage() {
  const { user } = useAuth()
  const { books, upsert } = useLibrary()
  const { openAdd, openBook } = useJournalNav()
  const toast = useToast()
  const [stats, setStats] = useState<Stats | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const year = new Date().getFullYear()
  const line = lines[new Date().getDate() % lines.length]
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  useEffect(() => {
    void api<Stats>(`/api/stats?year=${year}`).then(setStats).catch(() => setStats(null))
  }, [year, books])

  if (!books) return <SkeletonRow />
  const reading = books.filter((book) => book.status === 'reading')
  const finished = books
    .filter((book) => book.status === 'finished')
    .slice()
    .sort((a, b) => (b.dateFinished ?? '').localeCompare(a.dateFinished ?? ''))
    .slice(0, 8)
  const goal = stats?.goal ?? 0
  const done = stats?.finishedThisYear ?? 0

  return (
    <div className="page">
      <p className="kicker">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1>{`${hello}${user ? `, ${user.displayName.split(' ')[0]}` : ''}.`}</h1>
      <p className="lede">{line}</p>
      <div className="actions" aria-label="Quick actions">
        <button type="button" className="btn secondary" onClick={openAdd}>
          <BookPlus size={16} aria-hidden="true" /> Add book
        </button>
        <button type="button" className="btn secondary" onClick={() => reading[0] && openBook(reading[0].id, 'quotes')} disabled={reading.length === 0}>
          <Quote size={16} aria-hidden="true" /> Add quote
        </button>
        <button type="button" className="btn secondary" onClick={() => setNoteOpen(true)} disabled={books.length === 0}>
          <NotebookPen size={16} aria-hidden="true" /> Write journal entry
        </button>
        <button type="button" className="btn secondary" onClick={() => reading[0] && openBook(reading[0].id)} disabled={reading.length === 0}>
          <PenLine size={16} aria-hidden="true" /> Update progress
        </button>
      </div>
      {books.length === 0 ? (
        <EmptyState
          title="Your shelves are waiting."
          body="This is the first page. A few books will make the room feel like yours."
          steps={['Search for a book you have loved.', 'Place it on a shelf.', 'Write the first note in the margin.']}
          action={
            <button type="button" className="btn" onClick={openAdd}>
              Add your first book
            </button>
          }
        />
      ) : (
        <>
          <section className="overview" aria-label="Reading overview">
            <Ring value={done} max={goal || Math.max(done, 1)} />
            <div className="stat-row">
              <div className="stat">
                <b>{done}</b>
                <span>Finished in {year}</span>
              </div>
              <div className="stat">
                <b>{goal || '—'}</b>
                <span>Annual goal</span>
              </div>
              <div className="stat">
                <b>{reading.length}</b>
                <span>Currently reading</span>
              </div>
              <div className="stat">
                <b>{books.filter((book) => book.status === 'want').length}</b>
                <span>Want to read</span>
              </div>
            </div>
          </section>
          <div className="section-head">
            <h2>Currently reading</h2>
          </div>
          {reading.length === 0 ? (
            <EmptyState title="Nothing open on the nightstand." body="Choose a book from the want-to-read shelf when you are ready." action={<button className="btn secondary" type="button" onClick={openAdd}>Add a book</button>} />
          ) : (
            <div className="reading-row">
              {reading.map((book) => (
                <article className="reading-card" key={book.id}>
                  <BookFace book={book} onOpen={openBook} />
                  <div className="progress" aria-label={progressOf(book) != null ? `${progressOf(book)} percent` : 'No progress yet'}>
                    <span style={{ width: `${progressOf(book) ?? 0}%` }} />
                  </div>
                  <QuickPage book={book} onSave={upsert} toast={toast} />
                </article>
              ))}
            </div>
          )}
          <div className="section-head">
            <h2>Recently finished</h2>
          </div>
          {finished.length === 0 ? (
            <p className="meta">Finished books will gather here, spine out.</p>
          ) : (
            <Bookcase books={finished} style="spines" decorations={[]} decorating={false} onOpen={openBook} onPlace={() => undefined} onRemove={() => undefined} />
          )}
        </>
      )}
      <NoteDialog open={noteOpen} books={books} onClose={() => setNoteOpen(false)} />
    </div>
  )
}

function Ring({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(1, value / max))
  const radius = 42
  const circ = 2 * Math.PI * radius
  return (
    <div className="ring-wrap" aria-label={`${value} of ${max} books`}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--line)" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--sage)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="56" textAnchor="middle" fill="var(--ink)" fontSize="22" fontFamily="Cormorant Garamond, Palatino, serif">
          {value}
        </text>
      </svg>
    </div>
  )
}

function QuickPage({ book, onSave, toast }: { book: Book; onSave: (book: Book) => void; toast: (message: string) => void }) {
  const [page, setPage] = useState(book.currentPage?.toString() ?? '')
  useEffect(() => setPage(book.currentPage?.toString() ?? ''), [book.currentPage])
  return (
    <form
      className="mini-progress"
      onSubmit={(event) => {
        event.preventDefault()
        void api<Book>(`/api/books/${book.id}/entry`, { method: 'PATCH', json: { currentPage: page === '' ? null : Number(page) } }).then((next) => {
          onSave(next)
          toast('Progress saved.')
          if (next.goalReached) window.dispatchEvent(new CustomEvent('pt-goal', { detail: next }))
        })
      }}
    >
      <input className="field" aria-label={`Page in ${book.title}`} inputMode="numeric" value={page} onChange={(event) => setPage(event.target.value)} />
      <button className="btn secondary" type="submit">
        Save
      </button>
    </form>
  )
}

function NoteDialog({ open, books, onClose }: { open: boolean; books: Book[]; onClose: () => void }) {
  const [bookId, setBookId] = useState(books.find((book) => book.status === 'reading')?.id ?? books[0]?.id ?? 0)
  const [text, setText] = useState('')
  const toast = useToast()
  return (
    <Dialog open={open} title="A journal note" onClose={onClose}>
      <form
        className="settings-grid"
        onSubmit={(event) => {
          event.preventDefault()
          void api('/api/journal', { method: 'POST', json: { bookId, bodyHtml: `<p>${text.replace(/</g, '')}</p>` } }).then(() => {
            toast('Note saved.')
            setText('')
            onClose()
          })
        }}
      >
        <label className="stack">
          <span>Book</span>
          <select className="select" value={bookId} onChange={(event) => setBookId(Number(event.target.value))}>
            {books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
        </label>
        <label className="stack">
          <span>Note</span>
          <textarea className="area" required value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button className="btn" type="submit">
          Save note
        </button>
      </form>
      <p className="meta">Saved {formatDate(new Date().toISOString().slice(0, 10))} with the book you choose.</p>
    </Dialog>
  )
}
