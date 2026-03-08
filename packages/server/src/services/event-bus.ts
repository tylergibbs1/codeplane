export interface AppEvent {
  type: string;
  data: Record<string, unknown>;
}

type EventHandler = (event: AppEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  publish(event: AppEvent): void {
    // Notify exact type matches
    const exact = this.listeners.get(event.type);
    if (exact) {
      for (const handler of exact) {
        try {
          handler(event);
        } catch (err) {
          console.error(`Event handler error for ${event.type}:`, err);
        }
      }
    }

    // Notify wildcard pattern matches (e.g., "file.*" matches "file.updated")
    for (const [pattern, handlers] of this.listeners) {
      if (pattern === event.type) continue; // already handled
      if (pattern === "*" || this.matchPattern(pattern, event.type)) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (err) {
            console.error(`Event handler error for ${pattern}:`, err);
          }
        }
      }
    }
  }

  subscribe(pattern: string, handler: EventHandler): () => void {
    if (!this.listeners.has(pattern)) {
      this.listeners.set(pattern, new Set());
    }
    this.listeners.get(pattern)!.add(handler);

    return () => {
      const handlers = this.listeners.get(pattern);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.listeners.delete(pattern);
        }
      }
    };
  }

  private matchPattern(pattern: string, type: string): boolean {
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return pattern === type;

    // Convert "file.*" to regex /^file\..*$/
    const regex = new RegExp(
      "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
    );
    return regex.test(type);
  }
}

export const eventBus = new EventBus();
