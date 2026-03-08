import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { fileStore } from "../services/file-store";
import { leaseCheck } from "../middleware/lease-check";
import { NotFoundError, ValidationError } from "../errors";
import { validatePath } from "../services/validation-pipeline";

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

  // Validate path before writing
  const validation = validatePath(path);
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

  return c.body(null, 204);
});

// Read file
files.get("/*", async (c) => {
  const path = c.req.path.replace(/^\/api\/v1\/files\//, "");
  if (!path) {
    throw new ValidationError("File path is required");
  }

  const file = await fileStore.getFile(path);
  if (!file) {
    throw new NotFoundError(`File not found: ${path}`);
  }

  c.header("X-File-Version", String(file.version));
  return c.json(file);
});

export { files as filesRoutes };
