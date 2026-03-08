import type { ChangesetFile } from "../../db/schema";
import type { ValidationResult } from "./schema-validator";

// Stage 2: Stub — passes with no errors for MVP
export function validateLint(_csFiles: ChangesetFile[]): ValidationResult {
  return { valid: true, errors: [] };
}
