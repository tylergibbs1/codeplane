import type { Context, Next } from "hono";
import type { Env } from "../types";

export async function authMiddleware(c: Context<Env>, next: Next) {
  const path = new URL(c.req.url).pathname;
  if (path === "/health" || path === "/api/v1/subscribe") {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header", code: "UNAUTHORIZED" }, 401);
  }

  const token = authHeader.slice(7);
  const apiKey = process.env.API_KEY;

  if (apiKey && token !== apiKey) {
    return c.json({ error: "Invalid API key", code: "UNAUTHORIZED" }, 401);
  }

  // Agent identity: use X-Agent-Id header if provided, otherwise fall back to token
  const agentId = c.req.header("X-Agent-Id") || token;
  c.set("agentId", agentId);
  return next();
}
