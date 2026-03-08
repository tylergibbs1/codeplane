import { describe, test, expect } from "bun:test";
import { EventBus } from "../services/event-bus";

describe("EventBus", () => {
  test("delivers events to matching subscribers", () => {
    const bus = new EventBus();
    const received: any[] = [];

    bus.subscribe("file.created", (event) => received.push(event));
    bus.publish({ type: "file.created", data: { path: "test.ts" } });

    expect(received).toHaveLength(1);
    expect(received[0].data.path).toBe("test.ts");
  });

  test("wildcard * matches all events", () => {
    const bus = new EventBus();
    const received: any[] = [];

    bus.subscribe("*", (event) => received.push(event));
    bus.publish({ type: "file.created", data: {} });
    bus.publish({ type: "lease.acquired", data: {} });

    expect(received).toHaveLength(2);
  });

  test("prefix wildcard file.* matches file events", () => {
    const bus = new EventBus();
    const received: any[] = [];

    bus.subscribe("file.*", (event) => received.push(event));
    bus.publish({ type: "file.created", data: {} });
    bus.publish({ type: "file.updated", data: {} });
    bus.publish({ type: "lease.acquired", data: {} });

    expect(received).toHaveLength(2);
  });

  test("exact match only matches exact type", () => {
    const bus = new EventBus();
    const received: any[] = [];

    bus.subscribe("file.created", (event) => received.push(event));
    bus.publish({ type: "file.updated", data: {} });

    expect(received).toHaveLength(0);
  });

  test("unsubscribe stops delivery", () => {
    const bus = new EventBus();
    const received: any[] = [];

    const unsub = bus.subscribe("file.created", (event) => received.push(event));
    bus.publish({ type: "file.created", data: {} });
    expect(received).toHaveLength(1);

    unsub();
    bus.publish({ type: "file.created", data: {} });
    expect(received).toHaveLength(1);
  });
});
