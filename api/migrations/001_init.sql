CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_login_attempts_ip_time ON login_attempts (ip, created_at);

CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  isbn10 TEXT,
  isbn13 TEXT,
  publisher TEXT,
  publish_year INTEGER,
  description TEXT,
  page_count INTEGER,
  genres_json TEXT NOT NULL DEFAULT '[]',
  cover_url TEXT,
  open_library_work_key TEXT,
  goodreads_book_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_books_goodreads ON books (goodreads_book_id) WHERE goodreads_book_id IS NOT NULL;
CREATE INDEX idx_books_isbn13 ON books (isbn13);
CREATE INDEX idx_books_isbn10 ON books (isbn10);
CREATE INDEX idx_books_work ON books (open_library_work_key);

CREATE TABLE library_entries (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL UNIQUE REFERENCES books (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('want', 'reading', 'finished', 'dnf')),
  rating REAL,
  date_added TEXT,
  date_started TEXT,
  date_finished TEXT,
  current_page INTEGER,
  progress_percent REAL,
  read_count INTEGER NOT NULL DEFAULT 0,
  imported_review TEXT,
  rating_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_library_status ON library_entries (status);
CREATE INDEX idx_library_finished ON library_entries (date_finished);

CREATE TABLE reading_sessions (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL,
  ending_page INTEGER,
  is_reread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_book ON reading_sessions (book_id);

CREATE TABLE journal_entries (
  id INTEGER PRIMARY KEY,
  book_id INTEGER REFERENCES books (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'journal',
  body_html TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_journal_book ON journal_entries (book_id);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  location TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_quotes_book ON quotes (book_id);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE recommendations (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  note TEXT,
  shared_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (contact_id, book_id)
);

CREATE TABLE reading_goals (
  year INTEGER PRIMARY KEY,
  target_count INTEGER NOT NULL,
  celebrated_at TEXT
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  source TEXT NOT NULL DEFAULT 'user'
);

CREATE TABLE book_tags (
  book_id INTEGER NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, tag_id)
);

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  filename TEXT,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE import_staging (
  token TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE error_events (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  url TEXT,
  user_agent TEXT,
  user_id INTEGER,
  breadcrumbs_json TEXT,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_errors_created ON error_events (created_at);
CREATE INDEX idx_errors_fingerprint ON error_events (fingerprint);
