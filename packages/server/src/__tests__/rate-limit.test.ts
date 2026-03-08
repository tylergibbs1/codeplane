import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { rateLimit } from "../middleware/rate-limit";

type TestEnv = { Variables: { agentId: string } };

function createApp(max: number, windowMs: number) {
  const app = new Hono<TestEnv>();

  // Set a fake agentId before rate limit runs
  app.use("*", async (c, next) => {
    c.set("agentId", c.req.header("X-Agent-Id") ?? "test-agent");
    return next();
  });

  app.use("*", rateLimit(max, windowMs));

  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit", () => {
  test("allows requests under the limit", async () => {
    const app = createApp(5, 60_000);
    const res = await app.request("/test", {
      headers: { "X-Agent-Id": "agent-rate-1" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
  });

  test("returns 429 when limit exceeded", async () => {
    const app = createApp(3, 60_000);
    const agentId = `agent-rate-${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/test", {
        headers: { "X-Agent-Id": agentId },
      });
      expect(res.status).toBe(200);
    }

    const res = await app.request("/test", {
      headers: { "X-Agent-Id": agentId },
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("RATE_LIMITED");
  });

  test("different agents have separate limits", async () => {
    const app = createApp(2, 60_000);
    const agent1 = `agent-a-${Date.now()}`;
    const agent2 = `agent-b-${Date.now()}`;

    // Exhaust agent1's limit
    await app.request("/test", { headers: { "X-Agent-Id": agent1 } });
    await app.request("/test", { headers: { "X-Agent-Id": agent1 } });
    const res1 = await app.request("/test", { headers: { "X-Agent-Id": agent1 } });
    expect(res1.status).toBe(429);

    // agent2 should still be fine
    const res2 = await app.request("/test", { headers: { "X-Agent-Id": agent2 } });
    expect(res2.status).toBe(200);
  });

  test("remaining count decrements correctly", async () => {
    const app = createApp(5, 60_000);
    const agentId = `agent-remain-${Date.now()}`;

    const res1 = await app.request("/test", { headers: { "X-Agent-Id": agentId } });
    expect(res1.headers.get("X-RateLimit-Remaining")).toBe("4");

    const res2 = await app.request("/test", { headers: { "X-Agent-Id": agentId } });
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("3");
  });
});
