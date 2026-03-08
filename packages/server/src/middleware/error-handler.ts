import type { ErrorHandler } from "hono";
import { AppError } from "../errors";
import { ZodError } from "zod";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(
      {
        error: err.message,
        code: err.code,
        ...(err.details !== undefined && { details: err.details }),
      },
      err.statusCode as any
    );
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: "Validation error",
        code: "VALIDATION_ERROR",
        details: err.errors,
      },
      400
    );
  }

  console.error("Unhandled error:", err);
  return c.json(
    { error: "Internal server error", code: "INTERNAL_ERROR" },
    500
  );
};
