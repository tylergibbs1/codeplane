import type { Context, Next } from "hono";
import type { Env } from "../types";
import { leaseManager } from "../services/lease-manager";
import { LeaseConflictError } from "../errors";

export async function leaseCheck(c: Context<Env>, next: Next) {
  const path = c.req.path.replace(/^\/api\/v1\/files\//, "");
  if (!path) return next();

  const agentId = c.get("agentId");
  const activeLease = await leaseManager.getActiveLease(path);

  if (activeLease && activeLease.agentId !== agentId) {
    throw new LeaseConflictError(
      `File is leased by agent ${activeLease.agentId}`,
      {
        filePath: path,
        heldBy: activeLease.agentId,
        expiresAt: activeLease.expiresAt,
      }
    );
  }

  return next();
}
