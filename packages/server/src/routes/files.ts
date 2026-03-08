import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { fileStore } from "../services/file-store";
import { eventBus } from "../services/event-bus";
import { leaseCheck } from "../middleware/lease-check";
import { NotFoundError, ValidationError } from "../errors";
import { validateSingleFile } from "../services/validation-pipeline";

const files = new Hono<Env>();

// List files
files.get("/", async (c) => {
  const prefix = c.req.query("prefix");
  const result = await fileStore.listFiles(prefix);
  return c.json(result);
});

// Write file (lease-checked)
files.put("/*", leaseCheck, async (c) => {
  const path = c.req.path.replace(/^\/api\/v1\/files\//, "");
  if (!path) {
    throw new ValidationError("File path is required");
  }

  const body = await c.req.json();
  const schema = z.object({
    content: z.string(),
    expectedVersion: z.number().int().positive().optional(),
  });
  const parsed = schema.parse(body);

  // Validate path + syntax before writing
  const validation = validateSingleFile(path, parsed.content);
  if (!validation.valid) {
    throw new ValidationError("Validation failed", validation.errors);
  }

  const agentId = c.get("agentId");
  const file = await fileStore.writeFile(
    path,
    parsed.content,
    agentId,
    parsed.expectedVersion
  );

  eventBus.publish({
    type: file.version === 1 ? "file.created" : "file.updated",
    data: { path, version: file.version, agentId },
  });

  c.header("X-File-Version", String(file.version));
  return c.json(file, file.version === 1 ? 201 : 200);
});

// Delete file (lease-checked)
files.delete("/*", leaseCheck, async (c) => {
  const path = c.req.path.replace(/^\/api\/v1\/files\//, "");
  if (!path) {
    throw new ValidationError("File path is required");
  }

  const body = await c.req.json();
  const schema = z.object({
    expectedVersion: z.number().int().positive(),
  });
  const parsed = schema.parse(body);

  const agentId = c.get("agentId");
  await fileStore.deleteFile(path, parsed.expectedVersion, agentId);

  eventBus.publish({
    type: "file.deleted",
    data: { path, agentId },
  });

  return c.body(null, 204);
});

// Read file - use wildcard to capture full path
// Handles ?history=true and ?version=N query params
files.get("/*", async (c) => {
  const path = c.req.path.replace(/^\/api\/v1\/files\//, "");
  if (!path) {
    throw new ValidationError("File path is required");
  }

  // File history: GET /files/path?history=true&limit=50
  if (c.req.query("history") === "true") {
    const limit = parseInt(c.req.query("limit") ?? "50");
    const history = await fileStore.getHistory(path, limit);
    return c.json(history);
  }

  // Specific version: GET /files/path?version=3
  const versionParam = c.req.query("version");
  if (versionParam) {
    const version = parseInt(versionParam);
    if (isNaN(version) || version < 1) {
      throw new ValidationError("Invalid version number");
    }
    const fileVersion = await fileStore.getVersion(path, version);
    if (!fileVersion) {
      throw new NotFoundError(`Version ${version} not found for: ${path}`);
    }
    return c.json(fileVersion);
  }

  // Default: read current file
  const file = await fileStore.getFile(path);
  if (!file) {
    throw new NotFoundError(`File not found: ${path}`);
  }

  c.header("X-File-Version", String(file.version));
  return c.json(file);
});

export { files as filesRoutes };
