-- +goose Up
-- 3D printers and their spare parts (nozzles, build plates), under Tools.
-- Filament stays in Mechanical › 3D-Printing Filament. Skipped if a category
-- of that name already exists.
INSERT INTO categories (parent_id, name)
SELECT (SELECT p.id FROM categories p WHERE p.name = 'Tools' COLLATE NOCASE
        ORDER BY p.parent_id IS NOT NULL, p.id LIMIT 1), '3D Printers'
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = '3D Printers' COLLATE NOCASE);

-- +goose Down
-- Nothing: it may hold items by now. Delete it on the Categories page.
