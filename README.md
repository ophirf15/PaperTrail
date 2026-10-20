# Paper Trail

A personal reading journal and digital bookshelf. Track what you want to read, what you are reading, and what you finished. Open any cover to write, save quotes, rate the book, and note who you would share it with.

## Run it locally

Use two terminals from this folder.

```bash
npm run api
npm run dev
```

Open http://localhost:5173. The first visit asks you to name the journal and choose a password. The API listens on http://127.0.0.1:8080.

PHP 8.1 or newer is required, with SQLite enabled. The database is created at `data/paper-trail.sqlite`.

## Everyday use

- Add a book by title, author, or ISBN. Covers and details come from Open Library when they are available.
- Switch between wooden shelves and a cover gallery.
- Open a cover to update progress, rate, journal, quote, or choose who you would share it with.
- Import a Goodreads CSV from Settings. Importing again will not duplicate books or erase journal notes.
- Download a JSON backup or a CSV of the library from Settings. Sample books are optional and clearly marked.

Change the password from Settings. If you forget it, from this folder run:

```bash
php scripts/reset-password.php "a new password"
```

## Build for PHP hosting

```bash
npm run build
```

A published release is a zip you extract in the site's document root. Open the site and finish setup on the installer page. Choose MySQL and enter the host, database name, username, and password from the host. The installer writes `.env` and creates the tables there, so the library is not a file in the site folder. SQLite remains available for a private computer, as `data/paper-trail.sqlite`. The site folder still needs to be writable so `.env` can be saved. PHP needs the `pdo_mysql` extension for MySQL, or `pdo_sqlite` for the file.

To check GitHub releases from Settings, set `PAPER_TRAIL_GITHUB_REPO` to `owner/repo`. Applying an update also requires `PAPER_TRAIL_UPDATES_ENABLED=true`. Downloads are limited to GitHub hosts, and the database plus `.env` are left in place. A database copy is written to `data/backups/` before an update is applied.

## Tests

```bash
php tests/run.php
```

## Notes

Book metadata is fetched from Open Library. Personal notes, quotes, ratings, and progress stay in your SQLite database. Nothing is emailed or posted to a social network.
