import type { WsEvent } from "./types";

export interface Subscription {
  unsubscribe(): void;
}

export class WsSubscription {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(event: WsEvent) => void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private closed = false;

  constructor(
    private url: string,
    private apiKey: string
  ) {}

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      // Re-subscribe to all registered patterns
      const types = Array.from(this.handlers.keys());
      if (types.length > 0) {
        this.ws!.send(JSON.stringify({ action: "subscribe", types }));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as WsEvent;
        if (data.type === "connected" || data.type === "subscribed") return;
        this.dispatch(data);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      if (!this.closed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // Will trigger onclose
    };
  }

  subscribe(
    types: string[],
    handler: (event: WsEvent) => void
  ): Subscription {
    for (const type of types) {
      if (!this.handlers.has(type)) {
        this.handlers.set(type, new Set());
      }
      this.handlers.get(type)!.add(handler);
    }

    // Send subscribe message if connected
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: "subscribe", types }));
    }

    return {
      unsubscribe: () => {
        for (const type of types) {
          this.handlers.get(type)?.delete(handler);
          if (this.handlers.get(type)?.size === 0) {
            this.handlers.delete(type);
          }
        }
      },
    };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
  }

  private dispatch(event: WsEvent): void {
    for (const [pattern, handlers] of this.handlers) {
      if (this.matchPattern(pattern, event.type)) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (err) {
            console.error("WS handler error:", err);
          }
        }
      }
    }
  }

  private matchPattern(pattern: string, type: string): boolean {
    if (pattern === "*") return true;
    if (pattern === type) return true;
    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      return regex.test(type);
    }
    return false;
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.connect();
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay
      );
    }, this.reconnectDelay);
  }
}
