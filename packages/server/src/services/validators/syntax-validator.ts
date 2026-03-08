import type { ChangesetFile } from "../../db/schema";
import type { ValidationResult } from "./schema-validator";

export function validateSyntax(csFiles: ChangesetFile[]): ValidationResult {
  const errors: ValidationResult["errors"] = [];

  for (const f of csFiles) {
    if (f.operation === "delete") continue;

    const ext = f.filePath.split(".").pop()?.toLowerCase();

    if (ext === "json") {
      try {
        JSON.parse(f.content);
      } catch (err: any) {
        errors.push({
          stage: 1,
          message: `Invalid JSON: ${err.message}`,
          filePath: f.filePath,
        });
      }
    }

    if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
      try {
        const transpiler = new Bun.Transpiler({
          loader: ext === "tsx" || ext === "jsx" ? "tsx" : "ts",
        });
        transpiler.transformSync(f.content);
      } catch (err: any) {
        errors.push({
          stage: 1,
          message: `Syntax error: ${err.message}`,
          filePath: f.filePath,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
