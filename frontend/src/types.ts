export type ReadingStatus = 'want' | 'reading' | 'finished' | 'dnf'

export type Book = {
  id: number
  title: string
  authors: string[]
  isbn10: string | null
  isbn13: string | null
  publisher: string | null
  publishYear: number | null
  description: string | null
  pageCount: number | null
  genres: string[]
  coverUrl: string | null
  workKey: string | null
  goodreadsBookId: string | null
  source: string
  isSample: boolean
  status: ReadingStatus
  rating: number | null
  dateAdded: string | null
  dateStarted: string | null
  dateFinished: string | null
  currentPage: number | null
  progressPercent: number | null
  readCount: number
  owned: boolean
  importedReview: string | null
  tags: string[]
  alreadyOwned?: boolean
  goalReached?: boolean
}

export type Quote = {
  id: number
  body: string
  location: string | null
  note: string | null
  createdAt: string
}

export type Recommendation = {
  id: number
  contactId: number
  name: string
  nickname: string | null
  note: string | null
  sharedAt: string | null
}

export type JournalEntry = {
  id: number
  bodyHtml: string
  createdAt: string
}

export type BookDetail = Book & {
  journalHtml: string
  journalEntries: JournalEntry[]
  quotes: Quote[]
  recommendations: Recommendation[]
  sessions: { id: number; startedAt: string | null; finishedAt: string | null; status: string; isReread: boolean }[]
}

export type SearchHit = {
  workKey: string
  title: string
  authors: string[]
  publishYear: number | null
  isbn13: string | null
  isbn10: string | null
  publisher: string | null
  pageCount: number | null
  genres: string[]
  coverUrl: string | null
  description: string | null
}

export type Stats = {
  year: number
  finishedThisYear: number
  months: number[]
  goal: number | null
  goalCelebrated: boolean
  favorites: Book[]
  yearPages: number
  yearAverage: number | null
  totalFinished: number
  currentlyReading: number
  wantToRead: number
  averageRating: number | null
  totalPages: number
  finishedBooks: Book[]
}

export type TimelineEvent = {
  type: 'started' | 'finished' | 'rated' | 'quote' | 'journal' | 'note'
  at: string
  bookId: number
  title: string
  authors: string[]
  coverUrl: string | null
  text: string
  rating: number | null
}

export type Contact = {
  id: number
  name: string
  nickname: string | null
  email: string | null
  notes: string | null
  recommendations?: {
    id: number
    bookId: number
    title: string
    authors: string[]
    coverUrl: string | null
    note: string | null
    sharedAt: string | null
    status: ReadingStatus
  }[]
}

export type ShelfArrange = 'author' | 'read' | 'genre' | 'free'

export type Settings = {
  theme: 'light' | 'dark'
  shelfView: 'gallery' | 'shelf' | 'ledger'
  shelfStyle: 'spines' | 'mixed' | 'covers'
  shelfArrange: ShelfArrange
  shelfOrder: string
}

export type User = { id: number; displayName: string }

export const STATUS_LABEL: Record<ReadingStatus, string> = {
  want: 'Want to read',
  reading: 'Currently reading',
  finished: 'Finished',
  dnf: 'Did not finish',
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`)
}

export function progressOf(book: Pick<Book, 'status' | 'pageCount' | 'currentPage' | 'progressPercent'>): number | null {
  if (book.status === 'finished') return 100
  if (book.pageCount && book.currentPage != null) {
    return Math.min(100, Math.round((book.currentPage / book.pageCount) * 100))
  }
  if (book.progressPercent != null) return Math.round(book.progressPercent)
  return null
}

export function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export function authorLine(authors: string[]): string {
  return authors.filter(Boolean).join(', ')
}
