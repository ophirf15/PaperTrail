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

export function BookFace({ book, onOpen }: { book: Book; onOpen: (id: number) => void }) {
  return (
    <button type="button" className="book-face" onClick={() => onOpen(book.id)} aria-label={`${book.title} by ${authorLine(book.authors)}`}>
      <Cover title={book.title} authors={book.authors} coverUrl={book.coverUrl} />
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
