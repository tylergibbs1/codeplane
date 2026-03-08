import type {
  CodePlaneOptions,
  FileResponse,
  LeaseResponse,
  ChangesetResponse,
} from "./types";
import { CodePlaneError, ConflictError, LeaseConflictError, NotFoundError, ValidationError, RateLimitError } from "./errors";

export class CodePlaneClient {
  private baseUrl: string;
  private apiKey: string;
  private agentId?: string;

  readonly files: FileOperations;
  readonly leases: LeaseOperations;
  readonly changesets: ChangesetOperations;

  constructor(options: CodePlaneOptions = {}) {
    this.baseUrl = (
      options.baseUrl ||
      process.env.CODEPLANE_URL ||
      "http://localhost:3100"
    ).replace(/\/$/, "");

    this.apiKey =
      options.apiKey ||
      process.env.CODEPLANE_API_KEY ||
      process.env.CODEPLANE_KEY ||
      "";

    if (!this.apiKey) {
      throw new Error(
        "CodePlane API key required. Set CODEPLANE_API_KEY env or pass apiKey option."
      );
    }

    this.agentId = options.agentId;

    this.files = new FileOperations(this);
    this.leases = new LeaseOperations(this);
    this.changesets = new ChangesetOperations(this);
  }

  /** Create a client scoped to a different agent identity */
  as(agentId: string): CodePlaneClient {
    return new CodePlaneClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      agentId,
    });
  }

  /** @internal */
  async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.agentId) {
      headers["X-Agent-Id"] = this.agentId;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json();

    if (!response.ok) {
      const msg = data.error || "Request failed";
      const details = data.details;

      switch (response.status) {
        case 400:
          throw new ValidationError(msg, details);
        case 404:
          throw new NotFoundError(msg, details);
        case 409:
          throw new ConflictError(msg, details);
        case 423:
          throw new LeaseConflictError(msg, details);
        case 429:
          throw new RateLimitError(msg, data.retryAfter);
        default:
          throw new CodePlaneError(msg, response.status, data.code || "UNKNOWN", details);
      }
    }

    return data as T;
  }
}

// ─── File Operations ──────────────────────────────────────────────────

class FileOperations {
  constructor(private client: CodePlaneClient) {}

  async get(path: string): Promise<FileResponse> {
    return this.client.request<FileResponse>("GET", `/files/${path}`);
  }

  async write(
    path: string,
    content: string,
    expectedVersion?: number
  ): Promise<FileResponse> {
    return this.client.request<FileResponse>("PUT", `/files/${path}`, {
      content,
      expectedVersion,
    });
  }

  async list(prefix?: string): Promise<FileResponse[]> {
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    return this.client.request<FileResponse[]>("GET", `/files${query}`);
  }

  async delete(path: string, expectedVersion: number): Promise<void> {
    return this.client.request<void>("DELETE", `/files/${path}`, {
      expectedVersion,
    });
  }

  /**
   * Read → transform → write with automatic OCC retry.
   */
  async update(
    path: string,
    updater: (current: FileResponse) => string,
    maxRetries = 3
  ): Promise<FileResponse> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const current = await this.get(path);
      const newContent = updater(current);
      try {
        return await this.write(path, newContent, current.version);
      } catch (err) {
        if (err instanceof ConflictError && attempt < maxRetries) {
          continue;
        }
        throw err;
      }
    }
    throw new ConflictError("Max retries exceeded");
  }
}

// ─── Lease Operations ─────────────────────────────────────────────────

class LeaseOperations {
  constructor(private client: CodePlaneClient) {}

  async acquire(
    filePath: string,
    options?: { ttlSeconds?: number; intent?: string }
  ): Promise<LeaseResponse> {
    return this.client.request<LeaseResponse>("POST", "/leases", {
      filePath,
      ttlSeconds: options?.ttlSeconds,
      intent: options?.intent,
    });
  }

  async release(leaseId: string): Promise<void> {
    return this.client.request<void>("DELETE", `/leases/${leaseId}`);
  }

  async renew(leaseId: string, ttlSeconds?: number): Promise<LeaseResponse> {
    return this.client.request<LeaseResponse>(
      "PUT",
      `/leases/${leaseId}/renew`,
      { ttlSeconds }
    );
  }

  async check(filePath: string): Promise<LeaseResponse | null> {
    const leases = await this.client.request<LeaseResponse[]>(
      "GET",
      `/leases?filePath=${encodeURIComponent(filePath)}`
    );
    return leases[0] ?? null;
  }

  /**
   * Acquire a lease, run your function, then release.
   */
  async withLease<T>(
    filePath: string,
    fn: (lease: LeaseResponse) => Promise<T>,
    options?: { ttlSeconds?: number; intent?: string }
  ): Promise<T> {
    const lease = await this.acquire(filePath, options);
    try {
      return await fn(lease);
    } finally {
      await this.release(lease.id).catch(() => {});
    }
  }
}

// ─── Changeset Operations ─────────────────────────────────────────────

class ChangesetOperations {
  constructor(private client: CodePlaneClient) {}

  async create(message?: string): Promise<ChangesetResponse> {
    return this.client.request<ChangesetResponse>("POST", "/changesets", {
      message,
    });
  }

  async get(id: string): Promise<ChangesetResponse> {
    return this.client.request<ChangesetResponse>("GET", `/changesets/${id}`);
  }

  async addFile(
    id: string,
    filePath: string,
    content: string,
    operation?: "create" | "update" | "delete"
  ): Promise<void> {
    await this.client.request("PUT", `/changesets/${id}/files/${filePath}`, {
      content,
      operation,
    });
  }

  async removeFile(id: string, filePath: string): Promise<void> {
    await this.client.request("DELETE", `/changesets/${id}/files/${filePath}`);
  }

  async submit(id: string): Promise<ChangesetResponse> {
    return this.client.request<ChangesetResponse>(
      "POST",
      `/changesets/${id}/submit`
    );
  }

  async list(status?: string): Promise<ChangesetResponse[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.client.request<ChangesetResponse[]>(
      "GET",
      `/changesets${query}`
    );
  }
}
