import { GripVertical } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Cover } from './covers'
import { authorLine, type Book, type ShelfArrange } from './types'

export const ORNAMENTS = [
  { kind: 'plant', label: 'Plant' },
  { kind: 'fern', label: 'Fern' },
  { kind: 'flowers', label: 'Flowers' },
  { kind: 'mug', label: 'Mug' },
  { kind: 'candle', label: 'Candle' },
  { kind: 'glasses', label: 'Glasses' },
  { kind: 'camera', label: 'Camera' },
  { kind: 'stack', label: 'Book stack' },
  { kind: 'wooble', label: 'Wooble' },
] as const

export type OrnamentKind = (typeof ORNAMENTS)[number]['kind']
export type ShelfStyle = 'spines' | 'mixed' | 'covers'

export type Decoration = {
  id: number
  shelfIndex: number
  slot: number
  variant: number
  kind: OrnamentKind
}

const CLOTH = ['#5c2e2a', '#2c4638', '#243044', '#6a4324', '#3e3150', '#7a3544', '#1d3c38', '#3c342c', '#5a3040', '#2d455c', '#4e3a2c', '#643434']

function cloth(title: string) {
  let value = 0
  for (const char of title) value = (value + char.charCodeAt(0) * 17) % CLOTH.length
  return CLOTH[value]
}

function spineWidth(book: Book) {
  const pages = book.pageCount ?? 280
  return Math.max(26, Math.min(48, Math.round(14 + pages / 18)))
}

function spineHeight(title: string) {
  let value = 0
  for (const char of title) value += char.charCodeAt(0)
  const needed = 40 + title.length * 8
  return Math.max(164, Math.min(236, needed)) + (value % 10)
}

function faceOut(book: Book, style: ShelfStyle) {
  if (style === 'covers') return true
  if (style === 'spines') return false
  return book.status === 'reading' || book.id % 7 === 0
}

const COVER_WIDTH = 78
const ITEM_GAP = 6
const PLACE_WIDTH = 26
const PACK_SLACK = 16

function bookWidth(book: Book, style: ShelfStyle) {
  return faceOut(book, style) ? COVER_WIDTH : spineWidth(book)
}

function genreName(book: Book) {
  return book.genres[0] ?? 'Other'
}

export function ornamentWidth(kind: OrnamentKind) {
  switch (kind) {
    case 'plant':
    case 'fern':
      return 58
    case 'flowers':
      return 46
    case 'stack':
      return 72
    case 'camera':
      return 42
    case 'mug':
      return 34
    case 'candle':
      return 26
    case 'glasses':
      return 48
    case 'wooble':
      return 52
    default: {
      const _never: never = kind
      return _never
    }
  }
}

