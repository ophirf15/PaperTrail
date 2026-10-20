import { X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const titleId = useId()
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = ref.current
    const focusable = () =>
      root
        ? [...root.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter(
            (el) => !el.hasAttribute('disabled'),
          )
        : []
    focusable()[0]?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const start = items[0]
      const end = items[items.length - 1]
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault()
        end.focus()
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault()
        start.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const prior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prior
      previous?.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="backdrop" onMouseDown={() => closeRef.current()}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={() => closeRef.current()}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <p>{body}</p>
      <div className="actions">
        <button type="button" className="btn danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}

export function Stars({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const id = useId().replace(/:/g, '')
  return (
    <div className="stars" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = value == null ? 0 : Math.max(0, Math.min(1, value - (star - 1)))
        return (
          <span className="star-slot" key={star}>
            <button type="button" className="half" role="radio" aria-checked={value === star - 0.5} aria-label={`${star - 0.5} stars`} onClick={() => onChange(star - 0.5)} />
            <button type="button" className="full" role="radio" aria-checked={value === star} aria-label={`${star} stars`} onClick={() => onChange(star)} />
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <defs>
                <linearGradient id={`${id}-${star}`}>
                  <stop offset={`${fill * 100}%`} stopColor="currentColor" />
                  <stop offset={`${fill * 100}%`} stopColor="transparent" />
                </linearGradient>
              </defs>
              <path
                d="M12 2.6 14.7 8.7 21.3 9.4 16.4 14 17.8 20.5 12 17.2 6.2 20.5 7.6 14 2.7 9.4 9.3 8.7Z"
                fill={`url(#${id}-${star})`}
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </span>
        )
      })}
      {value != null && (
        <button type="button" className="quiet" onClick={() => onChange(null)}>
          Clear
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  steps,
  action,
  achievement = false,
}: {
  title: string
  body: string
  steps?: string[]
  action?: ReactNode
  achievement?: boolean
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p className="lede">{body}</p>
      {steps && steps.length > 0 && (
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {achievement ? null : action}
    </div>
  )
}

export function useToasts() {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    [],
  )
  const push = useCallback((message: string) => {
    if (timer.current != null) window.clearTimeout(timer.current)
    const id = Date.now()
    setToast({ id, message })
    timer.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current))
      timer.current = null
    }, 2800)
  }, [])
  const view = toast ? (
    <div className="toast-wrap" aria-live="polite">
      <div className="toast">{toast.message}</div>
    </div>
  ) : null
  return { push, view }
}

export function SkeletonRow() {
  return (
    <div className="gallery" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="skeleton" style={{ aspectRatio: '2 / 3' }} />
      ))}
    </div>
  )
}
