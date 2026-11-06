GO ?= $(shell command -v go || echo /usr/local/go/bin/go)
SQLC ?= $(shell command -v sqlc || echo $(HOME)/go/bin/sqlc)

.PHONY: dev backend frontend test lint generate build docker up down clean

# Backend (dev login, labels saved as PNGs in backend/data/labels) and the
# Vite dev server on http://localhost:3000. Ctrl+C stops both.
dev:
	@trap 'kill 0' INT TERM; \
	$(MAKE) backend & \
	$(MAKE) frontend & \
	wait

backend:
	cd backend && INVENTARIUS_DEV_AUTH=1 INVENTARIUS_DATA_DIR=./data \
		INVENTARIUS_PRINTER=$${INVENTARIUS_PRINTER:-file:./data/labels} \
		INVENTARIUS_BASE_URL=http://localhost:3000 $(GO) run ./cmd/server

frontend:
	cd frontend && npm run dev

test:
	cd backend && $(GO) test ./...
	cd frontend && npm test

lint:
	cd backend && $(GO) vet ./... && test -z "$$(gofmt -l .)"
	cd frontend && npm run lint && npx tsc -b

# Regenerate Go code from backend/internal/db/{migrations,queries}.
generate:
	cd backend && $(SQLC) generate

# Single binary with the frontend embedded: backend/bin/inventarius
build:
	cd frontend && npm run build
	rm -rf backend/internal/web/dist && cp -r frontend/dist backend/internal/web/dist
	touch backend/internal/web/dist/.gitkeep
	cd backend && CGO_ENABLED=0 $(GO) build -trimpath -o bin/inventarius ./cmd/server

docker:
	docker build -t inventarius .

up:
	cd deploy && (docker compose up -d --build || \
		(echo "Could not build (no internet?): starting the image already built."; docker compose up -d))

down:
	cd deploy && docker compose down

clean:
	rm -rf backend/bin frontend/dist
	find backend/internal/web/dist -mindepth 1 ! -name .gitkeep -delete
