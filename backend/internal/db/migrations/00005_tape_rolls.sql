-- +goose Up
-- Tape cassettes, to estimate how much tape is left. The printer cannot tell
-- (TZe cassettes have no sensor), so the print queue adds up the tape every
-- job uses. Each width has one cassette in use: the latest not replaced.
CREATE TABLE tape_rolls (
    id          INTEGER PRIMARY KEY,
    width_mm    INTEGER NOT NULL,
    length_mm   INTEGER NOT NULL,
    used_dots   INTEGER NOT NULL DEFAULT 0, -- at 180 dpi
    loaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    replaced_at DATETIME
);
CREATE INDEX tape_rolls_width ON tape_rolls(width_mm, replaced_at);

-- +goose Down
DROP TABLE tape_rolls;
