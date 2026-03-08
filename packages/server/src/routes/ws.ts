import type { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { Env } from "../types";
import { wsManager } from "../services/ws-manager";

const { upgradeWebSocket, websocket } = createBunWebSocket();

export function registerWsRoute(app: Hono<Env>) {
  app.get(
    "/api/v1/subscribe",
    upgradeWebSocket((c) => {
      let client: ReturnType<typeof wsManager.addClient>;

      return {
        onOpen(evt, ws) {
          client = wsManager.addClient(ws);
          ws.send(JSON.stringify({ type: "connected" }));
        },
        onMessage(evt) {
          if (client && typeof evt.data === "string") {
            wsManager.handleMessage(client, evt.data);
          }
        },
        onClose() {
          if (client) {
            wsManager.removeClient(client);
          }
        },
      };
    })
  );
}

export { websocket };
