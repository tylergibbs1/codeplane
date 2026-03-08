# CodePlane

A transactional code coordination layer for AI agents.

Git was built for humans working asynchronously over days — it breaks when 10–1000 AI agents write code concurrently. CodePlane sits in front of git as a real-time working-state system with file versioning, leases, atomic changesets, validation, and event streaming.

## Features

- **Optimistic Concurrency Control** — Version-gated file writes. Every update requires `expectedVersion`, stale writes return `409 Conflict`.
- **File Leases** — Advisory exclusive locks with TTL. Agents acquire leases to prevent other agents from writing to files they're working on (`423 Locked`).
- **Atomic Changesets** — Multi-file commits using PostgreSQL row-level locks. Stage files, submit atomically — all succeed or all fail.
- **Validation Pipeline** — Path traversal checks, JSON parsing, TypeScript/JavaScript syntax validation via Bun transpiler.
- **Git Materialization** — Committed changesets become git commits via isomorphic-git, with serialized queue to prevent race conditions.
- **File History** — Every version of every file is tracked. Query history and retrieve any previous version.
- **Event Streaming** — Real-time WebSocket pub/sub with wildcard pattern matching (`file.*`, `lease.*`, `changeset.*`).
- **Rate Limiting** — Per-agent rate limiting (100 req/min) with standard `X-RateLimit-*` headers.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Agent A    │     │   Agent B    │     │   Agent C    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────┬───────┴────────────────────┘
                    │
              ┌─────▼─────┐
              │ CodePlane  │  ← HTTP API + WebSocket
              │   Server   │
              └─────┬──────┘
                    │
         ┌──────────┼──────────┐
         │          │          │
    ┌────▼───┐ ┌────▼───┐ ┌───▼────┐
    │Postgres│ │  Git   │ │ Events │
    │ (SoT)  │ │ Repo   │ │  Bus   │
    └────────┘ └────────┘ └────────┘
```

The database is the source of truth. Git is derived. Events are in-process for the MVP.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Docker](https://www.docker.com/) or [OrbStack](https://orbstack.dev/) (for PostgreSQL)

### Setup

```bash
# Clone and install
git clone https://github.com/tylergibbs1/codeplane.git
cd codeplane
bun install

# Start PostgreSQL
docker compose up -d

# Configure environment
cp .env.example .env

# Push database schema
bun run db:push

# Start the server
bun run dev
```

The server starts at `http://localhost:3100`. Verify with:

```bash
curl http://localhost:3100/health
```

## API Reference

All endpoints require `Authorization: Bearer <API_KEY>` header. Use `X-Agent-Id` header to identify different agents.

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/files` | List all files (optional `?prefix=src/`) |
| `GET` | `/api/v1/files/:path` | Read a file |
| `GET` | `/api/v1/files/:path?history=true` | Get file version history |
| `GET` | `/api/v1/files/:path?version=N` | Get specific version |
| `PUT` | `/api/v1/files/:path` | Create or update a file |
| `DELETE` | `/api/v1/files/:path` | Delete a file |

**Write a file:**

```bash
# Create
curl -X PUT http://localhost:3100/api/v1/files/src/index.ts \
  -H "Authorization: Bearer dev-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"content": "export const hello = \"world\";"}'

# Update (requires current version for OCC)
curl -X PUT http://localhost:3100/api/v1/files/src/index.ts \
  -H "Authorization: Bearer dev-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"content": "export const hello = \"updated\";", "expectedVersion": 1}'
```

### Leases

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/leases` | Acquire a lease |
| `DELETE` | `/api/v1/leases/:id` | Release a lease |
| `PUT` | `/api/v1/leases/:id/renew` | Renew a lease |
| `GET` | `/api/v1/leases` | List active leases |

```bash
# Acquire a lease (default 5 min TTL)
curl -X POST http://localhost:3100/api/v1/leases \
  -H "Authorization: Bearer dev-key-change-me" \
  -H "X-Agent-Id: agent-a" \
  -H "Content-Type: application/json" \
  -d '{"filePath": "src/index.ts", "intent": "refactoring auth module"}'
```

### Changesets

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/changesets` | Create a changeset |
| `GET` | `/api/v1/changesets` | List changesets (optional `?status=committed`) |
| `GET` | `/api/v1/changesets/:id` | Get changeset details |
| `PUT` | `/api/v1/changesets/:id/files/:path` | Stage a file |
| `DELETE` | `/api/v1/changesets/:id/files/:path` | Unstage a file |
| `POST` | `/api/v1/changesets/:id/submit` | Submit for validation + atomic commit |

```bash
# Create a changeset
CS=$(curl -s -X POST http://localhost:3100/api/v1/changesets \
  -H "Authorization: Bearer dev-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"message": "Add new feature"}' | jq -r '.id')

# Stage files
curl -X PUT "http://localhost:3100/api/v1/changesets/$CS/files/src/feature.ts" \
  -H "Authorization: Bearer dev-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"content": "export function feature() {}", "operation": "create"}'

# Submit atomically
curl -X POST "http://localhost:3100/api/v1/changesets/$CS/submit" \
  -H "Authorization: Bearer dev-key-change-me"
```

### WebSocket Events

Connect to `ws://localhost:3100/api/v1/subscribe` for real-time events.

```json
// Subscribe to file events
{"action": "subscribe", "types": ["file.*"]}

// Subscribe to everything
{"action": "subscribe", "types": ["*"]}
```

Event types: `file.created`, `file.updated`, `file.deleted`, `lease.acquired`, `lease.released`, `lease.expired`, `changeset.committed`

## Project Structure

```
codeplane/
├── packages/
│   ├── server/          # Hono API server
│   │   └── src/
│   │       ├── db/          # Drizzle schema + connection
│   │       ├── middleware/   # Auth, lease check, rate limit, error handler
│   │       ├── routes/       # Files, leases, changesets, WebSocket
│   │       ├── services/     # File store, lease manager, changeset engine,
│   │       │                 # event bus, git materializer, validation pipeline
│   │       └── jobs/         # Lease expiry background job
│   ├── sdk/             # TypeScript SDK (@codeplane/sdk)
│   └── cli/             # CLI tool (@codeplane/cli)
├── agent-tester.ts      # Autonomous AI QA agent (Claude Sonnet)
├── test-simulation.ts   # Multi-agent integration tests
├── docker-compose.yml   # PostgreSQL
└── .env.example
```

## Testing

```bash
# Unit tests (33 tests)
bun test

# Integration test (34 multi-agent simulation tests)
bun run test-simulation.ts

# AI QA agent (requires ANTHROPIC_API_KEY)
bun run agent-tester.ts
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Framework**: [Hono](https://hono.dev/)
- **Database**: PostgreSQL 16 + [Drizzle ORM](https://orm.drizzle.team/)
- **Git**: [isomorphic-git](https://isomorphic-git.org/)
- **Validation**: [Zod](https://zod.dev/) + Bun Transpiler

## License

MIT
