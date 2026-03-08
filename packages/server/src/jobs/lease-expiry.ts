import { leaseManager } from "../services/lease-manager";
import { eventBus } from "../services/event-bus";

const EXPIRY_INTERVAL_MS = 10_000; // 10 seconds

let timer: ReturnType<typeof setInterval> | null = null;

export function startLeaseExpiry() {
  timer = setInterval(async () => {
    try {
      const expired = await leaseManager.expireLeases();
      for (const lease of expired) {
        eventBus.publish({
          type: "lease.expired",
          data: {
            leaseId: lease.id,
            filePath: lease.filePath,
            agentId: lease.agentId,
          },
        });
      }
      if (expired.length > 0) {
        console.log(`Expired ${expired.length} lease(s)`);
      }
    } catch (err) {
      console.error("Lease expiry job error:", err);
    }
  }, EXPIRY_INTERVAL_MS);
}

export function stopLeaseExpiry() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
