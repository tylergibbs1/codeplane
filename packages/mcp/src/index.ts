#!/usr/bin/env bun
/**
 * CodePlane MCP Server
 *
 * Exposes CodePlane's coordination primitives as MCP tools
 * for Claude Code and other MCP-compatible clients.
 *
 *   claude mcp add codeplane -- bun run packages/mcp/src/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CodePlaneClient, ConflictError, LeaseConflictError, NotFoundError } from "@codeplane/sdk";
import { z } from "zod";

const client = new CodePlaneClient({
  agentId: process.env.CODEPLANE_AGENT_ID || "claude-code",
});

const server = new McpServer({
  name: "codeplane",
  version: "0.1.0",
});

// ─── Helpers ─────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** Format error with actionable guidance */
function formatError(err: unknown, context: string): ReturnType<typeof fail> {
  if (err instanceof ConflictError) {
    return fail(
      `Version conflict on ${context}. The file was modified by another agent since you last read it. ` +
      `Re-read the file with codeplane_read to get the current version, then retry your write with the updated expectedVersion.`
    );
  }
  if (err instanceof LeaseConflictError) {
    return fail(
      `File ${context} is locked by another agent. ` +
      `Either wait for the lease to expire, or coordinate with the other agent. ` +
      `Use codeplane_lease with action "check" to see who holds the lease and when it expires.`
    );
  }
  if (err instanceof NotFoundError) {
    return fail(
      `${context} not found. Use codeplane_list to see available files, or codeplane_write to create a new file.`
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return fail(`Error: ${msg}`);
}

/** Return only fields an agent needs for decision-making */
function fileResult(file: { path: string; content: string; version: number; lastModifiedBy: string | null }) {
  return ok(
    `path: ${file.path}\n` +
    `version: ${file.version}\n` +
    `lastModifiedBy: ${file.lastModifiedBy || "unknown"}\n` +
    `---\n` +
    file.content
  );
}

// ─── File Tools ──────────────────────────────────────────────────────

server.tool(
  "codeplane_read",
  `Read a file from the shared CodePlane workspace. Returns the file content, its current version number, and who last modified it.

You need the version number to safely update the file later — pass it as expectedVersion to codeplane_write.

Example: Read "src/index.ts" to get its content and version before editing.`,
  { path: z.string().describe("File path relative to project root, e.g. src/index.ts") },
  async ({ path }) => {
    try {
      const file = await client.files.get(path);
      return fileResult(file);
    } catch (err) {
      return formatError(err, path);
    }
  }
);

server.tool(
  "codeplane_write",
  `Write or create a file in the shared CodePlane workspace.

To CREATE a new file: omit expectedVersion.
To UPDATE an existing file: pass expectedVersion (from codeplane_read) to prevent overwriting another agent's changes. If the version doesn't match, you'll get a conflict error — re-read and retry.

Returns the file's new version number.

Example — create: codeplane_write("src/new.ts", "export const x = 1;")
Example — update: codeplane_write("src/index.ts", "updated content", expectedVersion: 3)`,
  {
    path: z.string().describe("File path relative to project root, e.g. src/index.ts"),
    content: z.string().describe("Full file content to write"),
    expectedVersion: z
      .number()
      .optional()
      .describe("Pass the version from codeplane_read to safely update. Omit to create a new file."),
  },
  async ({ path, content, expectedVersion }) => {
    try {
      const file = await client.files.write(path, content, expectedVersion);
      return fileResult(file);
    } catch (err) {
      return formatError(err, path);
    }
  }
);

server.tool(
  "codeplane_list",
  `List files in the shared CodePlane workspace. Returns file paths and versions (not content — use codeplane_read for content).

Use the prefix parameter to filter by directory, e.g. prefix "src/components/" to list only components.

Returns one file per line: "path (v{version}, by {agent})"`,
  {
    prefix: z
      .string()
      .optional()
      .describe("Path prefix filter, e.g. src/ or lib/utils/"),
  },
  async ({ prefix }) => {
    try {
      const files = await client.files.list(prefix);
      if (files.length === 0) {
        return ok(prefix ? `No files found with prefix "${prefix}".` : "No files in workspace.");
      }
      const lines = files.map(
        (f) => `${f.path} (v${f.version}, by ${f.lastModifiedBy || "unknown"})`
      );
      return ok(`${files.length} file(s):\n${lines.join("\n")}`);
    } catch (err) {
      return formatError(err, "listing");
    }
  }
);

server.tool(
  "codeplane_delete",
  `Delete a file from the shared CodePlane workspace. Requires the current version number (from codeplane_read) to prevent accidentally deleting a file another agent just modified.

Example: Read the file first to get version, then delete with that version.`,
  {
    path: z.string().describe("File path to delete"),
    expectedVersion: z.number().describe("Current version from codeplane_read — ensures you're deleting the version you expect"),
  },
  async ({ path, expectedVersion }) => {
    try {
      await client.files.delete(path, expectedVersion);
      return ok(`Deleted ${path}.`);
    } catch (err) {
      return formatError(err, path);
    }
  }
);

// ─── Lease Tool (consolidated) ───────────────────────────────────────

server.tool(
  "codeplane_lease",
  `Manage exclusive file leases. Use leases when you need to make multiple related changes to a file without another agent interfering.

Actions:
- "acquire": Lock a file. Other agents get blocked until you release it or the TTL expires (default 5 min).
- "release": Unlock a file when you're done.
- "check": See if a file is currently locked, by whom, and when the lease expires.

You don't need leases for simple read/write — they're for multi-step workflows where you need exclusive access.

Example workflow:
1. codeplane_lease(action: "acquire", filePath: "src/auth.ts", intent: "refactoring auth flow")
2. codeplane_read("src/auth.ts") → make changes → codeplane_write(...)
3. codeplane_lease(action: "release", leaseId: "...from step 1...")`,
  {
    action: z.enum(["acquire", "release", "check"]).describe("acquire, release, or check"),
    filePath: z.string().optional().describe("File path (required for acquire and check)"),
    leaseId: z.string().optional().describe("Lease ID from acquire response (required for release)"),
    ttlSeconds: z.number().optional().describe("Lock duration in seconds (default 300). The lease auto-expires after this."),
    intent: z.string().optional().describe("Brief description of why you're locking this file"),
  },
  async ({ action, filePath, leaseId, ttlSeconds, intent }) => {
    try {
      switch (action) {
        case "acquire": {
          if (!filePath) return fail("filePath is required for acquire.");
          const lease = await client.leases.acquire(filePath, { ttlSeconds, intent });
          return ok(
            `Lease acquired on ${filePath}.\n` +
            `leaseId: ${lease.id}\n` +
            `expiresAt: ${lease.expiresAt}\n\n` +
            `Remember to release this lease when done: codeplane_lease(action: "release", leaseId: "${lease.id}")`
          );
        }
        case "release": {
          if (!leaseId) return fail("leaseId is required for release. Use the ID returned from acquire.");
          await client.leases.release(leaseId);
          return ok(`Lease ${leaseId} released.`);
        }
        case "check": {
          if (!filePath) return fail("filePath is required for check.");
          const lease = await client.leases.check(filePath);
          if (!lease) return ok(`No active lease on ${filePath}. It's free to edit.`);
          return ok(
            `${filePath} is locked.\n` +
            `heldBy: ${lease.agentId}\n` +
            `intent: ${lease.intent || "not specified"}\n` +
            `expiresAt: ${lease.expiresAt}\n` +
            `leaseId: ${lease.id}`
          );
        }
      }
    } catch (err) {
      return formatError(err, filePath || leaseId || "lease");
    }
  }
);

// ─── Changeset Tools ─────────────────────────────────────────────────

server.tool(
  "codeplane_atomic_write",
  `Write multiple files atomically — all succeed or all fail. Use this when you need to change several files that depend on each other (e.g., renaming a function across files, updating an interface and its implementations).

Each file in the "files" array needs a path, content, and operation (create/update/delete).

This is a high-level tool that creates a changeset, stages all files, and submits in one call. For more control over staging, use codeplane_changeset instead.

Example: Rename a function across two files:
  codeplane_atomic_write(
    message: "Rename getUserById to findUser",
    files: [
      { path: "src/users.ts", content: "...", operation: "update" },
      { path: "src/api.ts", content: "...", operation: "update" }
    ]
  )`,
  {
    message: z.string().optional().describe("Description of the change"),
    files: z.array(z.object({
      path: z.string().describe("File path"),
      content: z.string().describe("Full file content"),
      operation: z.enum(["create", "update", "delete"]).default("update").describe("create, update, or delete"),
    })).min(1).describe("Files to write atomically"),
  },
  async ({ message, files }) => {
    try {
      const cs = await client.changesets.create(message);
      for (const file of files) {
        await client.changesets.addFile(cs.id, file.path, file.content, file.operation);
      }
      const result = await client.changesets.submit(cs.id);
      const paths = files.map((f) => `  ${f.operation}: ${f.path}`).join("\n");
      return ok(
        `Atomic write committed (${files.length} file(s)):\n${paths}\n\n` +
        `changesetId: ${result.id}`
      );
    } catch (err) {
      return formatError(err, files.map((f) => f.path).join(", "));
    }
  }
);

server.tool(
  "codeplane_changeset",
  `Manage changesets for fine-grained control over atomic multi-file operations. For most cases, prefer codeplane_atomic_write — it's simpler.

Use this tool when you need to stage files incrementally (e.g., reading other files to decide what to stage next).

Actions:
- "create": Start a new changeset. Returns a changeset ID.
- "add_file": Stage a file in an open changeset.
- "submit": Commit all staged files atomically.
- "get": View changeset details and staged files.

Example workflow:
1. codeplane_changeset(action: "create", message: "Update configs")
2. codeplane_changeset(action: "add_file", changesetId: "...", filePath: "config.json", content: "...")
3. codeplane_changeset(action: "add_file", changesetId: "...", filePath: "settings.json", content: "...")
4. codeplane_changeset(action: "submit", changesetId: "...")`,
  {
    action: z.enum(["create", "add_file", "submit", "get"]).describe("create, add_file, submit, or get"),
    changesetId: z.string().optional().describe("Changeset ID (required for add_file, submit, get)"),
    message: z.string().optional().describe("Commit message (for create)"),
    filePath: z.string().optional().describe("File path (for add_file)"),
    content: z.string().optional().describe("File content (for add_file)"),
    operation: z.enum(["create", "update", "delete"]).optional().describe("File operation (for add_file, default: update)"),
  },
  async ({ action, changesetId, message, filePath, content, operation }) => {
    try {
      switch (action) {
        case "create": {
          const cs = await client.changesets.create(message);
          return ok(
            `Changeset created.\n` +
            `changesetId: ${cs.id}\n\n` +
            `Next: add files with codeplane_changeset(action: "add_file", changesetId: "${cs.id}", ...)`
          );
        }
        case "add_file": {
          if (!changesetId) return fail("changesetId is required. Use the ID from create.");
          if (!filePath) return fail("filePath is required.");
          if (content === undefined) return fail("content is required.");
          await client.changesets.addFile(changesetId, filePath, content, operation);
          return ok(`Staged ${filePath} in changeset ${changesetId}.`);
        }
        case "submit": {
          if (!changesetId) return fail("changesetId is required.");
          const result = await client.changesets.submit(changesetId);
          return ok(`Changeset ${changesetId} committed successfully.`);
        }
        case "get": {
          if (!changesetId) return fail("changesetId is required.");
          const cs = await client.changesets.get(changesetId);
          const fileList = cs.files?.map(
            (f) => `  ${f.operation}: ${f.filePath}`
          ).join("\n") || "  (no files staged)";
          return ok(
            `Changeset ${cs.id}\n` +
            `status: ${cs.status}\n` +
            `message: ${cs.message || "(none)"}\n` +
            `files:\n${fileList}`
          );
        }
      }
    } catch (err) {
      return formatError(err, changesetId || "changeset");
    }
  }
);

// ─── Start ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
