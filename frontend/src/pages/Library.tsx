import { Leaf, Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api } from '../api'
import { Bookcase, ORNAMENTS, Ornament, type Decoration, type OrnamentKind } from '../bookcase'
import { BookGallery } from '../covers'
import { useJournalNav } from '../shell'
import { useAuth, useLibrary, useToast } from '../state'
import { STATUS_LABEL, type Book, type ReadingStatus, type Settings, type ShelfArrange } from '../types'
import { EmptyState, SkeletonRow } from '../ui'

type Filter = 'all' | ReadingStatus

const ARRANGEMENTS: { key: ShelfArrange; label: string }[] = [
  { key: 'author', label: 'Author' },
  { key: 'read', label: 'Date read' },
  { key: 'genre', label: 'Genre' },
  { key: 'free', label: 'My order' },
]

export function LibraryPage() {
  const { books, refresh } = useLibrary()
  const { settings, saveSettings } = useAuth()
  const { openBook, openAdd } = useJournalNav()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('all')
  const [arrangement, setArrangement] = useState<ShelfArrange>(settings.shelfArrange)
  const [orderOverride, setOrderOverride] = useState<number[] | null>(null)
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('all')
  const [decorations, setDecorations] = useState<Decoration[]>([])
  const [decorating, setDecorating] = useState(false)
  const [ornament, setOrnament] = useState<OrnamentKind>('plant')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const view = settings.shelfView
  const shelfStyle = settings.shelfStyle

  useEffect(() => {
    void api<Decoration[]>('/api/decorations').then(setDecorations).catch(() => setDecorations([]))
  }, [books])

  useEffect(() => {
    setArrangement(settings.shelfArrange)
  }, [settings.shelfArrange])

  useEffect(() => {
    if (!orderOverride) return
    if (settings.shelfOrder === orderOverride.join(',')) setOrderOverride(null)
  }, [settings.shelfOrder, orderOverride])

  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    menuRef.current?.querySelector<HTMLElement>('.shelf-panel')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const orderIds = useMemo(() => orderOverride ?? parseOrder(settings.shelfOrder), [orderOverride, settings.shelfOrder])

  const genres = useMemo(() => {
    const names = new Set<string>()
    books?.forEach((book) => book.genres.forEach((item) => names.add(item)))
    return [...names].sort((a, b) => a.localeCompare(b)).slice(0, 24)
  }, [books])

  const visible = useMemo(() => {
    if (!books) return []
    const needle = query.trim().toLowerCase()
    const next = books.filter((book) => {
      if (filter !== 'all' && book.status !== filter) return false
      if (genre !== 'all' && !book.genres.some((item) => item.toLowerCase() === genre.toLowerCase())) return false
      if (!needle) return true
      return (
        book.title.toLowerCase().includes(needle) ||
        book.authors.some((author) => author.toLowerCase().includes(needle)) ||
        (book.isbn13 ?? '').includes(needle)
      )
    })
    return arrangeBooks(next, arrangement, orderIds)
  }, [books, filter, genre, query, arrangement, orderIds])

  if (!books) return <SkeletonRow />
  const samples = books.some((book) => book.isSample)
  const finishedSome = books.some((book) => book.status === 'finished')

  return (
    <div className="page">
      <p className="kicker">The collection</p>
      <h1>My library</h1>
      <p className="lede">Spines on the case, covers when a book is open. The record waits behind either one.</p>
      {samples && (
        <div className="banner">
          <span>Sample books, notes, and readers are here so every shelf can be tried. They stay marked, and they leave when you ask. Objects you place on the shelves stay.</span>
          <button
            type="button"
            className="quiet"
            onClick={() =>
              void api('/api/sample-shelf', { method: 'DELETE' })
                .then(() => refresh())
                .then(() => toast('Sample books removed.'))
            }
          >
            Remove samples
          </button>
        </div>
      )}
      <div className="toolbar">
        <div className="seg" role="toolbar" aria-label="Reading status">
          {(['all', 'reading', 'want', 'finished', 'dnf'] as const).map((key) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {key === 'all' ? 'All' : STATUS_LABEL[key]}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your shelves" aria-label="Search your shelves" />
        </label>
        {genres.length > 0 && (
          <select className="select" aria-label="Filter by genre" value={genre} onChange={(event) => setGenre(event.target.value)} style={{ width: 'auto' }}>
            <option value="all">All genres</option>
            {genres.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        )}
        {books.length > 0 && (
          <div className="shelf-options" ref={menuRef}>
            <button
              type="button"
              className="btn secondary"
              aria-expanded={menuOpen}
              aria-controls="shelf-options"
              onClick={() => setMenuOpen((current) => !current)}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              {shelfSummary(arrangement, shelfStyle, view)}
            </button>
            {decorating && (
              <button type="button" className="btn secondary" aria-pressed={decorating} onClick={() => setDecorating(false)}>
                <Leaf size={16} aria-hidden="true" /> Done decorating
              </button>
            )}
            {menuOpen && (
              <div className="shelf-panel" id="shelf-options" role="dialog" aria-label="Shelf options" tabIndex={-1}>
                <fieldset>
                  <legend>Arrange</legend>
                  <div className="seg" role="radiogroup" aria-label="Arrange the books">
                    {ARRANGEMENTS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        role="radio"
                        aria-checked={arrangement === item.key}
                        onClick={() => {
                          setArrangement(item.key)
                          void saveSettings({ shelfArrange: item.key })
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>On the shelf</legend>
                  <div className="seg" role="radiogroup" aria-label="How the books stand">
                    {(['spines', 'mixed', 'covers'] as const).map((key) => (
                      <button key={key} type="button" role="radio" aria-checked={shelfStyle === key} onClick={() => void saveSettings({ shelfStyle: key })}>
                        {styleName(key)}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>View</legend>
                  <div className="seg" role="radiogroup" aria-label="Library view">
                    <button type="button" role="radio" aria-checked={view === 'shelf'} onClick={() => void saveSettings({ shelfView: 'shelf' })}>
                      Bookshelves
                    </button>
                    <button type="button" role="radio" aria-checked={view === 'gallery'} onClick={() => void saveSettings({ shelfView: 'gallery' })}>
                      Gallery
                    </button>
                  </div>
                </fieldset>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    if (view !== 'shelf') void saveSettings({ shelfView: 'shelf' })
                    setDecorating(true)
                    setMenuOpen(false)
                  }}
                >
                  <Leaf size={16} aria-hidden="true" /> Decorate
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {arrangement === 'free' && view === 'shelf' && visible.length > 0 && (
        <p className="meta shelf-help">Drag the handle on a book to move it. Alt and the left or right arrow does the same from that handle. Author, date read, and genre line the shelves up again, and this order stays put.</p>
      )}
      {decorating && view === 'shelf' && (
        <div className="ornament-tray">
          <div className="ornament-choices" role="listbox" aria-label="Objects to place">
            {ORNAMENTS.map((item) => (
              <button key={item.kind} type="button" role="option" className="ornament-choice" aria-pressed={ornament === item.kind} aria-selected={ornament === item.kind} onClick={() => setOrnament(item.kind)}>
                <span className="swatch" aria-hidden="true">
                  <Ornament kind={item.kind} />
                </span>
                {item.label}
              </button>
            ))}
          </div>
          <p className="meta">Choose an object, then tap a + in the gap where it should sit. A shelf holds four. Click an object to take it down. Outside of decorating, the objects stay put.</p>
        </div>
      )}
      {books.length === 0 && (
        <EmptyState
          title="A library begins with one book."
          body="Search by title, author, or ISBN and the cover will find its place."
          steps={['Add a book you are reading now.', 'Move it when you finish.', 'Come back to write what it left behind.']}
          action={
            <button type="button" className="btn" onClick={openAdd}>
              Add a book
            </button>
          }
        />
      )}
      {books.length > 0 && visible.length === 0 && filter === 'want' && finishedSome && (
        <EmptyState achievement title="The to-read shelf is clear." body="A rare and lovely quiet. Whatever you pick up next can wait until you want it." />
      )}
      {books.length > 0 && visible.length === 0 && !(filter === 'want' && finishedSome) && (
        <EmptyState title="Nothing on this shelf matches." body="Try another status, or clear the search to see the whole collection again." action={<button className="btn secondary" type="button" onClick={() => { setQuery(''); setFilter('all'); setGenre('all') }}>Show everything</button>} />
      )}
      {visible.length > 0 &&
        (view === 'shelf' ? (
          <Bookcase
            books={visible}
            style={shelfStyle}
            decorations={decorations}
            decorating={decorating}
            arrangement={arrangement}
            onOpen={openBook}
            onPlace={(shelfIndex, slot) => void placeOrnament(shelfIndex, slot, ornament, toast, setDecorations)}
            onRemove={(id) => void removeOrnament(id, toast, setDecorations)}
            onReorder={(movedId, beforeId) => {
              if (!books) return
              const next = moveBook(orderIds, books.map((book) => book.id), movedId, beforeId)
              setOrderOverride(next)
              setArrangement('free')
              void saveSettings({ shelfArrange: 'free', shelfOrder: next.join(',') })
            }}
          />
        ) : (
          <BookGallery books={visible} onOpen={openBook} />
        ))}
    </div>
  )
}

async function placeOrnament(shelfIndex: number, slot: number, kind: OrnamentKind, toast: (message: string) => void, setDecorations: (value: Decoration[] | ((current: Decoration[]) => Decoration[])) => void) {
  try {
    const created = await api<Decoration>('/api/decorations', { method: 'POST', json: { shelfIndex, slot, kind } })
    setDecorations((current) => [...current, created])
  } catch (error) {
    toast(error instanceof ApiError ? error.message : 'That object would not sit on the shelf.')
  }
}

async function removeOrnament(id: number, toast: (message: string) => void, setDecorations: (value: Decoration[] | ((current: Decoration[]) => Decoration[])) => void) {
  try {
    await api(`/api/decorations/${id}`, { method: 'DELETE' })
    setDecorations((current) => current.filter((item) => item.id !== id))
  } catch (error) {
    toast(error instanceof ApiError ? error.message : 'That object stayed put.')
  }
}

function shelfSummary(arrangement: ShelfArrange, style: Settings['shelfStyle'], view: Settings['shelfView']) {
  const arranged = ARRANGEMENTS.find((item) => item.key === arrangement)?.label ?? 'My order'
  if (view === 'gallery') return `${arranged} · Gallery`
  return `${arranged} · ${styleName(style)}`
}

function styleName(style: Settings['shelfStyle']) {
  switch (style) {
    case 'spines':
      return 'Spines'
    case 'mixed':
      return 'Mixed'
    case 'covers':
      return 'Covers'
    default: {
      const _exhaustive: never = style
      return _exhaustive
    }
  }
}

function arrangeBooks(books: Book[], arrangement: ShelfArrange, order: number[]) {
  const index = new Map(order.map((id, place) => [id, place]))
  return books.slice().sort((a, b) => compareBooks(a, b, arrangement, index))
}

function compareBooks(a: Book, b: Book, arrangement: ShelfArrange, index: Map<number, number>) {
  switch (arrangement) {
    case 'author':
      return lastName(a).localeCompare(lastName(b), undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    case 'read': {
      const aDate = a.dateFinished ?? ''
      const bDate = b.dateFinished ?? ''
      if (aDate !== bDate) {
        if (!aDate) return 1
        if (!bDate) return -1
        return aDate.localeCompare(bDate)
      }
      return (a.dateStarted ?? '').localeCompare(b.dateStarted ?? '') || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    }
    case 'genre':
      return (a.genres[0] ?? 'Other').localeCompare(b.genres[0] ?? 'Other', undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    case 'free': {
      const ai = index.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const bi = index.get(b.id) ?? Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi
      return (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '') || a.id - b.id
    }
    default: {
      const _exhaustive: never = arrangement
      return _exhaustive
    }
  }
}

function lastName(book: Book) {
  const author = book.authors[0]?.trim() ?? ''
  const parts = author.split(/\s+/).filter(Boolean)
  const tail = parts[parts.length - 1] || author
  const particle = parts[parts.length - 2]
  if (particle && /^(le|la|de|du|van|von|der|den)$/i.test(particle)) return `${particle} ${tail}`
  return tail
}

function parseOrder(value: string) {
  if (!value) return []
  return value
    .split(',')
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id) && id > 0)
}

function moveBook(order: number[], allIds: number[], movedId: number, beforeId: number | null) {
  const known = order.filter((id) => allIds.includes(id))
  const seen = new Set(known)
  for (const id of allIds) {
    if (!seen.has(id)) known.push(id)
  }
  const from = known.indexOf(movedId)
  if (from >= 0) known.splice(from, 1)
  if (beforeId == null) {
    known.push(movedId)
    return known
  }
  const to = known.indexOf(beforeId)
  if (to < 0) known.push(movedId)
  else known.splice(to, 0, movedId)
  return known
}
