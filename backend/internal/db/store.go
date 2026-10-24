// Package db holds the SQLite schema, the sqlc-generated queries (*_sqlc.go)
// and the Store that wraps them with migrations and transactions.
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"net/url"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct {
	DB *sql.DB
	*Queries
}

// Open opens (creating if needed) the SQLite database at path and applies
// pending migrations. Use ":memory:" for tests.
func Open(ctx context.Context, path string) (*Store, error) {
	q := url.Values{}
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "synchronous(NORMAL)")
	// Write transactions take the lock up front, so two concurrent writers wait
	// on busy_timeout instead of failing with SQLITE_BUSY on lock upgrade.
	q.Set("_txlock", "immediate")
	q.Set("_time_format", "sqlite")
	dsn := "file:" + path + "?" + q.Encode()

	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if path == ":memory:" {
		// Every connection to :memory: is a separate database.
		sqlDB.SetMaxOpenConns(1)
	}
	if err := migrate(ctx, sqlDB); err != nil {
		sqlDB.Close()
		return nil, err
	}
	return &Store{DB: sqlDB, Queries: New(sqlDB)}, nil
}

func migrate(ctx context.Context, sqlDB *sql.DB) error {
	sub, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	p, err := goose.NewProvider(goose.DialectSQLite3, sqlDB, sub)
	if err != nil {
		return err
	}
	if _, err := p.Up(ctx); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}

type txKey struct{}

// Tx runs fn inside a transaction, committing if it returns nil. Inside a
// TxContext it joins that outer transaction instead of starting its own.
func (s *Store) Tx(ctx context.Context, fn func(q *Queries) error) error {
	if q, ok := ctx.Value(txKey{}).(*Queries); ok {
		return fn(q)
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(s.Queries.WithTx(tx)); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// TxContext is Tx for work spanning several operations (an import): every
// Tx run with the ctx passed to fn is part of the same transaction, so all
// of it is saved or none of it.
func (s *Store) TxContext(ctx context.Context, fn func(ctx context.Context, q *Queries) error) error {
	return s.Tx(ctx, func(q *Queries) error {
		return fn(context.WithValue(ctx, txKey{}, q), q)
	})
}

func (s *Store) Close() error { return s.DB.Close() }
