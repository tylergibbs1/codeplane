import type { ChangesetFile } from "../db/schema";
import {
  validateSchema,
  type ValidationResult,
} from "./validators/schema-validator";

export async function runValidation(
  csFiles: ChangesetFile[],
  existingPaths: Set<string>
): Promise<ValidationResult> {
  return validateSchema(csFiles, existingPaths);
}

/** Sanitize a file path: reject control characters and double-encoded traversal */
export function sanitizePath(path: string): { clean: string; error?: string } {
  // eslint-disable-next-line no-control-regex
  const cleaned = path.replace(/[\x00-\x1f\x7f]/g, "");

  if (cleaned !== path) {
    return { clean: cleaned, error: "Path contains control characters" };
  }

  try {
    const decoded = decodeURIComponent(cleaned);
    if (decoded !== cleaned && (decoded.includes("..") || decoded.startsWith("/"))) {
      return { clean: cleaned, error: "Double-encoded path traversal detected" };
    }
  } catch {
    // malformed URI — that's fine, just pass through
  }

  return { clean: cleaned };
}

/** Validate a file path for direct writes (security checks only) */
export function validatePath(path: string): ValidationResult {
  const { error: sanitizeError } = sanitizePath(path);
  if (sanitizeError) {
    return { valid: false, errors: [{ stage: 0, message: sanitizeError, filePath: path }] };
  }

  if (path.includes("..")) {
    return { valid: false, errors: [{ stage: 0, message: `Path traversal not allowed: ${path}`, filePath: path }] };
  }
  if (path.startsWith("/")) {
    return { valid: false, errors: [{ stage: 0, message: `Absolute paths not allowed: ${path}`, filePath: path }] };
  }
  if (path.trim() === "") {
    return { valid: false, errors: [{ stage: 0, message: "Empty file path not allowed", filePath: path }] };
  }
  if (path.length > 500) {
    return { valid: false, errors: [{ stage: 0, message: `Path too long (max 500 chars): ${path}`, filePath: path }] };
  }

  return { valid: true, errors: [] };
}
