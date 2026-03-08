export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found", details?: unknown) {
    super(message, 404, "NOT_FOUND", details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Version conflict", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}

export class LeaseConflictError extends AppError {
  constructor(message = "File is leased by another agent", details?: unknown) {
    super(message, 423, "LEASE_CONFLICT", details);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}
