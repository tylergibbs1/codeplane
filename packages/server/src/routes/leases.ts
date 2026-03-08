import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { leaseManager } from "../services/lease-manager";

const leases = new Hono<Env>();

// Acquire lease
leases.post("/", async (c) => {
  const body = await c.req.json();
  const schema = z.object({
    filePath: z.string().min(1),
    ttlSeconds: z.number().int().positive().optional(),
    intent: z.string().optional(),
  });
  const parsed = schema.parse(body);
  const agentId = c.get("agentId");

  const lease = await leaseManager.acquireLease(
    parsed.filePath,
    agentId,
    parsed.ttlSeconds,
    parsed.intent
  );

  return c.json(lease, 201);
});

// Release lease
leases.delete("/:id", async (c) => {
  const leaseId = c.req.param("id");
  const agentId = c.get("agentId");
  await leaseManager.releaseLease(leaseId, agentId);
  return c.body(null, 204);
});

// Renew lease
leases.put("/:id/renew", async (c) => {
  const leaseId = c.req.param("id");
  const agentId = c.get("agentId");
  const body = await c.req.json();
  const schema = z.object({
    ttlSeconds: z.number().int().positive().optional(),
  });
  const parsed = schema.parse(body);

  const lease = await leaseManager.renewLease(
    leaseId,
    agentId,
    parsed.ttlSeconds
  );

  return c.json(lease);
});

// List active leases
leases.get("/", async (c) => {
  const filePath = c.req.query("filePath");
  if (filePath) {
    const lease = await leaseManager.getActiveLease(filePath);
    return c.json(lease ? [lease] : []);
  }
  const all = await leaseManager.listActiveLeases();
  return c.json(all);
});

export { leases as leasesRoutes };
