import type { WSContext } from "hono/ws";
import { eventBus, type AppEvent } from "./event-bus";

interface WsClient {
  ws: WSContext;
  subscriptions: Set<string>;
}

export class WsManager {
  private clients = new Set<WsClient>();

  constructor() {
    // Subscribe to all events and fan out to WS clients
    eventBus.subscribe("*", (event) => this.broadcast(event));
  }

  addClient(ws: WSContext): WsClient {
    const client: WsClient = { ws, subscriptions: new Set() };
    this.clients.add(client);
    return client;
  }

  removeClient(client: WsClient): void {
    this.clients.delete(client);
  }

  handleMessage(client: WsClient, data: string): void {
    try {
      const msg = JSON.parse(data);
      if (msg.action === "subscribe" && Array.isArray(msg.types)) {
        for (const type of msg.types) {
          client.subscriptions.add(type);
        }
        client.ws.send(
          JSON.stringify({ type: "subscribed", types: Array.from(client.subscriptions) })
        );
      } else if (msg.action === "unsubscribe" && Array.isArray(msg.types)) {
        for (const type of msg.types) {
          client.subscriptions.delete(type);
        }
        client.ws.send(
          JSON.stringify({ type: "unsubscribed", types: Array.from(client.subscriptions) })
        );
      }
    } catch {
      client.ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
    }
  }

  private broadcast(event: AppEvent): void {
    const message = JSON.stringify({
      type: event.type,
      data: event.data,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.clients) {
      if (this.matchesSubscription(client, event.type)) {
        try {
          client.ws.send(message);
        } catch {
          // Client disconnected; will be cleaned up on close
        }
      }
    }
  }

  private matchesSubscription(client: WsClient, eventType: string): boolean {
    if (client.subscriptions.size === 0) return false;
    for (const pattern of client.subscriptions) {
      if (pattern === "*") return true;
      if (pattern === eventType) return true;
      if (pattern.includes("*")) {
        const regex = new RegExp(
          "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
        );
        if (regex.test(eventType)) return true;
      }
    }
    return false;
  }
}

export const wsManager = new WsManager();
