export class CodePlaneError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "CodePlaneError";
  }
}

export class ConflictError extends CodePlaneError {
  constructor(message: string, details?: unknown) {
    super(message, 409, "CONFLICT", details);
    this.name = "ConflictError";
  }
}

export class LeaseConflictError extends CodePlaneError {
  constructor(message: string, details?: unknown) {
    super(message, 423, "LEASE_CONFLICT", details);
    this.name = "LeaseConflictError";
  }
}

export class NotFoundError extends CodePlaneError {
  constructor(message: string, details?: unknown) {
    super(message, 404, "NOT_FOUND", details);
    this.name = "NotFoundError";
  }
}
