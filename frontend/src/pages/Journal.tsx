import { useEffect, useState } from 'react'
import { api } from '../api'
import { Cover } from '../covers'
import { useJournalNav } from '../shell'
import { useLibrary } from '../state'
import { assertNever, formatDate, type TimelineEvent } from '../types'
import { EmptyState, SkeletonRow } from '../ui'

export function JournalPage() {
  const { books } = useLibrary()
  const { openBook } = useJournalNav()
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)
  const [bookId, setBookId] = useState('')
  const [year, setYear] = useState('')

  useEffect(() => {
    const params = new URLSearchParams()
    if (bookId) params.set('bookId', bookId)
    if (year) params.set('year', year)
    const query = params.toString()
    void api<TimelineEvent[]>(`/api/timeline${query ? `?${query}` : ''}`).then(setEvents)
  }, [bookId, year])

  return (
    <div className="page">
      <p className="kicker">The margin</p>
      <h1>Reading journal</h1>
      <p className="lede">Starts, finishes, ratings, quotes, and the notes you kept.</p>
      <div className="toolbar">
        <select className="select" aria-label="Filter by book" value={bookId} onChange={(event) => setBookId(event.target.value)} style={{ width: 'auto' }}>
          <option value="">Every book</option>
          {books?.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Filter by year" value={year} onChange={(event) => setYear(event.target.value)} style={{ width: 'auto' }}>
          <option value="">Every year</option>
          {[0, 1, 2, 3, 4].map((offset) => {
            const value = new Date().getFullYear() - offset
            return (
              <option key={value} value={value}>
                {value}
              </option>
            )
          })}
        </select>
      </div>
      {!events && <SkeletonRow />}
      {events && events.length === 0 && (
        <EmptyState
          title="The journal is still blank."
          body="Finish a book, save a line, or write a note and it will appear here in order."
          steps={['Open a book from the shelf.', 'Rate it or save a quote.', 'Come back to reread your own margins.']}
        />
      )}
      {events && events.length > 0 && (
        <ol className="timeline">
          {events.map((event, index) => (
            <li key={`${event.type}-${event.bookId}-${event.at}-${index}`}>
              <button type="button" className="book-face" onClick={() => openBook(event.bookId, tabFor(event.type))} aria-label={`Open ${event.title}`}>
                <Cover title={event.title} authors={event.authors} coverUrl={event.coverUrl} />
              </button>
              <div>
                <p className="kicker">{labelFor(event.type)} · {formatDate(event.at)}</p>
                <h3>{event.title}</h3>
                <p>{event.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function tabFor(type: TimelineEvent['type']) {
  switch (type) {
    case 'quote':
      return 'quotes'
    case 'journal':
    case 'note':
      return 'journal'
    case 'started':
    case 'finished':
    case 'rated':
      return 'overview'
    default:
      return assertNever(type)
  }
}

function labelFor(type: TimelineEvent['type']) {
  switch (type) {
    case 'started':
      return 'Started'
    case 'finished':
      return 'Finished'
    case 'rated':
      return 'Rated'
    case 'quote':
      return 'Quote'
    case 'journal':
      return 'Journal'
    case 'note':
      return 'Note'
    default:
      return assertNever(type)
  }
}
