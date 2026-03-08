import type { ChangesetFile } from "../db/schema";
import {
  validateSchema,
  type ValidationResult,
} from "./validators/schema-validator";
import { validateSyntax } from "./validators/syntax-validator";
import { validateLint } from "./validators/lint-validator";

export async function runValidation(
  csFiles: ChangesetFile[],
  existingPaths: Set<string>
): Promise<ValidationResult> {
  // Stage 0: Schema check
  const schemaResult = validateSchema(csFiles, existingPaths);
  if (!schemaResult.valid) {
    return schemaResult;
  }

  // Stage 1: Syntax check
  const syntaxResult = validateSyntax(csFiles);
  if (!syntaxResult.valid) {
    return syntaxResult;
  }

  // Stage 2: Lint (stub for MVP)
  const lintResult = validateLint(csFiles);
  if (!lintResult.valid) {
    return lintResult;
  }

  return { valid: true, errors: [] };
}

/** Validate a single file's path and syntax for direct writes */
export function validateSingleFile(
  path: string,
  content: string
): ValidationResult {
  // Path checks
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

  // Syntax check
  const fakeFile = { filePath: path, content, operation: "update" as const, id: "", changesetId: "", baseVersion: null };
  const syntaxResult = validateSyntax([fakeFile]);
  if (!syntaxResult.valid) {
    return syntaxResult;
  }

  return { valid: true, errors: [] };
}
