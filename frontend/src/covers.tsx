import { useEffect, useRef, useState } from 'react'
import { authorLine, type Book } from './types'

function hue(title: string) {
  let value = 0
  for (const char of title) value = (value + char.charCodeAt(0)) % 40
  return value
}

export function Cover({ title, authors, coverUrl }: { title: string; authors: string[]; coverUrl: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [coverUrl])
  if (!coverUrl || failed) {
    return (
      <span className="cover fallback" style={{ filter: `hue-rotate(${hue(title)}deg)` }}>
        <span>{title}</span>
        <small>{authors[0] ?? 'Unknown author'}</small>
      </span>
    )
  }
  return <img className="cover" src={coverUrl} alt="" onError={() => setFailed(true)} />
}

export function copyPhrase(book: Pick<Book, 'owned'>): string {
  return book.owned ? 'On your shelf' : 'Still to buy'
}

export function OwnedLamp({ book, compact = false }: { book: Book; compact?: boolean }) {
  const word = book.status === 'want' ? (book.owned ? (compact ? 'Have' : 'On the shelf') : compact ? 'Buy' : 'To buy') : null
  return (
    <span className={`own-lamp${book.owned ? ' is-owned' : ' is-needed'}${compact ? ' is-compact' : ''}`}>
      <span className="own-glow" aria-hidden="true" />
      {word ? <span className="own-word">{word}</span> : null}
    </span>
  )
}

export function BookFace({ book, onOpen }: { book: Book; onOpen: (id: number) => void }) {
  return (
    <button type="button" className="book-face" onClick={() => onOpen(book.id)} aria-label={`${book.title} by ${authorLine(book.authors)}. ${copyPhrase(book)}`}>
      <span className="cover-wrap">
        <Cover title={book.title} authors={book.authors} coverUrl={book.coverUrl} />
        <OwnedLamp book={book} />
      </span>
      <span className="caption">
        <strong>{book.title}</strong>
        <em>{book.authors[0] ?? 'Unknown author'}</em>
      </span>
    </button>
  )
}

export function BookGallery({ books, onOpen }: { books: Book[]; onOpen: (id: number) => void }) {
  return (
    <ul className="gallery">
      {books.map((book) => (
        <li key={book.id}>
          <BookFace book={book} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  )
}

export function BookShelves({ books, onOpen }: { books: Book[]; onOpen: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(4)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const apply = () => setSize(Math.max(2, Math.floor(node.clientWidth / 124)))
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const rows: Book[][] = []
  for (let index = 0; index < books.length; index += size) rows.push(books.slice(index, index + size))
  return (
    <div ref={ref}>
      {rows.map((row) => (
        <div className="shelf-row" key={row.map((book) => book.id).join('-')}>
          {row.map((book) => (
            <BookFace key={book.id} book={book} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  )
}
