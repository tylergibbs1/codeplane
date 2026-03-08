import type {
  CodePlaneOptions,
  FileResponse,
  LeaseResponse,
  ChangesetResponse,
  WsEvent,
} from "./types";
import { CodePlaneError, ConflictError, LeaseConflictError, NotFoundError } from "./errors";
import { WsSubscription, type Subscription } from "./subscription";

export class CodePlaneClient {
  private baseUrl: string;
  private apiKey: string;
  private wsSubscription: WsSubscription | null = null;

  readonly files: FileOperations;
  readonly leases: LeaseOperations;
  readonly changesets: ChangesetOperations;

  constructor(options: CodePlaneOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;

    this.files = new FileOperations(this);
    this.leases = new LeaseOperations(this);
    this.changesets = new ChangesetOperations(this);
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

  async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
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
      const code = data.code || "UNKNOWN";
      const details = data.details;

      switch (response.status) {
        case 404:
          throw new NotFoundError(msg, details);
        case 409:
          throw new ConflictError(msg, details);
        case 423:
          throw new LeaseConflictError(msg, details);
        default:
          throw new CodePlaneError(msg, response.status, code, details);
      }
    }

    return data as T;
  }
}

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
}

class LeaseOperations {
  constructor(private client: CodePlaneClient) {}

  async acquire(
    filePath: string,
    ttlSeconds?: number,
    intent?: string
  ): Promise<LeaseResponse> {
    return this.client.request<LeaseResponse>("POST", "/leases", {
      filePath,
      ttlSeconds,
      intent,
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
}

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
