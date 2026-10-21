import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, api } from './api'
import { useLibrary, useToast } from './state'
import { STATUS_LABEL, assertNever, authorLine, type Book, type ReadingStatus } from './types'

const RATINGS = ['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5']

type Column = 'status' | 'owned' | 'rating' | 'dateStarted' | 'dateFinished'
type SortKey = 'title' | Column
type SortDir = 'asc' | 'desc'
type Sort = { key: SortKey; dir: SortDir }
type Fill = { column: Column; from: number; to: number }
type CopyFilter = '' | 'yes' | 'no'

const STATUS_ORDER: Record<ReadingStatus, number> = { reading: 0, want: 1, finished: 2, dnf: 3 }

function shortStatus(status: ReadingStatus): string {
  switch (status) {
    case 'want':
      return 'Want'
    case 'reading':
      return 'Reading'
    case 'finished':
      return 'Finished'
    case 'dnf':
      return 'DNF'
    default:
      return assertNever(status)
  }
}

function columnPatch(column: Column, book: Book): Record<string, unknown> {
  switch (column) {
    case 'status':
      return { status: book.status }
    case 'owned':
      return { owned: book.owned }
    case 'rating':
      return { rating: book.rating }
    case 'dateStarted':
      return { dateStarted: book.dateStarted }
    case 'dateFinished':
      return { dateFinished: book.dateFinished }
    default:
      return assertNever(column)
  }
}

function compareBooks(a: Book, b: Book, sort: Sort): number {
  const dir = sort.dir === 'asc' ? 1 : -1
  const empty = (left: number, right: number) => (left === 0 && right === 0 ? 0 : left === 0 ? 1 : right === 0 ? -1 : (left - right) * dir)
  switch (sort.key) {
    case 'title':
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) * dir
    case 'status':
      return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * dir
    case 'owned':
      return (Number(a.owned) - Number(b.owned)) * dir
    case 'rating':
      return empty(a.rating ?? 0, b.rating ?? 0)
    case 'dateStarted':
      return empty(a.dateStarted ? 1 : 0, b.dateStarted ? 1 : 0) || (a.dateStarted ?? '').localeCompare(b.dateStarted ?? '') * dir
    case 'dateFinished':
      return empty(a.dateFinished ? 1 : 0, b.dateFinished ? 1 : 0) || (a.dateFinished ?? '').localeCompare(b.dateFinished ?? '') * dir
    default:
      return assertNever(sort.key)
  }
}

