import { app } from "./app";
import { websocket } from "./routes/ws";
import { startLeaseExpiry } from "./jobs/lease-expiry";

const port = Number(process.env.PORT || 3100);

startLeaseExpiry();

console.log(`CodePlane server starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
  websocket,
};
