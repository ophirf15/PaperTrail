import { useEffect, useState } from 'react'
import { api } from '../api'
import { BookFace } from '../covers'
import { useJournalNav } from '../shell'
import { type Stats } from '../types'
import { SkeletonRow } from '../ui'

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function StatsPage() {
  const yearNow = new Date().getFullYear()
  const [year, setYear] = useState(yearNow)
  const [stats, setStats] = useState<Stats | null>(null)
  const { openBook } = useJournalNav()

  useEffect(() => {
    void api<Stats>(`/api/stats?year=${year}`).then(setStats)
  }, [year])

  const max = Math.max(1, ...(stats?.months ?? [1]))

  return (
    <div className="page">
      <p className="kicker">The year in books</p>
      <div className="section-head">
        <h1>Statistics</h1>
        <select className="select" aria-label="Year" value={year} onChange={(event) => setYear(Number(event.target.value))} style={{ width: 'auto' }}>
          {[0, 1, 2, 3, 4, 5].map((offset) => (
            <option key={yearNow - offset} value={yearNow - offset}>
              {yearNow - offset}
            </option>
          ))}
        </select>
      </div>
      {!stats && <SkeletonRow />}
      {stats && (
        <>
          <section className="stat-row" aria-label="Reading totals">
            <div className="stat">
              <b>{stats.totalFinished}</b>
              <span>Books finished</span>
            </div>
            <div className="stat">
              <b>{stats.finishedThisYear}</b>
              <span>Finished in {year}</span>
            </div>
            <div className="stat">
              <b>{stats.goal ?? '—'}</b>
              <span>Goal {stats.goal ? `${stats.finishedThisYear} of ${stats.goal}` : 'not set'}</span>
            </div>
            <div className="stat">
              <b>{stats.averageRating ?? '—'}</b>
              <span>Average rating</span>
            </div>
          </section>
          <div className="section-head">
            <h2>Months</h2>
            <span className="meta">{stats.yearPages ? `${stats.yearPages.toLocaleString()} pages this year` : 'Pages appear when a book has a count'}</span>
          </div>
          <div className="month-bars" aria-label="Books finished each month">
            {stats.months.map((count, index) => (
              <div key={months[index]}>
                <i style={{ height: `${Math.max(8, (count / max) * 100)}%` }} title={`${months[index]}: ${count}`} />
                <span>
                  {months[index]}
                  <span className="sr">{` ${count} books`}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="meta">
            {stats.currentlyReading} currently reading · {stats.wantToRead} waiting · {stats.totalPages.toLocaleString()} pages across finished books
          </p>
          <div className="section-head">
            <h2>Favorites of {year}</h2>
          </div>
          {stats.favorites.length === 0 ? (
            <p className="lede">Rate a finished book with four stars or more and it will rest here.</p>
          ) : (
            <div className="finish-row">
              {stats.favorites.map((book) => (
                <div key={book.id} style={{ width: 120, flex: 'none' }}>
                  <BookFace book={book} onOpen={openBook} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
