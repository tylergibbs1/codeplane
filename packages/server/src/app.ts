import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Env } from "./types";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { api } from "./routes";

const app = new Hono<Env>();

app.use(logger());
app.use(authMiddleware);

app.onError(errorHandler);

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/api/v1", api);

export { app };
