ALTER TABLE contacts ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;

CREATE TABLE shelf_decorations (
  id INTEGER PRIMARY KEY,
  shelf_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_decor_shelf ON shelf_decorations (shelf_index);
