-- +goose Up
-- Edit version, bumped by every edit of the row's form fields. An edit made
-- from an older version is refused, so two people editing the same thing at
-- once can't silently overwrite each other.
ALTER TABLE locations ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stock ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assets ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE assets DROP COLUMN version;
ALTER TABLE stock DROP COLUMN version;
ALTER TABLE items DROP COLUMN version;
ALTER TABLE categories DROP COLUMN version;
ALTER TABLE locations DROP COLUMN version;
