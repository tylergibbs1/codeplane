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
  constructor(message = "Version conflict", details?: unknown) {
    super(message, 409, "CONFLICT", details);
    this.name = "ConflictError";
  }
}

export class LeaseConflictError extends CodePlaneError {
  constructor(message = "File is leased by another agent", details?: unknown) {
    super(message, 423, "LEASE_CONFLICT", details);
    this.name = "LeaseConflictError";
  }
}

export class NotFoundError extends CodePlaneError {
  constructor(message = "Not found", details?: unknown) {
    super(message, 404, "NOT_FOUND", details);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends CodePlaneError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class RateLimitError extends CodePlaneError {
  /** Seconds until rate limit resets */
  public retryAfter: number;

  constructor(message = "Too many requests", retryAfter = 60) {
    super(message, 429, "RATE_LIMITED");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}
