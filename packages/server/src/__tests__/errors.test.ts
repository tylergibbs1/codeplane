import { describe, test, expect } from "bun:test";
import {
  AppError,
  NotFoundError,
  ConflictError,
  LeaseConflictError,
  ValidationError,
} from "../errors";

describe("Error classes", () => {
  test("NotFoundError has correct status and code", () => {
    const err = new NotFoundError("File not found");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("File not found");
    expect(err).toBeInstanceOf(AppError);
  });

  test("ConflictError has correct status and code", () => {
    const err = new ConflictError("Version mismatch", { expected: 1, got: 2 });
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
    expect(err.details).toEqual({ expected: 1, got: 2 });
  });

  test("LeaseConflictError has correct status and code", () => {
    const err = new LeaseConflictError();
    expect(err.statusCode).toBe(423);
    expect(err.code).toBe("LEASE_CONFLICT");
  });

  test("ValidationError has correct status and code", () => {
    const err = new ValidationError("Bad input", [{ field: "path" }]);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toEqual([{ field: "path" }]);
  });

  test("default messages work", () => {
    expect(new NotFoundError().message).toBe("Not found");
    expect(new ConflictError().message).toBe("Version conflict");
    expect(new LeaseConflictError().message).toBe("File is leased by another agent");
    expect(new ValidationError().message).toBe("Validation failed");
  });
});
