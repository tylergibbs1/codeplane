# CodePlane

A transactional code coordination layer for AI agents.

Git was built for humans working asynchronously over days — it breaks when 10–1000 AI agents write code concurrently. CodePlane sits in front of git as a real-time working-state system with file versioning, leases, and atomic changesets.

## Quick Start

### 1. Start the server

```bash
git clone https://github.com/tylergibbs1/codeplane.git
cd codeplane
bun run dev
```

One command handles everything — installs dependencies, starts PostgreSQL (via Docker), generates API keys, pushes the database schema, and starts the server with hot reload.

> **Prerequisites:** [Bun](https://bun.sh/) and [Docker](https://www.docker.com/) or [OrbStack](https://orbstack.dev/)

Your API key is printed in the terminal and saved in `.env`.

### 2. Connect Claude Code

```bash
claude mcp add codeplane \
  -e CODEPLANE_API_KEY=$(grep API_KEY .env | cut -d= -f2) \
  -- bun run $(pwd)/packages/mcp/src/index.ts
```

That's it. Claude Code now has coordinated file operations — version-safe writes, file leases, and atomic multi-file commits.

### 3. Use it

Ask Claude Code to use CodePlane tools:

```
> Use codeplane to write src/index.ts with "export const hello = 'world';"
> Use codeplane to atomically update both src/api.ts and src/types.ts
> Use codeplane to lease src/auth.ts while refactoring the auth flow
```

Or for team-wide setup, drop a `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "codeplane": {
      "command": "bun",
      "args": ["run", "/path/to/codeplane/packages/mcp/src/index.ts"],
      "env": {
        "CODEPLANE_API_KEY": "your-key",
        "CODEPLANE_URL": "http://localhost:3100"
      }
    }
  }
}
```

## What It Does

Three primitives that git doesn't have:

**1. Optimistic Concurrency Control** — Every file has a version. Updates require `expectedVersion`. Stale writes get `409 Conflict`. No more lost writes.

**2. File Leases** — Advisory locks with TTL. Agent A locks a file while refactoring it. Agent B gets `423 Locked` until A is done or the lease expires.

**3. Atomic Changesets** — Stage multiple files, submit atomically. All succeed or all fail. No more half-applied changes across files.

## Tools

Claude Code agents get 7 tools via the MCP server:

| Tool | Purpose |
|------|---------|
| `codeplane_read` | Read a file (content + version) |
| `codeplane_write` | Write/create with version safety |
| `codeplane_list` | List files by prefix |
| `codeplane_delete` | Delete with version check |
| `codeplane_lease` | Acquire, release, or check file locks |
| `codeplane_atomic_write` | Write multiple files atomically in one call |
| `codeplane_changeset` | Fine-grained multi-file staging and commit |

## SDK

For building your own agents or integrations:

```bash
npm install @codeplane/sdk
```

```ts
import { CodePlaneClient } from "@codeplane/sdk";

const cp = new CodePlaneClient({ agentId: "my-agent" });

// Write a file
await cp.files.write("src/index.ts", "export const x = 1;");

// Update with OCC retry (read → transform → write, retries on conflict)
await cp.files.update("src/index.ts", (file) =>
  file.content.replace("const x = 1", "const x = 2")
);

// Lock a file while working on it
await cp.leases.withLease("src/auth.ts", async () => {
  await cp.files.update("src/auth.ts", (f) => f.content + "\n// updated");
});

// Atomic multi-file change
const cs = await cp.changesets.create("Rename function");
await cp.changesets.addFile(cs.id, "lib/math.ts", newContent, "update");
await cp.changesets.addFile(cs.id, "app/main.ts", newContent, "update");
await cp.changesets.submit(cs.id);
```

## API

All endpoints require `Authorization: Bearer <API_KEY>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/files` | List files (`?prefix=src/`) |
| `GET` | `/api/v1/files/:path` | Read a file |
| `PUT` | `/api/v1/files/:path` | Write a file (`expectedVersion` for OCC) |
| `DELETE` | `/api/v1/files/:path` | Delete a file |
| `POST` | `/api/v1/leases` | Acquire a lease |
| `DELETE` | `/api/v1/leases/:id` | Release a lease |
| `PUT` | `/api/v1/leases/:id/renew` | Renew a lease |
| `GET` | `/api/v1/leases` | List active leases |
| `POST` | `/api/v1/changesets` | Create a changeset |
| `GET` | `/api/v1/changesets/:id` | Get changeset details |
| `PUT` | `/api/v1/changesets/:id/files/:path` | Stage a file |
| `POST` | `/api/v1/changesets/:id/submit` | Submit atomically |

## Architecture

```
Agents → CodePlane (HTTP API) → PostgreSQL (source of truth)
```

The database is the source of truth. Every file write is version-checked. Every changeset uses `SELECT ... FOR UPDATE` row-level locks. No git, no file system races, no merge conflicts.

## Project Structure

```
packages/
├── server/    # Hono API server + PostgreSQL
├── sdk/       # TypeScript SDK
└── mcp/       # MCP server for Claude Code
```

## License

MIT
