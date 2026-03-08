import type { Context, Next } from "hono";
import type { Env } from "../types";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const DEFAULT_MAX = 100; // requests per window
const DEFAULT_WINDOW_MS = 60_000; // 1 minute

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}, 30_000);

export function rateLimit(
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS
) {
  return async (c: Context<Env>, next: Next) => {
    const agentId = c.get("agentId") ?? c.req.header("x-forwarded-for") ?? "anonymous";
    const now = Date.now();

    let entry = store.get(agentId);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(agentId, entry);
    }

    entry.count++;

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      return c.json(
        {
          error: "Too many requests",
          code: "RATE_LIMITED",
          retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        },
        429
      );
    }

    return next();
  };
}
