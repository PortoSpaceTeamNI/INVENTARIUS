-- name: ListLocations :many
SELECT * FROM locations ORDER BY name;

-- name: GetLocation :one
SELECT * FROM locations WHERE id = ?;

-- name: CreateLocation :one
INSERT INTO locations (parent_id, name, description) VALUES (?, ?, ?) RETURNING *;

-- name: UpdateLocation :one
UPDATE locations SET parent_id = ?, name = ?, description = ?, version = version + 1 WHERE id = ? RETURNING *;

-- name: FindLocationByName :one
SELECT * FROM locations
WHERE parent_id IS sqlc.narg(parent_id) AND name = sqlc.arg(name) COLLATE NOCASE AND id != sqlc.arg(exclude_id)
LIMIT 1;

-- name: DeleteLocation :exec
DELETE FROM locations WHERE id = ?;

-- name: CountLocationUsage :one
SELECT
    (SELECT count(*) FROM locations l WHERE l.parent_id = sqlc.arg(id))
  + (SELECT count(*) FROM stock s WHERE s.location_id = sqlc.arg(id))
  + (SELECT count(*) FROM assets a WHERE a.location_id = sqlc.arg(id));

-- name: ListCategories :many
SELECT * FROM categories ORDER BY name;

-- name: GetCategory :one
SELECT * FROM categories WHERE id = ?;

-- name: CreateCategory :one
INSERT INTO categories (parent_id, name) VALUES (?, ?) RETURNING *;

-- name: UpdateCategory :one
UPDATE categories SET parent_id = ?, name = ?, version = version + 1 WHERE id = ? RETURNING *;

-- name: FindCategoryByName :one
SELECT * FROM categories
WHERE parent_id IS sqlc.narg(parent_id) AND name = sqlc.arg(name) COLLATE NOCASE AND id != sqlc.arg(exclude_id)
LIMIT 1;

-- name: ListCategoryCounts :many
SELECT categories.id,
    CAST((SELECT count(*) FROM items i WHERE i.category_id = categories.id) AS INTEGER) AS item_count
FROM categories;

-- name: DeleteCategory :exec
DELETE FROM categories WHERE id = ?;

-- name: CountCategoryUsage :one
SELECT
    (SELECT count(*) FROM categories c WHERE c.parent_id = sqlc.arg(id))
  + (SELECT count(*) FROM items i WHERE i.category_id = sqlc.arg(id));

-- name: ListItemSummaries :many
SELECT items.*,
    CAST(COALESCE((SELECT sum(s.quantity) FROM stock s
        WHERE s.item_id = items.id AND s.count_state != 'uncounted'), 0) AS REAL) AS total_quantity,
    CAST((SELECT count(*) FROM stock s WHERE s.item_id = items.id AND s.count_state = 'uncounted') AS INTEGER) AS uncounted_lots,
    CAST((SELECT count(*) FROM stock s WHERE s.item_id = items.id AND s.count_state = 'approx') AS INTEGER) AS approx_lots,
    CAST((SELECT count(*) FROM assets a WHERE a.item_id = items.id AND a.status != 'retired') AS INTEGER) AS asset_count,
    CAST((SELECT count(*) FROM assets a WHERE a.item_id = items.id AND a.status = 'available') AS INTEGER) AS available_count,
    CAST(COALESCE((SELECT sum(r.quantity) FROM reservations r
        WHERE r.item_id = items.id AND r.stock_id IS NOT NULL AND r.released_at IS NULL
          AND (r.until IS NULL OR r.until >= date('now'))), 0) AS REAL) AS reserved_quantity,
    CAST((SELECT count(*) FROM reservations r
        WHERE r.item_id = items.id AND r.asset_id IS NOT NULL AND r.released_at IS NULL
          AND (r.until IS NULL OR r.until >= date('now'))) AS INTEGER) AS reserved_assets
FROM items
WHERE (items.name LIKE sqlc.narg(q) OR items.mpn LIKE sqlc.narg(q)
       OR items.manufacturer LIKE sqlc.narg(q) OR items.description LIKE sqlc.narg(q)
       OR items.package LIKE sqlc.narg(q) OR sqlc.narg(q) IS NULL)
  AND (items.kind = sqlc.narg(kind) OR sqlc.narg(kind) IS NULL)
  AND (items.category_id = sqlc.narg(category_id) OR sqlc.narg(category_id) IS NULL)
ORDER BY items.name
LIMIT sqlc.arg(lim);

-- name: GetItem :one
SELECT * FROM items WHERE id = ?;

-- name: FindItemByMPN :one
SELECT * FROM items WHERE mpn = ? AND mpn != '' LIMIT 1;

-- name: FindItemByName :one
SELECT * FROM items WHERE name = ? COLLATE NOCASE AND kind = ? AND package = ? COLLATE NOCASE ORDER BY id LIMIT 1;

