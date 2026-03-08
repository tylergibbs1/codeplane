import type { ChangesetFile } from "../../db/schema";

export interface ValidationResult {
  valid: boolean;
  errors: { stage: number; message: string; filePath?: string }[];
}

export function validateSchema(
  csFiles: ChangesetFile[],
  existingPaths: Set<string>
): ValidationResult {
  const errors: ValidationResult["errors"] = [];

  for (const f of csFiles) {
    // No path traversal
    if (f.filePath.includes("..")) {
      errors.push({
        stage: 0,
        message: `Path traversal not allowed: ${f.filePath}`,
        filePath: f.filePath,
      });
      continue;
    }

    // No absolute paths
    if (f.filePath.startsWith("/")) {
      errors.push({
        stage: 0,
        message: `Absolute paths not allowed: ${f.filePath}`,
        filePath: f.filePath,
      });
      continue;
    }

    // No empty paths
    if (f.filePath.trim() === "") {
      errors.push({
        stage: 0,
        message: "Empty file path not allowed",
        filePath: f.filePath,
      });
      continue;
    }

    // Max path length
    if (f.filePath.length > 500) {
      errors.push({
        stage: 0,
        message: `Path too long (max 500 chars): ${f.filePath}`,
        filePath: f.filePath,
      });
      continue;
    }

    // Operation validity
    if (f.operation === "create" && existingPaths.has(f.filePath)) {
      errors.push({
        stage: 0,
        message: `Cannot create file that already exists: ${f.filePath}`,
        filePath: f.filePath,
      });
    }

    if (
      (f.operation === "update" || f.operation === "delete") &&
      !existingPaths.has(f.filePath)
    ) {
      errors.push({
        stage: 0,
        message: `Cannot ${f.operation} file that does not exist: ${f.filePath}`,
        filePath: f.filePath,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