export function Bookcase({
  books,
  style,
  decorations,
  decorating,
  arrangement = 'free',
  onOpen,
  onPlace,
  onRemove,
  onReorder,
}: {
  books: Book[]
  style: ShelfStyle
  decorations: Decoration[]
  decorating: boolean
  arrangement?: ShelfArrange
  onOpen: (id: number) => void
  onPlace: (shelfIndex: number, slot: number) => void
  onRemove: (id: number) => void
  onReorder?: (movedId: number, beforeId: number | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<number | null>(null)
  const dropRef = useRef<{ beforeId: number | null } | null>(null)
  const [width, setWidth] = useState(0)
  const [dragId, setDragId] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ beforeId: number | null } | null>(null)
  const free = arrangement === 'free' && Boolean(onReorder)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const apply = () => setWidth(usableWidth(node))
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const rows = packShelves(books, style, Math.max(180, width || 320), decorations, decorating, arrangement)
  const occupied = decorations.reduce((max, item) => Math.max(max, item.shelfIndex + 1), 0)
  let shelfCount = Math.max(rows.length, occupied, 1)
  if (decorating && shelfCount < 12) shelfCount += 1

  function startDrag(event: PointerEvent<HTMLButtonElement>, id: number) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = id
    dropRef.current = null
    setDragId(id)
    setDrop(null)
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const id = dragRef.current
    const node = ref.current
    if (id == null || !node) return
    const next = findDrop(node, books, id, event.clientX, event.clientY)
    dropRef.current = next
    setDrop((current) => (sameDrop(current, next) ? current : next))
  }

  function endDrag() {
    const id = dragRef.current
    const target = dropRef.current
    dragRef.current = null
    dropRef.current = null
    setDragId(null)
    setDrop(null)
    if (id == null || !target || !onReorder || target.beforeId === id) return
    onReorder(id, target.beforeId)
  }

  function moveWithKeys(event: KeyboardEvent<HTMLButtonElement>, id: number) {
    if (!event.altKey || !onReorder) return
    const index = books.findIndex((book) => book.id === id)
    if (index < 0) return
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      onReorder(id, books[index - 1].id)
    }
    if (event.key === 'ArrowRight' && index < books.length - 1) {
      event.preventDefault()
      const after = books[index + 2]
      onReorder(id, after ? after.id : null)
    }
  }

  return (
    <div className="bookcase" ref={ref}>
      <div className="bookcase-crown" aria-hidden="true" />
      {Array.from({ length: shelfCount }, (_, shelfIndex) => {
        const row = rows[shelfIndex] ?? []
        const ornaments = decorations.filter((item) => item.shelfIndex === shelfIndex)
        const caption = shelfCaption(row, arrangement)
        return (
          <section className="case-shelf" key={shelfIndex} aria-label={caption ? `Shelf ${shelfIndex + 1}, ${caption}` : `Shelf ${shelfIndex + 1}`}>
            {caption && <p className="shelf-note">{caption}</p>}
            <div className="case-books">
              {arrangeShelf(row, ornaments, decorating).map((piece) => {
                if (piece.type === 'place') {
                  const atEnd = piece.slot === row.length
                  const empty = row.length === 0
                  return (
                    <button
                      key={`place-${shelfIndex}-${piece.slot}`}
                      type="button"
                      className={empty ? 'place-spot' : 'place-spot gap'}
                      aria-label={atEnd ? `Place at the right of shelf ${shelfIndex + 1}` : `Place before book ${piece.slot + 1} on shelf ${shelfIndex + 1}`}
                      onClick={() => onPlace(shelfIndex, piece.slot)}
                    >
                      {empty ? 'Place here' : '+'}
                    </button>
                  )
                }
                if (piece.type === 'ornament') {
                  const item = piece.item
                  if (!decorating) {
                    return (
                      <span key={`ornament-${item.id}`} className="ornament" style={{ width: ornamentWidth(item.kind) }} aria-hidden="true">
                        <Ornament kind={item.kind} variant={item.variant} />
                      </span>
                    )
                  }
                  return (
                    <button
                      key={`ornament-${item.id}`}
                      type="button"
                      className="ornament"
                      style={{ width: ornamentWidth(item.kind) }}
                      aria-label={`Remove ${item.kind} from shelf ${shelfIndex + 1}`}
                      onClick={() => onRemove(item.id)}
                    >
                      <Ornament kind={item.kind} variant={item.variant} />
                    </button>
                  )
                }
                const book = piece.book
                const label = `${book.title} by ${authorLine(book.authors)}`
                const dropClass = drop && dragId !== book.id ? (drop.beforeId === book.id ? ' is-drop' : drop.beforeId === null && book.id === books[books.length - 1]?.id ? ' is-drop-end' : '') : ''
                return (
                  <div key={`book-${book.id}`} className={`shelf-book${dragId === book.id ? ' is-dragging' : ''}${dropClass}`} data-book-id={book.id}>
                    {free && (
                      <button
                        type="button"
                        className="shelf-grip"
                        aria-label={`Move ${book.title}`}
                        onPointerDown={(event) => startDrag(event, book.id)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={(event) => moveWithKeys(event, book.id)}
                      >
                        <GripVertical size={14} aria-hidden="true" />
                      </button>
                    )}
                    {faceOut(book, style) ? (
                      <button type="button" className="shelf-cover" onClick={() => onOpen(book.id)} aria-label={label}>
                        <Cover title={book.title} authors={book.authors} coverUrl={book.coverUrl} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="spine"
                        style={{ width: spineWidth(book), height: spineHeight(book.title), backgroundColor: cloth(book.title) }}
                        onClick={() => onOpen(book.id)}
                        aria-label={label}
                      >
                        <span>{book.title}</span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="case-plank" aria-hidden="true" />
          </section>
        )
      })}
      <div className="bookcase-base" aria-hidden="true" />
    </div>
  )
}

type ShelfPiece =
  | { type: 'place'; slot: number }
  | { type: 'ornament'; item: Decoration }
  | { type: 'book'; book: Book }

function arrangeShelf(books: Book[], ornaments: Decoration[], decorating: boolean): ShelfPiece[] {
  const groups = new Map<number, Decoration[]>()
  for (const item of ornaments) {
    const slot = Math.max(0, Math.min(books.length, item.slot))
    const group = groups.get(slot) ?? []
    group.push(item)
    groups.set(slot, group)
  }
  const pieces: ShelfPiece[] = []
  for (let slot = 0; slot <= books.length; slot += 1) {
    if (decorating) pieces.push({ type: 'place', slot })
    for (const item of groups.get(slot) ?? []) pieces.push({ type: 'ornament', item })
    if (slot < books.length) pieces.push({ type: 'book', book: books[slot] })
  }
  return pieces
}

function packShelves(books: Book[], style: ShelfStyle, innerWidth: number, decorations: Decoration[], decorating: boolean, arrangement: ShelfArrange) {
  const rows: Book[][] = []
  let shelf = 0
  let current: Book[] = []
  const limit = Math.max(180, innerWidth)
  for (const book of books) {
    const ornaments = decorations.filter((item) => item.shelfIndex === shelf)
    const ornamentPx = ornaments.reduce((sum, item) => sum + ornamentWidth(item.kind), 0)
    const nextWidth = lineWidth([...current, book], style, ornaments.length, ornamentPx, decorating)
    const used = lineWidth(current, style, ornaments.length, ornamentPx, decorating)
    const previous = current[current.length - 1]
    const groupChanged = arrangement === 'genre' && previous && genreName(book) !== genreName(previous)
    const finishedChanged = arrangement === 'read' && previous && Boolean(book.dateFinished) !== Boolean(previous.dateFinished)
    if (current.length > 0 && (nextWidth > limit || finishedChanged || (groupChanged && limit - used < limit * 0.4))) {
      rows.push(current)
      shelf += 1
      current = []
    }
    current.push(book)
  }
  if (current.length || rows.length === 0) rows.push(current)
  return rows
}

function lineWidth(row: Book[], style: ShelfStyle, ornamentCount: number, ornamentPx: number, decorating: boolean) {
  const places = decorating ? row.length + 1 : 0
  const count = row.length + ornamentCount + places
  if (count === 0) return 0
  let width = ornamentPx + places * PLACE_WIDTH
  for (const book of row) width += bookWidth(book, style)
  return width + (count - 1) * ITEM_GAP
}

function usableWidth(node: HTMLElement) {
  const box = getComputedStyle(node)
  const gutter = (Number.parseFloat(box.paddingLeft) || 0) + (Number.parseFloat(box.paddingRight) || 0)
  const shelf = node.querySelector('.case-shelf')
  let inset = 12
  if (shelf) {
    const shelfBox = getComputedStyle(shelf)
    inset = (Number.parseFloat(shelfBox.paddingLeft) || 0) + (Number.parseFloat(shelfBox.paddingRight) || 0)
  }
  return Math.max(180, Math.floor(node.clientWidth - gutter - inset - PACK_SLACK))
}

function findDrop(root: HTMLElement, books: Book[], dragged: number, x: number, y: number): { beforeId: number | null } | null {
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-book-id]')]
  let best: { id: number; dist: number; before: boolean } | null = null
  for (const node of nodes) {
    const id = Number(node.dataset.bookId)
    if (!id || id === dragged) continue
    const rect = node.getBoundingClientRect()
    const center = rect.left + rect.width / 2
    const dist = Math.hypot(x - center, y - (rect.top + rect.height / 2))
    if (!best || dist < best.dist) best = { id, dist, before: x < center }
  }
  if (!best || best.dist > 240) return null
  const chosen = best
  if (chosen.before) return { beforeId: chosen.id }
  const index = books.findIndex((book) => book.id === chosen.id)
  const next = books[index + 1]
  return { beforeId: next ? next.id : null }
}

function sameDrop(current: { beforeId: number | null } | null, next: { beforeId: number | null } | null) {
  if (current === next) return true
  if (!current || !next) return false
  return current.beforeId === next.beforeId
}

function shelfCaption(row: Book[], arrangement: ShelfArrange): string | null {
  if (row.length === 0 || arrangement === 'free') return null
  switch (arrangement) {
    case 'author': {
      const first = lastName(row[0])
      const last = lastName(row[row.length - 1])
      return first === last ? first : `${first} – ${last}`
    }
    case 'read': {
      const dates = row.map((book) => book.dateFinished).filter((date): date is string => Boolean(date))
      if (dates.length === 0) return 'Not finished yet'
      const start = monthLabel(dates[0])
      const end = monthLabel(dates[dates.length - 1])
      return start === end ? start : `${start} – ${end}`
    }
    case 'genre': {
      const names: string[] = []
      for (const book of row) {
        const name = genreName(book)
        if (!names.includes(name)) names.push(name)
      }
      if (names.length <= 2) return names.join(' · ')
      return `${names[0]} · ${names[1]} +${names.length - 2}`
    }
    default: {
      const _never: never = arrangement
      return _never
    }
  }
}

function lastName(book: Book) {
  const author = book.authors[0]?.trim() ?? 'Unknown'
  const parts = author.split(/\s+/).filter(Boolean)
  const tail = parts[parts.length - 1] || author
  const particle = parts[parts.length - 2]
  if (particle && /^(le|la|de|du|van|von|der|den)$/i.test(particle)) return `${particle} ${tail}`
  return tail
}

function monthLabel(iso: string) {
  const [year, month] = iso.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(month) - 1] ?? month} ${year}`
}

type Look = Record<string, string>

const LOOKS: Record<OrnamentKind, Look[]> = {
  plant: [
    { a: '#3f6a48', b: '#4f7d52', c: '#2f5a3c', d: '#6e9464', pot: '#8d6844', rim: '#6d4c32' },
    { a: '#2f6b62', b: '#5ea48c', c: '#1d4e46', d: '#8ec7a4', pot: '#efe6da', rim: '#c4b29a' },
    { a: '#6a4a86', b: '#8d6aaa', c: '#4a3164', d: '#c4a4d4', pot: '#3d5c74', rim: '#243e52' },
  ],
  fern: [
    { a: '#3f6a48', b: '#5d8a58', stem: '#2f5a3c', pot: '#6d4c32' },
    { a: '#2f6a58', b: '#7aaa78', stem: '#1e4a3c', pot: '#d7c4a4' },
    { a: '#3d5a32', b: '#8aa85a', stem: '#2c4020', pot: '#4d6d8a' },
  ],
  flowers: [
    { a: '#c48984', b: '#d4a3a0', c: '#b56d68', d: '#e4c2b8', e: '#c97b86', pot: '#8fb0b8', stem: '#3f6a48' },
    { a: '#e0b15a', b: '#f0d48a', c: '#c48a3a', d: '#f6e2a8', e: '#d9a24a', pot: '#efe6da', stem: '#4f7d52' },
    { a: '#7d6bb5', b: '#b3a4d8', c: '#5c4a90', d: '#ddd4f0', e: '#8e74c4', pot: '#6d4c32', stem: '#2f5a3c' },
  ],
  mug: [
    { body: '#efe6da', line: '#c4b29a', drink: '#6f8468' },
    { body: '#d7e3d4', line: '#6f8468', drink: '#3f6a48' },
    { body: '#f3d5d0', line: '#c48984', drink: '#8d6844' },
  ],
  candle: [
    { wax: '#f4efe4', flame: '#e0b15a', base: '#8d6844' },
    { wax: '#d7e3d4', flame: '#f0d48a', base: '#6d4c32' },
    { wax: '#f3c1c8', flame: '#e07a3d', base: '#5c3d28' },
  ],
  glasses: [
    { frame: '#3a332c' },
    { frame: '#c4a15a' },
    { frame: '#6d3b32' },
  ],
  camera: [
    { body: '#2f2924', lens: '#1a1714', ring: '#c4b07a', top: '#3a332c' },
    { body: '#d9d3c8', lens: '#2c2924', ring: '#8d6844', top: '#efe6da' },
    { body: '#3f6249', lens: '#1c2a22', ring: '#e0b15a', top: '#2f4638' },
  ],
  stack: [
    { a: '#5c2e2a', b: '#2c4638', c: '#6a4324' },
    { a: '#243044', b: '#7a3544', c: '#c4a15a' },
    { a: '#3e3150', b: '#1d3c38', c: '#efe6da' },
  ],
  wooble: [
    { body: '#f6d5cb', ear: '#f3c1c8', stitch: '#e7b7ae', cheek: '#e7a3a8', accent: '#c96b86', accent2: '#d9849a' },
    { body: '#d7e4cf', ear: '#b7d0ae', stitch: '#8eae86', cheek: '#e7b3b0', accent: '#3f6a48', accent2: '#6e9464' },
    { body: '#f3e2b8', ear: '#e8c98a', stitch: '#d2b56a', cheek: '#e7a3a8', accent: '#3d5c74', accent2: '#7f9bb5' },
  ],
}

function look(kind: OrnamentKind, variant: number): Look {
  const styles = LOOKS[kind]
  const index = ((variant % styles.length) + styles.length) % styles.length
  return styles[index]
}

export function Ornament({ kind, variant = 0 }: { kind: OrnamentKind; variant?: number }) {
  const tone = look(kind, variant)
  const style = ((variant % 3) + 3) % 3
  switch (kind) {
    case 'plant':
      return (
        <svg viewBox="0 0 64 92" aria-hidden="true">
          <path d="M32 48c-10-8-22-6-24 4 8 2 16 1 24-4z" fill={tone.a} />
          <path d="M32 46c8-14 22-12 24-2-8 3-16 2-24 2z" fill={tone.b} />
          <path d="M32 50c-2-16 8-28 10-32-8 6-12 18-10 32z" fill={tone.c} />
          <path d="M30 52c6-10 16-8 18 0-8 1-14 0-18 0z" fill={tone.d} />
          {style === 1 && <circle cx="40" cy="34" r="5" fill={tone.d} />}
          {style === 2 && <path d="M20 40c6-12 4-18 2-22 4 6 8 12 6 22z" fill={tone.b} />}
          <rect x="24" y="58" width="16" height="22" rx="3" fill={tone.pot} />
          <rect x="22" y="76" width="20" height="6" rx="2" fill={tone.rim} />
        </svg>
      )
    case 'fern':
      return (
        <svg viewBox="0 0 64 92" aria-hidden="true">
          <path d="M32 80c0-20 2-34 2-46" stroke={tone.stem} strokeWidth="2" fill="none" />
          <path d="M32 70c-10-2-16-8-18-14 8 1 14 4 18 8zM32 60c-12-4-18-12-16-18 8 2 14 6 16 10zM32 50c-8-6-10-14-6-18 6 2 10 6 12 10z" fill={tone.a} />
          <path d="M34 68c10-2 16-8 18-14-8 1-14 4-18 8zM34 56c12-4 16-12 12-18-8 3-12 8-14 12z" fill={tone.b} />
          {style === 2 && <path d="M34 44c8-2 12-8 10-12-6 2-10 6-10 12z" fill={tone.a} />}
          <ellipse cx="32" cy="82" rx="10" ry="4" fill={tone.pot} />
        </svg>
      )
    case 'flowers':
      return (
        <svg viewBox="0 0 56 92" aria-hidden="true">
          <path d="M28 84V46" stroke={tone.stem} strokeWidth="2" />
          <circle cx="28" cy="34" r="7" fill={tone.a} />
          <circle cx="18" cy="40" r="6" fill={tone.b} />
          <circle cx="38" cy="42" r="6" fill={tone.c} />
          <circle cx="24" cy="28" r="5" fill={tone.d} />
          <circle cx="34" cy="26" r="5" fill={tone.e} />
          {style === 1 && <circle cx="28" cy="34" r="2" fill={tone.c} />}
          {style === 2 && <circle cx="14" cy="32" r="4" fill={tone.d} />}
          <rect x="22" y="78" width="12" height="12" rx="2" fill={tone.pot} />
        </svg>
      )
    case 'mug':
      return (
        <svg viewBox="0 0 48 64" aria-hidden="true">
          <path d="M8 18h24v28a10 10 0 0 1-10 10H18a10 10 0 0 1-10-10V18z" fill={tone.body} stroke={tone.line} />
          <path d="M32 24h6a8 8 0 0 1 0 16h-6" fill="none" stroke={tone.line} strokeWidth="3" />
          <path d={style === 2 ? 'M12 18c1-6 8-8 12-4 3-5 10-2 11 4' : 'M12 18c2-8 16-8 18 0'} fill={tone.drink} />
          {style === 1 && <rect x="14" y="30" width="12" height="3" rx="1" fill={tone.line} />}
        </svg>
      )
    case 'candle':
      return (
        <svg viewBox="0 0 36 80" aria-hidden="true">
          <rect x={style === 2 ? 10 : 12} y="28" width={style === 2 ? 16 : 12} height="40" rx="2" fill={tone.wax} />
          <path d="M18 28c2-8 6-8 4-14-4 4-6 8-4 14z" fill={tone.flame} />
          <rect x="8" y="66" width="20" height="6" rx="2" fill={tone.base} />
        </svg>
      )
    case 'glasses':
      return (
        <svg viewBox="0 0 64 40" aria-hidden="true">
          {style === 1 ? (
            <>
              <rect x="4" y="12" width="22" height="16" rx="4" fill="none" stroke={tone.frame} strokeWidth="2" />
              <rect x="34" y="12" width="22" height="16" rx="4" fill="none" stroke={tone.frame} strokeWidth="2" />
              <path d="M26 20h8" fill="none" stroke={tone.frame} strokeWidth="2" />
            </>
          ) : (
            <>
              <circle cx="16" cy="22" r="10" fill="none" stroke={tone.frame} strokeWidth="2" />
              <circle cx="44" cy="22" r="10" fill="none" stroke={tone.frame} strokeWidth="2" />
              <path d="M26 22h8M6 20c2-8 0-12-4-12M58 20c-2-8 0-12 4-12" fill="none" stroke={tone.frame} strokeWidth="2" />
            </>
          )}
        </svg>
      )
    case 'camera':
      return (
        <svg viewBox="0 0 56 44" aria-hidden="true">
          <rect x="4" y="12" width="48" height="28" rx="4" fill={tone.body} />
          <circle cx="28" cy="26" r="8" fill={tone.lens} stroke={tone.ring} strokeWidth="2" />
          <rect x="18" y="6" width={style === 2 ? 18 : 12} height="8" rx="2" fill={tone.top} />
        </svg>
      )
    case 'stack':
      return (
        <svg viewBox="0 0 78 36" aria-hidden="true">
          <rect x="6" y="4" width="62" height="8" rx="1" fill={tone.a} transform="rotate(-3 32 8)" />
          <rect x="4" y="14" width="66" height="8" rx="1" fill={tone.b} />
          <rect x="8" y="24" width="60" height="8" rx="1" fill={tone.c} transform={style === 1 ? 'rotate(-2 36 28)' : 'rotate(2 36 28)'} />
        </svg>
      )
    case 'wooble':
      return (
        <svg viewBox="0 0 64 78" aria-hidden="true">
          <ellipse cx="32" cy="74" rx="14" ry="3" fill="#000" opacity="0.18" />
          {style === 1 ? (
            <>
              <ellipse cx="20" cy="18" rx="7" ry="10" fill={tone.ear} />
              <ellipse cx="44" cy="18" rx="7" ry="10" fill={tone.ear} />
            </>
          ) : (
            <>
              <circle cx="22" cy="22" r="8" fill={tone.ear} />
              <circle cx="42" cy="22" r="8" fill={tone.ear} />
            </>
          )}
          <circle cx="32" cy="40" r="22" fill={tone.body} />
          <path d="M16 36c4 6 8 8 16 8s12-2 16-8" fill="none" stroke={tone.stitch} strokeWidth="1.4" />
          <path d="M18 48c6 5 10 6 14 6s8-1 14-6" fill="none" stroke={tone.stitch} strokeWidth="1.4" />
          <circle cx="24" cy="38" r="2.2" fill="#2c241f" />
          <circle cx="40" cy="38" r="2.2" fill="#2c241f" />
          <ellipse cx="20" cy="44" rx="3" ry="1.6" fill={tone.cheek} opacity="0.8" />
          <ellipse cx="44" cy="44" rx="3" ry="1.6" fill={tone.cheek} opacity="0.8" />
          <path d="M29 46c2 2 4 2 6 0" fill="none" stroke="#5c403c" strokeWidth="1.3" strokeLinecap="round" />
          <ellipse cx="24" cy="62" rx="6" ry="3.5" fill={tone.ear} />
          <ellipse cx="40" cy="62" rx="6" ry="3.5" fill={tone.ear} />
          {style === 0 && (
            <>
              <path d="M32 12c2 4 1 7 0 8-1-1-2-4 0-8z" fill={tone.accent} />
              <circle cx="30" cy="10" r="3.2" fill={tone.accent2} />
              <circle cx="35" cy="11" r="3.2" fill={tone.accent} />
            </>
          )}
          {style === 2 && <path d="M26 16c4-8 8-8 12 0-4 2-8 2-12 0z" fill={tone.accent} />}
        </svg>
      )
    default: {
      const _never: never = kind
      return _never
    }
  }
}
