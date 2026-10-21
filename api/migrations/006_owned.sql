ALTER TABLE library_entries ADD COLUMN owned INTEGER NOT NULL DEFAULT 0;
UPDATE library_entries SET owned = 1 WHERE status IN ('reading', 'finished', 'dnf');
UPDATE library_entries SET owned = 1 WHERE book_id IN (
  SELECT id FROM books WHERE is_sample = 1 AND title IN ('The Night Circus', 'The House in the Cerulean Sea')
);
