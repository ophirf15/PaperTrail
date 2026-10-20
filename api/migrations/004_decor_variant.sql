ALTER TABLE shelf_decorations ADD COLUMN variant INTEGER NOT NULL DEFAULT 0;

UPDATE shelf_decorations SET variant = abs(random()) % 3;
