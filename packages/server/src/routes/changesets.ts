import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { changesetEngine } from "../services/changeset-engine";

const changesetsRouter = new Hono<Env>();

// Create changeset
changesetsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const schema = z.object({
    message: z.string().optional(),
  });
  const parsed = schema.parse(body);
  const agentId = c.get("agentId");

  const cs = await changesetEngine.createChangeset(agentId, parsed.message);
  return c.json(cs, 201);
});

// Get changeset
changesetsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const cs = await changesetEngine.getChangeset(id);
  return c.json(cs);
});

// List changesets
changesetsRouter.get("/", async (c) => {
  const status = c.req.query("status");
  const list = await changesetEngine.listChangesets(status);
  return c.json(list);
});

// Add file to changeset
changesetsRouter.put("/:id/files/*", async (c) => {
  const changesetId = c.req.param("id");
  const filePath = c.req.path.replace(
    /^\/api\/v1\/changesets\/[^/]+\/files\//,
    ""
  );

  const body = await c.req.json();
  const schema = z.object({
    content: z.string(),
    operation: z.enum(["create", "update", "delete"]).optional(),
  });
  const parsed = schema.parse(body);

  const csFile = await changesetEngine.addFile(
    changesetId,
    filePath,
    parsed.content,
    parsed.operation
  );

  return c.json(csFile, 201);
});

// Remove file from changeset
changesetsRouter.delete("/:id/files/*", async (c) => {
  const changesetId = c.req.param("id");
  const filePath = c.req.path.replace(
    /^\/api\/v1\/changesets\/[^/]+\/files\//,
    ""
  );

  await changesetEngine.removeFile(changesetId, filePath);
  return c.body(null, 204);
});

// Submit changeset
changesetsRouter.post("/:id/submit", async (c) => {
  const id = c.req.param("id");
  const cs = await changesetEngine.submit(id);
  return c.json(cs);
});

export { changesetsRouter as changesetsRoutes };
