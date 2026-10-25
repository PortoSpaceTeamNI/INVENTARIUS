# INVENTARIUS

Inventory for the Porto Space Team room: **what we have, where it is, and who has it.**

- Parts and materials, counted per place: take, put back, move, count, write off.
- Shared tools and hardware, tracked one by one: borrow and return, and a "who has what" board.
- Reservations: set parts or tools aside for something, so everyone sees what is free to use.
- Every change is logged with who did it and for which project/department (INVICTUS, ICARUS).
- Labels print on the Brother PT-E550W (12 or 24 mm tape): new places automatically, stock and units when asked for. Scanning a label opens its page.
- Google sign-in for `@portospaceteam.pt` accounts.

Stack: Go + SQLite backend, React + TypeScript (Vite) frontend, the same toolchain as ARX.
Everything ships as one binary/container.

## Develop

Needs Go 1.27+, Node 22 and (only to change queries) [sqlc](https://sqlc.dev).

```sh
cd frontend && npm ci && cd ..
make dev        # backend on :8080 + Vite on http://localhost:3000
```

`make dev` uses the password-less **development login**. Labels are written as PNGs to
`backend/data/labels/` instead of being printed. To print on a real printer, run
`INVENTARIUS_PRINTER=/dev/usb/lp0 make dev`.

To test the scanner on a phone, the page must be served over HTTPS (browsers only allow the
camera there). A temporary tunnel does this:
`cloudflared tunnel --url http://localhost:3000`.

```sh
make test       # Go + Vitest
make lint       # go vet, gofmt, Biome, tsc
make generate   # after editing backend/internal/db/{migrations,queries}/*.sql
make build      # backend/bin/inventarius with the frontend embedded
```

## Layout

```
backend/
  cmd/server/            entry point
  internal/db/           schema (migrations/), SQL (queries/), sqlc-generated code
  internal/inventory/    stock and loan operations; each also writes the audit log
  internal/api/          HTTP API, permissions, CSV import, label endpoints
  internal/auth/         Google sign-in, sessions, dev login
  internal/labels/       label rendering (Data Matrix / QR / Code128) for 12 or 24 mm tape
  internal/ptouch/       Brother P-touch raster protocol over USB
  internal/printqueue/   batches label jobs and sends them to the printer
frontend/src/            pages/, components/, api.ts (types mirror the Go JSON)
deploy/                  docker compose for the room PC (app, backups, tunnel)
docs/                    deploy.md, printer.md, backup.md, Brother raster reference
```

## Concepts

| Thing | Label | What it is |
|---|---|---|
| Location | `L12` | Room › cabinet › shelf › bin; a tree of any depth |
| Item | `I5` | A kind of thing: "BMP390 breakout", "Multimeter" |
| Stock | `S40` | A quantity of a consumable/hazmat item in one location (optionally lot + expiry) |
| Asset | `A7` | One physical tool or flight-hardware unit, borrowable |

**Ownership:** an item, stock lot or asset belongs to the whole team (default), a project, or a
department. Anyone can take, return, move or borrow anything, because the log should record what
actually happened. Editing, counting and writing off are limited to the owners:
- team-owned things: anyone
- project-owned things: members of any department of that project
- department-owned things: members of that department
- anything: admins

People choose their own departments on their profile page.

**Reservations** say "this is already meant for something". Part of a stock lot, or a whole
tool, can be reserved for a project/department with a note (what it is for) and an optional
end date. Pages show how much is **free to use**. Taking more than is free, or borrowing a tool
reserved by another department, asks for confirmation; the override is recorded in the
history. Taking *from* a reservation uses it up. A reservation can be released by the person
who made it, its department/project, or an admin.

Each item can have a **datasheet link**, shown on the item page, on the pages a scanned label
opens, and on location pages.

## Deploy

See [docs/deploy.md](docs/deploy.md). Printer setup: [docs/printer.md](docs/printer.md).
Backups: [docs/backup.md](docs/backup.md).
