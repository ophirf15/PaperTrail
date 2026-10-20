import { BarChart3, House, Library, NotebookPen, Plus, Settings, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { AddBook } from './AddBook'
import { crumb } from './api'
import { BookModal } from './BookModal'
import { createContext, useContext, type ReactNode } from 'react'
import { Dialog } from './ui'
import type { Book } from './types'

type Nav = {
  openAdd: () => void
  openBook: (id: number, tab?: string) => void
}

const NavContext = createContext<Nav | null>(null)

export function useJournalNav() {
  const value = useContext(NavContext)
  if (!value) throw new Error('Navigation is missing')
  return value
}

const links = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/library', label: 'My Library', icon: Library, end: false },
  { to: '/journal', label: 'Journal', icon: NotebookPen, end: false },
  { to: '/stats', label: 'Statistics', icon: BarChart3, end: false },
  { to: '/people', label: 'People', icon: Users, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

export function Shell({ children }: { children?: ReactNode }) {
  const [params, setParams] = useSearchParams()
  const [addOpen, setAddOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [goalBook, setGoalBook] = useState<Book | null>(null)
  const location = useLocation()
  const bookId = params.get('book')
  const tab = params.get('tab')

  function openBook(id: number, nextTab?: string) {
    const next = new URLSearchParams(params)
    next.set('book', String(id))
    if (nextTab) next.set('tab', nextTab)
    else next.delete('tab')
    setParams(next)
  }

  function closeBook() {
    const next = new URLSearchParams(params)
    next.delete('book')
    next.delete('tab')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    crumb(location.pathname)
  }, [location.pathname])

  useEffect(() => {
    const onGoal = (event: Event) => setGoalBook((event as CustomEvent<Book>).detail)
    window.addEventListener('pt-goal', onGoal)
    return () => window.removeEventListener('pt-goal', onGoal)
  }, [])

  return (
    <NavContext.Provider value={{ openAdd: () => setAddOpen(true), openBook }}>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <NavLink to="/" className="wordmark">
            <strong>Paper Trail</strong>
            <span>A reading journal</span>
          </NavLink>
          <nav className="nav-list" aria-label="Primary">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                <link.icon size={18} aria-hidden="true" />
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-foot">
            <button type="button" className="btn" onClick={() => setAddOpen(true)}>
              <Plus size={16} aria-hidden="true" /> Add book
            </button>
          </div>
        </aside>
        <main id="content" className="main">
          {children ?? <Outlet />}
        </main>
        <nav className="mobile-nav" aria-label="Primary">
          {links.slice(0, 4).map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <link.icon size={18} aria-hidden="true" />
              {link.label === 'My Library' ? 'Library' : link.label === 'Statistics' ? 'Stats' : link.label}
            </NavLink>
          ))}
          <button type="button" onClick={() => setMoreOpen(true)}>
            <Settings size={18} aria-hidden="true" />
            More
          </button>
        </nav>
      </div>
      <AddBook open={addOpen} onClose={() => setAddOpen(false)} />
      <BookModal bookId={bookId} initialTab={tab} onClose={closeBook} />
      <Dialog open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <div className="nav-list">
          <NavLink to="/people" className="nav-link" onClick={() => setMoreOpen(false)}>
            <Users size={18} /> People
          </NavLink>
          <NavLink to="/settings" className="nav-link" onClick={() => setMoreOpen(false)}>
            <Settings size={18} /> Settings
          </NavLink>
        </div>
      </Dialog>
      <Dialog open={goalBook != null} title="A full year of reading" onClose={() => setGoalBook(null)}>
        <div className="goal-overlay">
          <p className="celebrate serif" style={{ fontSize: '1.4rem', marginTop: 0 }}>
            The shelf is complete.
          </p>
          <p className="lede">You reached this year's reading goal{goalBook ? `, closing it with ${goalBook.title}` : ''}.</p>
          <button type="button" className="btn" onClick={() => setGoalBook(null)}>
            Keep reading
          </button>
        </div>
      </Dialog>
    </NavContext.Provider>
  )
}
