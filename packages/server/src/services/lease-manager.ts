import { eq, sql, and } from "drizzle-orm";
import { db } from "../db";
import { leases, type Lease } from "../db/schema";
import { LeaseConflictError, NotFoundError } from "../errors";

const DEFAULT_TTL_SECONDS = 300; // 5 minutes

export class LeaseManager {
  async acquireLease(
    filePath: string,
    agentId: string,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    intent?: string
  ): Promise<Lease> {
    // Check for existing active, non-expired lease
    const existing = await this.getActiveLease(filePath);
    if (existing) {
      if (existing.agentId === agentId) {
        // Same agent — renew instead
        return this.renewLease(existing.id, agentId, ttlSeconds);
      }
      throw new LeaseConflictError(
        `File is leased by agent ${existing.agentId}`,
        {
          filePath,
          heldBy: existing.agentId,
          expiresAt: existing.expiresAt,
          intent: existing.intent,
        }
      );
    }

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    try {
      const result = await db
        .insert(leases)
        .values({ filePath, agentId, expiresAt, intent })
        .returning();
      return result[0];
    } catch (err: any) {
      // Handle unique constraint violation (race condition)
      if (err.code === "23505") {
        throw new LeaseConflictError("File lease acquired by another agent", {
          filePath,
        });
      }
      throw err;
    }
  }

  async releaseLease(leaseId: string, agentId: string): Promise<void> {
    const result = await db
      .update(leases)
      .set({ released: true })
      .where(
        and(
          eq(leases.id, leaseId),
          eq(leases.agentId, agentId),
          eq(leases.released, false)
        )
      )
      .returning();

    if (result.length === 0) {
      throw new NotFoundError("Lease not found or already released");
    }
  }

  async renewLease(
    leaseId: string,
    agentId: string,
    ttlSeconds = DEFAULT_TTL_SECONDS
  ): Promise<Lease> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const result = await db
      .update(leases)
      .set({ expiresAt })
      .where(
        and(
          eq(leases.id, leaseId),
          eq(leases.agentId, agentId),
          eq(leases.released, false)
        )
      )
      .returning();

    if (result.length === 0) {
      throw new NotFoundError("Lease not found or already released");
    }

    return result[0];
  }

  async getActiveLease(filePath: string): Promise<Lease | null> {
    const result = await db
      .select()
      .from(leases)
      .where(
        and(
          eq(leases.filePath, filePath),
          eq(leases.released, false),
          sql`${leases.expiresAt} > now()`
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  async isLeaseHeld(filePath: string, agentId: string): Promise<boolean> {
    const lease = await this.getActiveLease(filePath);
    return lease !== null && lease.agentId === agentId;
  }

  async listActiveLeases(): Promise<Lease[]> {
    return db
      .select()
      .from(leases)
      .where(
        and(eq(leases.released, false), sql`${leases.expiresAt} > now()`)
      );
  }

  /** Expire all leases past their TTL. Returns expired leases. */
  async expireLeases(): Promise<Lease[]> {
    return db
      .update(leases)
      .set({ released: true })
      .where(
        and(eq(leases.released, false), sql`${leases.expiresAt} <= now()`)
      )
      .returning();
  }
}

export const leaseManager = new LeaseManager();
