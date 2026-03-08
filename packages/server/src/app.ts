import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Env } from "./types";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { rateLimit } from "./middleware/rate-limit";
import { api } from "./routes";
import { registerWsRoute } from "./routes/ws";

const app = new Hono<Env>();

app.use(logger());
app.use(authMiddleware);
app.use("/api/v1/*", rateLimit(100, 60_000));

app.onError(errorHandler);

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/api/v1", api);
registerWsRoute(app);

export { app };