export function Ledger({ books, onOpen }: { books: Book[]; onOpen: (id: number) => void }) {
  const { upsert } = useLibrary()
  const toast = useToast()
  const tableRef = useRef<HTMLTableElement>(null)
  const rowsRef = useRef<Book[]>([])
  const dragRef = useRef<(() => void) | null>(null)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'' | ReadingStatus>('')
  const [copy, setCopy] = useState<CopyFilter>('')
  const [sort, setSort] = useState<Sort>({ key: 'title', dir: 'asc' })
  const [fill, setFill] = useState<Fill | null>(null)
  const [active, setActive] = useState<{ id: number; column: Column } | null>(null)
  const [bulkStatus, setBulkStatus] = useState<'' | ReadingStatus>('')
  const [bulkOwned, setBulkOwned] = useState<CopyFilter>('')
  const [bulkRating, setBulkRating] = useState('')
  const [bulkStarted, setBulkStarted] = useState('')
  const [bulkFinished, setBulkFinished] = useState('')
  const [applying, setApplying] = useState(false)

  const needle = query.trim().toLowerCase()
  const rows = books
    .filter((book) => {
      if (status && book.status !== status) return false
      if (copy === 'yes' && !book.owned) return false
      if (copy === 'no' && book.owned) return false
      if (!needle) return true
      return book.title.toLowerCase().includes(needle) || book.authors.some((author) => author.toLowerCase().includes(needle))
    })
    .slice()
    .sort((a, b) => compareBooks(a, b, sort) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  rowsRef.current = rows

  useEffect(() => () => dragRef.current?.(), [])

  const chosen = rows.filter((book) => selected.has(book.id))
  const allSelected = rows.length > 0 && rows.every((book) => selected.has(book.id))
  const fillStart = fill ? Math.min(fill.from, fill.to) : -1
  const fillEnd = fill ? Math.max(fill.from, fill.to) : -1

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
      const dates = key === 'dateStarted' || key === 'dateFinished' || key === 'rating'
      return { key, dir: dates ? 'desc' : 'asc' }
    })
  }

  function sortState(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sort.key !== key) return 'none'
    return sort.dir === 'asc' ? 'ascending' : 'descending'
  }

  async function save(book: Book, patch: Record<string, unknown>) {
    try {
      const next = await api<Book>(`/api/books/${book.id}/entry`, { method: 'PATCH', json: patch })
      upsert(next)
      if (next.goalReached) window.dispatchEvent(new CustomEvent('pt-goal', { detail: next }))
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'That change could not be saved.')
    }
  }

  async function saveMany(ids: number[], patch: Record<string, unknown>) {
    const result = await api<{ updated: number; books: Book[] }>('/api/books/bulk', { method: 'POST', json: { ids, ...patch } })
    result.books.forEach((book) => {
      upsert(book)
      if (book.goalReached) window.dispatchEvent(new CustomEvent('pt-goal', { detail: book }))
    })
    return result.updated
  }

  function indexAt(clientY: number): number | null {
    const table = tableRef.current
    if (!table) return null
    const nodes = [...table.querySelectorAll<HTMLElement>('tbody tr')]
    for (const node of nodes) {
      const box = node.getBoundingClientRect()
      if (clientY >= box.top && clientY <= box.bottom) return Number(node.dataset.index)
    }
    const first = nodes[0]?.getBoundingClientRect()
    const last = nodes[nodes.length - 1]?.getBoundingClientRect()
    if (first && clientY < first.top) return 0
    if (last && clientY > last.bottom) return nodes.length - 1
    return null
  }

  function beginFill(event: ReactPointerEvent<HTMLButtonElement>, column: Column, index: number) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current?.()
    const pointerId = event.pointerId
    const pointerType = event.pointerType
    const shield = document.createElement('div')
    shield.className = 'sheet-drag-shield'
    shield.setAttribute('aria-hidden', 'true')
    document.body.appendChild(shield)
    try {
      shield.setPointerCapture(pointerId)
    } catch {
      // The pointer is still followed from the document listeners below.
    }
    let finished = false
    setFill({ column, from: index, to: index })

    const track = (clientY: number) => {
      if (clientY > window.innerHeight - 56) window.scrollBy(0, 18)
      else if (clientY < 56) window.scrollBy(0, -18)
      const next = indexAt(clientY)
      if (next == null) return
      setFill({ column, from: index, to: next })
    }
    const detach = () => {
      shield.removeEventListener('pointermove', onPointerMove)
      shield.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('mouseup', onMouseUp, true)
      document.removeEventListener('keydown', onKey, true)
      shield.remove()
      if (dragRef.current === stop) dragRef.current = null
    }
    const stop = () => {
      finished = true
      detach()
      setFill(null)
    }
    const commit = (clientY: number) => {
      if (finished) return
      finished = true
      detach()
      const next = indexAt(clientY) ?? index
      setFill(null)
      const list = rowsRef.current
      const source = list[index]
      if (!source) return
      const low = Math.min(index, next)
      const high = Math.max(index, next)
      const ids = list.slice(low, high + 1).filter((book) => book.id !== source.id).map((book) => book.id)
      if (ids.length === 0) return
      void saveMany(ids, columnPatch(column, source))
        .then((count) => toast(`Filled ${count} ${count === 1 ? 'cell' : 'cells'}.`))
        .catch((error: unknown) => toast(error instanceof ApiError ? error.message : 'That column could not be filled.'))
    }
    // macOS delivers pointerup while the button is still held, once the pointer
    // crosses a select in a later row. mouseup is the release that should fill.
    const onPointerMove = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId || finished) return
      if (pointer.cancelable) pointer.preventDefault()
      track(pointer.clientY)
    }
    const onPointerUp = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId || pointer.pointerType === 'mouse') return
      commit(pointer.clientY)
    }
    const onMouseUp = (mouse: MouseEvent) => {
      if (pointerType !== 'mouse' || mouse.button !== 0) return
      commit(mouse.clientY)
    }
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') stop()
    }
    shield.addEventListener('pointermove', onPointerMove)
    shield.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('keydown', onKey, true)
    dragRef.current = stop
  }

  async function applyBulk() {
    const patch: Record<string, unknown> = {}
    if (bulkStatus) patch.status = bulkStatus
    if (bulkOwned === 'yes') patch.owned = true
    if (bulkOwned === 'no') patch.owned = false
    if (bulkRating) patch.rating = Number(bulkRating)
    if (bulkStarted) patch.dateStarted = bulkStarted
    if (bulkFinished) patch.dateFinished = bulkFinished
    if (Object.keys(patch).length === 0) {
      toast('Choose a status, date, rating, or ownership first.')
      return
    }
    setApplying(true)
    try {
      const count = await saveMany(chosen.map((book) => book.id), patch)
      setSelected(new Set())
      setBulkStatus('')
      setBulkOwned('')
      setBulkRating('')
      setBulkStarted('')
      setBulkFinished('')
      toast(`Updated ${count} ${count === 1 ? 'book' : 'books'}.`)
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Those books could not be updated.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="sheet">
      <div className="sheet-tools">
        <input className="sheet-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter title or author" aria-label="Filter the sheet" />
        <select className="sheet-input" aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value as '' | ReadingStatus)}>
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as ReadingStatus[]).map((key) => (
            <option key={key} value={key}>
              {shortStatus(key)}
            </option>
          ))}
        </select>
        <select className="sheet-input" aria-label="Filter by ownership" value={copy} onChange={(event) => setCopy(event.target.value as CopyFilter)}>
          <option value="">Owned or not</option>
          <option value="yes">On the shelf</option>
          <option value="no">Still to buy</option>
        </select>
        <span className="meta">{rows.length} shown</span>
      </div>
      <p className="meta sheet-hint">
        {fill ? 'Release to copy the cell down the highlighted rows.' : 'Drag the corner of a cell down the column to copy it. Click a heading to sort.'}
      </p>
      {chosen.length > 0 && (
        <form
          className="sheet-bulk"
          onSubmit={(event) => {
            event.preventDefault()
            void applyBulk()
          }}
        >
          <span>{chosen.length} selected</span>
          <select className="sheet-input" aria-label="Status for selected books" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as '' | ReadingStatus)}>
            <option value="">Status</option>
            {(Object.keys(STATUS_LABEL) as ReadingStatus[]).map((key) => (
              <option key={key} value={key}>
                {shortStatus(key)}
              </option>
            ))}
          </select>
          <select className="sheet-input" aria-label="Ownership for selected books" value={bulkOwned} onChange={(event) => setBulkOwned(event.target.value as CopyFilter)}>
            <option value="">Leave</option>
            <option value="yes">Owned</option>
            <option value="no">To buy</option>
          </select>
          <select className="sheet-input" aria-label="Rating for selected books" value={bulkRating} onChange={(event) => setBulkRating(event.target.value)}>
            <option value="">Rating</option>
            {RATINGS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <input className="sheet-input" type="date" aria-label="Date started for selected books" value={bulkStarted} onChange={(event) => setBulkStarted(event.target.value)} />
          <input className="sheet-input" type="date" aria-label="Date finished for selected books" value={bulkFinished} onChange={(event) => setBulkFinished(event.target.value)} />
          <button className="btn" type="submit" disabled={applying}>
            {applying ? 'Saving…' : 'Apply'}
          </button>
        </form>
      )}
      <div className="ledger-wrap">
        <table className="ledger" ref={tableRef}>
          <colgroup>
            <col className="col-check" />
            <col className="col-book" />
            <col className="col-status" />
            <col className="col-copy" />
            <col className="col-rating" />
            <col className="col-date" />
            <col className="col-date" />
          </colgroup>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all visible books"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((book) => book.id)))}
                />
              </th>
              <SortHead label="Book" sortKey="title" state={sortState('title')} onSort={toggleSort} />
              <SortHead label="Status" sortKey="status" state={sortState('status')} onSort={toggleSort} />
              <SortHead label="Owned" sortKey="owned" state={sortState('owned')} onSort={toggleSort} />
              <SortHead label="Rating" sortKey="rating" state={sortState('rating')} onSort={toggleSort} />
              <SortHead label="Started" sortKey="dateStarted" state={sortState('dateStarted')} onSort={toggleSort} />
              <SortHead label="Finished" sortKey="dateFinished" state={sortState('dateFinished')} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="sheet-empty" colSpan={7}>
                  Nothing in the sheet matches.
                </td>
              </tr>
            )}
            {rows.map((book, index) => {
              const inFill = index >= fillStart && index <= fillEnd
              return (
                <tr key={book.id} data-index={index} className={inFill ? 'is-fill' : undefined}>
                  <td className="sheet-check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${book.title}`}
                      checked={selected.has(book.id)}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current)
                          if (next.has(book.id)) next.delete(book.id)
                          else next.add(book.id)
                          return next
                        })
                      }
                    />
                  </td>
                  <td className="sheet-book">
                    <SheetThumb book={book} />
                    <button type="button" className="sheet-title" title={authorLine(book.authors)} onClick={() => onOpen(book.id)}>
                      {book.title}
                    </button>
                  </td>
                  <Cell book={book} column="status" active={active} onActive={setActive} onFill={beginFill}>
                    <select className="sheet-input" aria-label={`Status for ${book.title}`} value={book.status} onChange={(event) => void save(book, { status: event.target.value })}>
                      {(Object.keys(STATUS_LABEL) as ReadingStatus[]).map((key) => (
                        <option key={key} value={key}>
                          {shortStatus(key)}
                        </option>
                      ))}
                    </select>
                  </Cell>
                  <Cell book={book} column="owned" active={active} onActive={setActive} onFill={beginFill}>
                    <input
                      type="checkbox"
                      aria-label={`On your shelf: ${book.title}`}
                      checked={book.owned}
                      onChange={(event) => void save(book, { owned: event.target.checked })}
                    />
                  </Cell>
                  <Cell book={book} column="rating" active={active} onActive={setActive} onFill={beginFill}>
                    <select
                      className="sheet-input"
                      aria-label={`Rating for ${book.title}`}
                      value={book.rating == null ? '' : String(book.rating)}
                      onChange={(event) => void save(book, { rating: event.target.value === '' ? null : Number(event.target.value) })}
                    >
                      <option value="">—</option>
                      {RATINGS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </Cell>
                  <DateCell book={book} column="dateStarted" active={active} onActive={setActive} onFill={beginFill} onSave={save} />
                  <DateCell book={book} column="dateFinished" active={active} onActive={setActive} onFill={beginFill} onSave={save} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortHead({ label, sortKey, state, onSort }: { label: string; sortKey: SortKey; state: 'ascending' | 'descending' | 'none'; onSort: (key: SortKey) => void }) {
  const mark = state === 'ascending' ? '↑' : state === 'descending' ? '↓' : ''
  return (
    <th aria-sort={state}>
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
        {mark ? <span aria-hidden="true"> {mark}</span> : null}
      </button>
    </th>
  )
}

function Cell({
  book,
  column,
  active,
  onActive,
  onFill,
  children,
}: {
  book: Book
  column: Column
  active: { id: number; column: Column } | null
  onActive: (value: { id: number; column: Column }) => void
  onFill: (event: ReactPointerEvent<HTMLButtonElement>, column: Column, index: number) => void
  children: ReactNode
}) {
  const focused = active?.id === book.id && active.column === column
  return (
    <td className={`sheet-cell${focused ? ' is-active' : ''}`} onFocus={() => onActive({ id: book.id, column })}>
      {children}
      <button
        type="button"
        className="sheet-fill"
        aria-label={`Fill ${column} down from ${book.title}`}
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          const row = event.currentTarget.closest('tr')
          const index = Number(row?.getAttribute('data-index') ?? '-1')
          if (index < 0) return
          onFill(event, column, index)
        }}
      />
    </td>
  )
}

