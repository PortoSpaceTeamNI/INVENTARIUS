-- +goose Up
-- Small app-wide settings changed from the UI, e.g. print_hold.
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- +goose Down
DROP TABLE settings;
