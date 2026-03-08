import type {
  CodePlaneOptions,
  FileResponse,
  FileVersionResponse,
  LeaseResponse,
  ChangesetResponse,
  WsEvent,
} from "./types";
import { CodePlaneError, ConflictError, LeaseConflictError, NotFoundError, ValidationError, RateLimitError } from "./errors";
import { WsSubscription, type Subscription } from "./subscription";

export class CodePlaneClient {
  private baseUrl: string;
  private apiKey: string;
  private agentId?: string;
  private wsSubscription: WsSubscription | null = null;

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

  /** Create a client scoped to a specific agent identity */
  as(agentId: string): CodePlaneClient {
    const clone = new CodePlaneClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      agentId,
    });
    return clone;
  }

  subscribe(
    types: string[],
    handler: (event: WsEvent) => void
  ): Subscription {
    if (!this.wsSubscription) {
      const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/api/v1/subscribe";
      this.wsSubscription = new WsSubscription(wsUrl, this.apiKey);
      this.wsSubscription.connect();
    }
    return this.wsSubscription.subscribe(types, handler);
  }

  close(): void {
    this.wsSubscription?.close();
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

  /** Read a file */
  async get(path: string): Promise<FileResponse> {
    return this.client.request<FileResponse>("GET", `/files/${path}`);
  }

  /** Create or update a file. Omit expectedVersion to create. */
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

  /** List files, optionally filtered by path prefix */
  async list(prefix?: string): Promise<FileResponse[]> {
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    return this.client.request<FileResponse[]>("GET", `/files${query}`);
  }

  /** Delete a file (requires current version for OCC) */
  async delete(path: string, expectedVersion: number): Promise<void> {
    return this.client.request<void>("DELETE", `/files/${path}`, {
      expectedVersion,
    });
  }

  /** Get version history for a file (newest first) */
  async history(path: string, limit = 50): Promise<FileVersionResponse[]> {
    return this.client.request<FileVersionResponse[]>(
      "GET",
      `/files/${path}?history=true&limit=${limit}`
    );
  }

  /** Get a specific historical version */
  async version(path: string, version: number): Promise<FileVersionResponse> {
    return this.client.request<FileVersionResponse>(
      "GET",
      `/files/${path}?version=${version}`
    );
  }

  /**
   * Write with automatic OCC retry. Reads current version, applies your
   * update function, writes back. Retries on conflict up to maxRetries times.
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
          continue; // Retry with fresh version
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

  /** Acquire an exclusive lease on a file */
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

  /** Release a lease */
  async release(leaseId: string): Promise<void> {
    return this.client.request<void>("DELETE", `/leases/${leaseId}`);
  }

  /** Renew a lease */
  async renew(leaseId: string, ttlSeconds?: number): Promise<LeaseResponse> {
    return this.client.request<LeaseResponse>(
      "PUT",
      `/leases/${leaseId}/renew`,
      { ttlSeconds }
    );
  }

  /** Check if a file has an active lease */
  async check(filePath: string): Promise<LeaseResponse | null> {
    const leases = await this.client.request<LeaseResponse[]>(
      "GET",
      `/leases?filePath=${encodeURIComponent(filePath)}`
    );
    return leases[0] ?? null;
  }

  /**
   * Acquire a lease, run your function, then release.
   * The lease is always released, even if fn throws.
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

  /** Create an empty changeset */
  async create(message?: string): Promise<ChangesetResponse> {
    return this.client.request<ChangesetResponse>("POST", "/changesets", {
      message,
    });
  }

  /** Get changeset details including staged files */
  async get(id: string): Promise<ChangesetResponse> {
    return this.client.request<ChangesetResponse>("GET", `/changesets/${id}`);
  }

  /** Stage a file in a changeset */
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

  /** Remove a file from a changeset */
  async removeFile(id: string, filePath: string): Promise<void> {
    await this.client.request("DELETE", `/changesets/${id}/files/${filePath}`);
  }

  /** Submit a changeset for validation and atomic commit */
  async submit(id: string): Promise<ChangesetResponse> {
    return this.client.request<ChangesetResponse>(
      "POST",
      `/changesets/${id}/submit`
    );
  }

  /** List changesets, optionally filtered by status */
  async list(status?: string): Promise<ChangesetResponse[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.client.request<ChangesetResponse[]>(
      "GET",
      `/changesets${query}`
    );
  }

  /**
   * Build and submit a changeset in one fluent call.
   *
   * ```ts
   * const result = await cp.changesets
   *   .build("Rename calculateTotal to computeSum")
   *   .update("lib/math.ts", newMathContent)
   *   .update("app/main.ts", newMainContent)
   *   .create("lib/helpers.ts", helperContent)
   *   .delete("lib/old.ts")
   *   .submit();
   * ```
   */
  build(message?: string): ChangesetBuilder {
    return new ChangesetBuilder(this, message);
  }
}

// ─── Changeset Builder ────────────────────────────────────────────────

interface StagedFile {
  filePath: string;
  content: string;
  operation: "create" | "update" | "delete";
}

export class ChangesetBuilder {
  private staged: StagedFile[] = [];

  constructor(
    private ops: ChangesetOperations,
    private message?: string
  ) {}

  /** Stage a new file */
  create(filePath: string, content: string): this {
    this.staged.push({ filePath, content, operation: "create" });
    return this;
  }

  /** Stage an update to an existing file */
  update(filePath: string, content: string): this {
    this.staged.push({ filePath, content, operation: "update" });
    return this;
  }

  /** Stage a file deletion */
  delete(filePath: string): this {
    this.staged.push({ filePath, content: "", operation: "delete" });
    return this;
  }

  /** Create the changeset, stage all files, and submit atomically */
  async submit(): Promise<ChangesetResponse> {
    if (this.staged.length === 0) {
      throw new Error("No files staged in changeset");
    }

    const cs = await this.ops.create(this.message);

    for (const file of this.staged) {
      await this.ops.addFile(cs.id, file.filePath, file.content, file.operation);
    }

    return this.ops.submit(cs.id);
  }
}