function DateCell({
  book,
  column,
  active,
  onActive,
  onFill,
  onSave,
}: {
  book: Book
  column: 'dateStarted' | 'dateFinished'
  active: { id: number; column: Column } | null
  onActive: (value: { id: number; column: Column }) => void
  onFill: (event: ReactPointerEvent<HTMLButtonElement>, column: Column, index: number) => void
  onSave: (book: Book, patch: Record<string, unknown>) => Promise<void>
}) {
  const value = column === 'dateStarted' ? book.dateStarted : book.dateFinished
  const label = column === 'dateStarted' ? 'Date started' : 'Date finished'
  return (
    <Cell book={book} column={column} active={active} onActive={onActive} onFill={onFill}>
      <span className="sheet-value">{value ?? ''}</span>
      <input
        className="sheet-date"
        type="date"
        aria-label={`${label} for ${book.title}`}
        value={value ?? ''}
        onChange={(event) => void onSave(book, { [column]: event.target.value || null })}
      />
    </Cell>
  )
}

function SheetThumb({ book }: { book: Book }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState<{ top: number; left: number } | null>(null)
  const missing = !book.coverUrl || failed

  function showZoom() {
    const box = anchor.current?.getBoundingClientRect()
    if (!box) return
    const width = 104
    const height = 156
    let left = box.right + 10
    if (left + width > window.innerWidth - 12) left = Math.max(12, box.left - width - 10)
    let top = box.top
    if (top + height > window.innerHeight - 12) top = window.innerHeight - height - 12
    if (top < 12) top = 12
    setZoom({ top, left })
  }

  useEffect(() => {
    if (!zoom) return
    const hide = () => setZoom(null)
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [zoom])

  return (
    <span className="sheet-thumb-hit" ref={anchor} onMouseEnter={showZoom} onMouseLeave={() => setZoom(null)}>
      {missing ? (
        <span className="sheet-thumb sheet-thumb-fallback" aria-hidden="true" />
      ) : (
        <img className="sheet-thumb" src={book.coverUrl ?? ''} alt="" onError={() => setFailed(true)} />
      )}
      {zoom && createPortal(
        <span className="sheet-zoom" style={{ top: zoom.top, left: zoom.left }} aria-hidden="true">
          {missing ? <span className="sheet-zoom-fallback">{book.title}</span> : <img src={book.coverUrl ?? ''} alt="" />}
        </span>,
        document.body,
      )}
    </span>
  )
}
