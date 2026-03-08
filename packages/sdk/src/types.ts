export interface FileResponse {
  path: string;
  content: string;
  version: number;
  contentHash: string;
  lastModifiedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaseResponse {
  id: string;
  filePath: string;
  agentId: string;
  intent: string | null;
  acquiredAt: string;
  expiresAt: string;
  released: boolean;
}

export interface ChangesetResponse {
  id: string;
  agentId: string;
  status: "open" | "validating" | "committed" | "failed";
  message: string | null;
  validationStage: number;
  validationErrors: unknown[];
  gitSha: string | null;
  createdAt: string;
  submittedAt: string | null;
  committedAt: string | null;
  files?: ChangesetFileResponse[];
}

export interface ChangesetFileResponse {
  id: string;
  changesetId: string;
  filePath: string;
  content: string;
  baseVersion: number | null;
  operation: "create" | "update" | "delete";
}

export interface WsEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface CodePlaneOptions {
  baseUrl: string;
  apiKey: string;
}
