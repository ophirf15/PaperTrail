import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, reportError } from './api'
import type { Book, Settings, User } from './types'
import { useToasts } from './ui'

export type InstallDatabase =
  | { driver: 'sqlite' }
  | { driver: 'mysql'; host: string; port: number; name: string; user: string; password: string }

type AuthValue = {
  user: User | null
  loading: boolean
  needsSetup: boolean
  settings: Settings
  login: (password: string) => Promise<void>
  setup: (displayName: string, password: string, database?: InstallDatabase) => Promise<void>
  logout: () => Promise<void>
  setDisplayName: (displayName: string) => Promise<void>
  changePassword: (current: string, password: string) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

function applyTheme(theme: Settings['theme']) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('pt-theme', theme)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [settings, setSettings] = useState<Settings>({ theme: 'light', shelfView: 'shelf', shelfStyle: 'mixed', shelfArrange: 'free', shelfOrder: '' })

  const adopt = useCallback((nextUser: User, nextSettings: Settings) => {
    setUser(nextUser)
    setSettings(nextSettings)
    applyTheme(nextSettings.theme)
    setNeedsSetup(false)
  }, [])

  useEffect(() => {
    let alive = true
    api<{ user: User; settings: Settings }>('/api/me')
      .then((data) => {
        if (alive) adopt(data.user, data.settings)
      })
      .catch(async (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          const status = await api<{ needsSetup: boolean }>('/api/setup-status')
          if (alive) setNeedsSetup(status.needsSetup)
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    const onLost = () => setUser(null)
    window.addEventListener('pt-unauthorized', onLost)
    window.addEventListener('error', (event) => reportError(event.error ?? event.message))
    window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
    return () => {
      alive = false
      window.removeEventListener('pt-unauthorized', onLost)
    }
  }, [adopt])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      needsSetup,
      settings,
      async login(password) {
        const data = await api<{ user: User; settings: Settings }>('/api/login', { method: 'POST', json: { password } })
        adopt(data.user, data.settings)
      },
      async setup(displayName, password, database) {
        const data = await api<{ user: User; settings: Settings }>('/api/setup', {
          method: 'POST',
          json: database ? { displayName, password, database } : { displayName, password },
        })
        adopt(data.user, data.settings)
      },
      async logout() {
        await api('/api/logout', { method: 'POST', json: {} })
        setUser(null)
      },
      async setDisplayName(displayName) {
        const data = await api<{ user: User }>('/api/me', { method: 'PUT', json: { displayName } })
        setUser(data.user)
      },
      async changePassword(current, password) {
        await api('/api/password', { method: 'POST', json: { current, password } })
      },
      async saveSettings(patch) {
        const next = await api<Settings>('/api/settings', { method: 'PUT', json: patch })
        setSettings(next)
        if (patch.theme) applyTheme(next.theme)
      },
    }),
    [user, loading, needsSetup, settings, adopt],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('Auth is missing')
  return value
}

type LibraryValue = {
  books: Book[] | null
  refresh: () => Promise<void>
  upsert: (book: Book) => void
  remove: (id: number) => void
}

const LibraryContext = createContext<LibraryValue | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[] | null>(null)
  const refresh = useCallback(async () => {
    const next = await api<Book[]>('/api/library')
    setBooks(next)
  }, [])
  useEffect(() => {
    void refresh().catch((error: unknown) => reportError(error))
  }, [refresh])
  const value = useMemo<LibraryValue>(
    () => ({
      books,
      refresh,
      upsert(book) {
        setBooks((current) => {
          if (!current) return [book]
          const index = current.findIndex((item) => item.id === book.id)
          if (index === -1) return [book, ...current]
          const next = current.slice()
          next[index] = { ...next[index], ...book }
          return next
        })
      },
      remove(id) {
        setBooks((current) => current?.filter((book) => book.id !== id) ?? null)
      },
    }),
    [books, refresh],
  )
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary() {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('Library is missing')
  return value
}

const ToastContext = createContext<(message: string) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const { push, view } = useToasts()
  return (
    <ToastContext.Provider value={push}>
      {children}
      {view}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