-- name: CreateItem :one
INSERT INTO items (
    name, kind, category_id, description, manufacturer, mpn, supplier_url, datasheet_url,
    unit, min_stock, hazard_class, storage_notes, owner_project_id, owner_department_id, package,
    label_text
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;

-- name: UpdateItem :one
UPDATE items SET
    name = ?, kind = ?, category_id = ?, description = ?, manufacturer = ?, mpn = ?,
    supplier_url = ?, datasheet_url = ?, unit = ?, min_stock = ?, hazard_class = ?,
    storage_notes = ?, owner_project_id = ?, owner_department_id = ?, package = ?,
    label_text = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE id = ? RETURNING *;

-- name: SetItemPhoto :exec
UPDATE items SET photo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;

-- name: DeleteItem :exec
DELETE FROM items WHERE id = ?;

-- name: GetStock :one
SELECT * FROM stock WHERE id = ?;

-- name: ListStockByItem :many
SELECT * FROM stock WHERE item_id = ? ORDER BY location_id, id;

-- name: ListStockByLocation :many
SELECT sqlc.embed(stock), items.name AS item_name, items.unit AS item_unit, items.kind AS item_kind,
    items.datasheet_url AS item_datasheet_url, items.package AS item_package,
    CAST(COALESCE((SELECT sum(r.quantity) FROM reservations r
        WHERE r.stock_id = stock.id AND r.released_at IS NULL
          AND (r.until IS NULL OR r.until >= date('now'))), 0) AS REAL) AS reserved
FROM stock JOIN items ON items.id = stock.item_id
WHERE stock.location_id = ?
ORDER BY items.name;

-- name: FindMergeableStock :one
SELECT * FROM stock
WHERE item_id = sqlc.arg(item_id) AND location_id = sqlc.arg(location_id) AND lot = sqlc.arg(lot)
  AND expires_on IS sqlc.narg(expires_on)
  AND owner_project_id IS sqlc.narg(owner_project_id)
  AND owner_department_id IS sqlc.narg(owner_department_id)
  AND id != sqlc.arg(exclude_id)
LIMIT 1;

-- name: CreateStock :one
INSERT INTO stock (item_id, location_id, quantity, lot, expires_on, owner_project_id, owner_department_id, count_state)
VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;

-- name: SetStockCount :exec
UPDATE stock SET quantity = ?, count_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;

-- name: SetStockQuantity :exec
UPDATE stock SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;

-- name: SetStockLocation :exec
UPDATE stock SET location_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;

-- name: UpdateStockDetails :one
UPDATE stock SET lot = ?, expires_on = ?, owner_project_id = ?, owner_department_id = ?,
    version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE id = ? RETURNING *;

-- name: DeleteStock :exec
DELETE FROM stock WHERE id = ?;

-- name: GetAsset :one
SELECT * FROM assets WHERE id = ?;

-- name: ListAssetsByItem :many
SELECT * FROM assets WHERE item_id = ? ORDER BY id;

-- name: ListAssetsByLocation :many
SELECT sqlc.embed(assets), items.name AS item_name, items.kind AS item_kind,
    CAST(EXISTS (SELECT 1 FROM reservations r
        WHERE r.asset_id = assets.id AND r.released_at IS NULL
          AND (r.until IS NULL OR r.until >= date('now'))) AS BOOLEAN) AS reserved
FROM assets JOIN items ON items.id = assets.item_id
WHERE assets.location_id = ?
ORDER BY items.name, assets.id;

-- name: CreateAsset :one
INSERT INTO assets (item_id, serial, location_id, condition, status, notes, owner_project_id, owner_department_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;

-- name: UpdateAsset :one
UPDATE assets SET serial = ?, location_id = ?, condition = ?, status = ?, notes = ?,
    owner_project_id = ?, owner_department_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE id = ? RETURNING *;

-- name: SetAssetState :exec
UPDATE assets SET status = ?, location_id = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?;

-- name: DeleteAsset :exec
DELETE FROM assets WHERE id = ?;

-- name: CreateLoan :one
INSERT INTO loans (asset_id, user_id, project_id, department_id, due_at, note)
VALUES (?, ?, ?, ?, ?, ?) RETURNING *;

-- name: GetOpenLoanForAsset :one
SELECT * FROM loans WHERE asset_id = ? AND returned_at IS NULL;

-- name: CloseLoan :exec
UPDATE loans SET returned_at = CURRENT_TIMESTAMP WHERE id = ?;

-- name: ListOpenLoans :many
SELECT sqlc.embed(loans), users.name AS user_name, users.email AS user_email,
    items.id AS item_id, items.name AS item_name, assets.serial AS asset_serial
FROM loans
JOIN users ON users.id = loans.user_id
JOIN assets ON assets.id = loans.asset_id
JOIN items ON items.id = assets.item_id
WHERE loans.returned_at IS NULL
  AND (loans.user_id = sqlc.narg(user_id) OR sqlc.narg(user_id) IS NULL)
ORDER BY loans.taken_at;

-- name: ListLoansForAsset :many
SELECT sqlc.embed(loans), users.name AS user_name
FROM loans JOIN users ON users.id = loans.user_id
WHERE loans.asset_id = ?
ORDER BY loans.id DESC
LIMIT 20;

-- name: CreateMovement :exec
INSERT INTO movements (
    user_id, kind, item_id, stock_id, asset_id, from_location_id, to_location_id,
    quantity, project_id, department_id, note, reservation_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: ListMovements :many
SELECT sqlc.embed(movements), users.name AS user_name, items.name AS item_name, items.unit AS item_unit
FROM movements
JOIN users ON users.id = movements.user_id
JOIN items ON items.id = movements.item_id
WHERE (movements.item_id = sqlc.narg(item_id) OR sqlc.narg(item_id) IS NULL)
  AND (movements.asset_id = sqlc.narg(asset_id) OR sqlc.narg(asset_id) IS NULL)
  AND (movements.stock_id = sqlc.narg(stock_id) OR sqlc.narg(stock_id) IS NULL)
  AND (movements.user_id = sqlc.narg(user_id) OR sqlc.narg(user_id) IS NULL)
ORDER BY movements.id DESC
LIMIT sqlc.arg(lim);

-- name: CreatePrintJob :one
INSERT INTO print_jobs (user_id, code, symbology, caption) VALUES (?, ?, ?, ?) RETURNING *;

-- name: ListPrintJobs :many
SELECT * FROM print_jobs ORDER BY id DESC LIMIT ?;

-- name: ListQueuedPrintJobs :many
SELECT * FROM print_jobs WHERE status = 'queued' ORDER BY id LIMIT ?;

-- name: ListWaitingPrintJobs :many
-- The queue: labels not printed yet, and failed ones that need a decision.
SELECT * FROM print_jobs WHERE status IN ('queued', 'printing', 'failed') ORDER BY id;

-- name: CancelPrintJobs :execrows
UPDATE print_jobs SET status = 'cancelled', error = ''
WHERE status IN ('queued', 'failed') AND id IN (sqlc.slice(ids));

-- name: CancelAllPrintJobs :execrows
UPDATE print_jobs SET status = 'cancelled', error = '' WHERE status IN ('queued', 'failed');

-- name: GetPrintJob :one
SELECT * FROM print_jobs WHERE id = ?;

-- name: SetPrintJobStatus :exec
UPDATE print_jobs SET
    status = sqlc.arg(status),
    error = sqlc.arg(error),
    attempts = attempts + sqlc.arg(attempt_inc),
    printed_at = CASE WHEN sqlc.arg(status) = 'done' THEN CURRENT_TIMESTAMP ELSE printed_at END
WHERE id = sqlc.arg(id);

-- name: ClaimPrintJob :execrows
UPDATE print_jobs SET status = 'printing' WHERE id = ? AND status = 'queued';

-- name: ChangePrintJobStatus :execrows
-- Moves a job to status only if it is still in one of the states from.
UPDATE print_jobs SET status = sqlc.arg(status), error = ''
WHERE id = sqlc.arg(id) AND status IN (sqlc.slice(from_status));

-- name: RequeueInterruptedPrintJobs :exec
UPDATE print_jobs SET status = 'queued' WHERE status = 'printing';

-- name: ListLocationCounts :many
SELECT locations.id,
    CAST((SELECT count(*) FROM stock s WHERE s.location_id = locations.id) AS INTEGER) AS stock_count,
    CAST((SELECT count(*) FROM assets a WHERE a.location_id = locations.id) AS INTEGER) AS asset_count
FROM locations;

-- name: ListDonePrintJobs :many
SELECT * FROM print_jobs WHERE status = 'done' ORDER BY printed_at, id;

-- name: CountTapeRolls :one
SELECT count(*) FROM tape_rolls;

-- name: GetCurrentTapeRoll :one
SELECT * FROM tape_rolls WHERE width_mm = ? AND replaced_at IS NULL ORDER BY id DESC LIMIT 1;

-- name: CreateTapeRoll :one
INSERT INTO tape_rolls (width_mm, length_mm, used_dots) VALUES (?, ?, ?) RETURNING *;

-- name: ReplaceTapeRolls :exec
UPDATE tape_rolls SET replaced_at = CURRENT_TIMESTAMP WHERE width_mm = ? AND replaced_at IS NULL;

-- name: AddTapeUsed :exec
UPDATE tape_rolls SET used_dots = used_dots + sqlc.arg(dots) WHERE id = sqlc.arg(id);

-- name: GetSetting :one
SELECT value FROM settings WHERE key = ?;

-- name: SetSetting :exec
INSERT INTO settings (key, value) VALUES (?, ?)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- name: CountQueuedPrintJobs :one
SELECT count(*) FROM print_jobs WHERE status = 'queued';
