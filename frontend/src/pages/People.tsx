import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { Cover } from '../covers'
import { useJournalNav } from '../shell'
import { useToast } from '../state'
import { formatDate, type Contact } from '../types'
import { Confirm, EmptyState } from '../ui'

export function PeoplePage() {
  const [people, setPeople] = useState<Contact[] | null>(null)
  const [name, setName] = useState('')
  const toast = useToast()

  function load() {
    void api<Contact[]>('/api/contacts').then(setPeople)
  }
  useEffect(load, [])

  return (
    <div className="page">
      <p className="kicker">The people you think of</p>
      <h1>People</h1>
      <p className="lede">Names you can attach to a book, with a note about why.</p>
      <form
        className="mini-progress"
        onSubmit={(event) => {
          event.preventDefault()
          void api<Contact>('/api/contacts', { method: 'POST', json: { name } }).then(() => {
            setName('')
            toast('Saved.')
            load()
          })
        }}
      >
        <input className="field" required aria-label="Name" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <button className="btn" type="submit">
          Add person
        </button>
      </form>
      {people && people.length === 0 && (
        <EmptyState
          title="No one is listed yet."
          body="Add the people you imagine handing a book to. Email is optional, and nothing is sent."
          steps={['Add a name.', 'Open a book.', 'Choose them under Who I would share this with.']}
        />
      )}
      <ul className="person-list">
        {people?.map((person) => (
          <li key={person.id}>
            <Link to={`/people/${person.id}`}>
              {person.name}
              <span className="meta">{person.nickname ?? ''}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PersonPage() {
  const { id } = useParams()
  const [person, setPerson] = useState<Contact | null>(null)
  const [confirming, setConfirming] = useState(false)
  const { openBook } = useJournalNav()
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    if (!id) return
    void api<Contact>(`/api/contacts/${id}`).then(setPerson)
  }, [id])

  if (!person) return <p className="meta">Opening their page…</p>
  const waiting = person.recommendations?.filter((item) => !item.sharedAt) ?? []
  const shared = person.recommendations?.filter((item) => item.sharedAt) ?? []

  return (
    <div className="page">
      <p className="kicker">A reader you know</p>
      <h1>{person.name}</h1>
      {person.nickname && <p className="lede">{person.nickname}</p>}
      <form
        className="settings-grid"
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void api<Contact>(`/api/contacts/${person.id}`, {
            method: 'PATCH',
            json: { nickname: String(data.get('nickname') ?? ''), email: String(data.get('email') ?? ''), notes: String(data.get('notes') ?? '') },
          }).then((next) => {
            setPerson({ ...person, ...next })
            toast('Saved.')
          })
        }}
      >
        <label className="stack">
          <span>Nickname</span>
          <input className="field" name="nickname" defaultValue={person.nickname ?? ''} />
        </label>
        <label className="stack">
          <span>Email, if you want it</span>
          <input className="field" name="email" type="email" defaultValue={person.email ?? ''} />
        </label>
        <label className="stack">
          <span>Notes</span>
          <textarea className="area" name="notes" defaultValue={person.notes ?? ''} />
        </label>
        <button className="btn" type="submit">
          Save
        </button>
      </form>
      <div className="section-head">
        <h2>Books for them</h2>
      </div>
      {waiting.length === 0 && <p className="meta">Nothing waiting. Mark a book from its Share tab.</p>}
      <div className="finish-row">
        {waiting.map((item) => (
          <article key={item.id} style={{ width: 140, flex: 'none' }}>
            <button type="button" className="book-face" onClick={() => openBook(item.bookId, 'share')} aria-label={item.title}>
              <Cover title={item.title} authors={item.authors} coverUrl={item.coverUrl} />
              <span className="caption">
                <strong>{item.title}</strong>
                <em>{item.note || 'No note yet'}</em>
              </span>
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() =>
                void api(`/api/recommendations/${item.id}`, { method: 'PATCH', json: { shared: true } }).then(() =>
                  api<Contact>(`/api/contacts/${person.id}`).then(setPerson),
                )
              }
            >
              Mark as shared
            </button>
          </article>
        ))}
      </div>
      {shared.length > 0 && (
        <>
          <div className="section-head">
            <h2>Already shared</h2>
          </div>
          <ul className="person-list">
            {shared.map((item) => (
              <li key={item.id}>
                <button type="button" className="quiet" onClick={() => openBook(item.bookId)}>
                  {item.title}
                  <span className="meta">{item.sharedAt ? formatDate(item.sharedAt) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="btn danger" onClick={() => setConfirming(true)}>
        Remove person
      </button>
      <Confirm
        open={confirming}
        title={`Remove ${person.name}?`}
        body="Their recommendation notes will be removed. Your books stay."
        confirmLabel="Remove"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          void api(`/api/contacts/${person.id}`, { method: 'DELETE' }).then(() => {
            navigate('/people')
          })
        }}
      />
    </div>
  )
}
