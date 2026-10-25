-- +goose Up
-- Short text printed on the item's labels instead of its name, e.g.
-- "Capacitors 1uF 0402" for "Multilayer Ceramic Capacitors MLCC - SMD/SMT X6S,
-- 1uF, +/-10%, 16v, 0402". Empty means the name.
ALTER TABLE items ADD COLUMN label_text TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE items DROP COLUMN label_text;
