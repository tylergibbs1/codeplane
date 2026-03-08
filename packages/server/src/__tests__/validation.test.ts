import { describe, test, expect } from "bun:test";
import { validatePath, sanitizePath } from "../services/validation-pipeline";
import { validateSchema } from "../services/validators/schema-validator";
import type { ChangesetFile } from "../db/schema";

describe("validatePath", () => {
  test("accepts valid paths", () => {
    expect(validatePath("src/index.ts").valid).toBe(true);
    expect(validatePath("src/deep/nested/file.ts").valid).toBe(true);
    expect(validatePath("readme.md").valid).toBe(true);
    expect(validatePath("config.json").valid).toBe(true);
  });

  test("rejects path traversal", () => {
    const result = validatePath("../etc/passwd");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("traversal");
  });

  test("rejects absolute paths", () => {
    const result = validatePath("/etc/passwd");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Absolute");
  });

  test("rejects empty paths", () => {
    const result = validatePath("");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Empty");
  });

  test("rejects paths over 500 chars", () => {
    const result = validatePath("a".repeat(501) + ".ts");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("too long");
  });

  test("rejects paths with control characters", () => {
    const result = validatePath("src/\x00evil.ts");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("control characters");
  });

  test("rejects double-encoded path traversal", () => {
    const result = validatePath("%2e%2e/etc/passwd");
    expect(result.valid).toBe(false);
  });
});

describe("sanitizePath", () => {
  test("passes clean paths through", () => {
    const result = sanitizePath("src/index.ts");
    expect(result.clean).toBe("src/index.ts");
    expect(result.error).toBeUndefined();
  });

  test("detects null bytes", () => {
    const result = sanitizePath("src/\x00evil.ts");
    expect(result.error).toContain("control characters");
  });

  test("detects tab characters", () => {
    const result = sanitizePath("src/\tevil.ts");
    expect(result.error).toContain("control characters");
  });

  test("detects double-encoded traversal", () => {
    const result = sanitizePath("%2e%2e/etc/passwd");
    expect(result.error).toContain("Double-encoded");
  });
});

describe("validateSchema", () => {
  function makeFile(overrides: Partial<ChangesetFile>): ChangesetFile {
    return {
      id: "test-id",
      changesetId: "cs-id",
      filePath: "src/test.ts",
      content: "export const x = 1;",
      baseVersion: null,
      operation: "update",
      ...overrides,
    };
  }

  test("allows create for new file", () => {
    const result = validateSchema(
      [makeFile({ operation: "create", filePath: "new.ts" })],
      new Set()
    );
    expect(result.valid).toBe(true);
  });

  test("rejects create for existing file", () => {
    const result = validateSchema(
      [makeFile({ operation: "create", filePath: "existing.ts" })],
      new Set(["existing.ts"])
    );
    expect(result.valid).toBe(false);
  });

  test("allows update for existing file", () => {
    const result = validateSchema(
      [makeFile({ operation: "update", filePath: "existing.ts" })],
      new Set(["existing.ts"])
    );
    expect(result.valid).toBe(true);
  });

  test("rejects update for nonexistent file", () => {
    const result = validateSchema(
      [makeFile({ operation: "update", filePath: "missing.ts" })],
      new Set()
    );
    expect(result.valid).toBe(false);
  });

  test("rejects delete for nonexistent file", () => {
    const result = validateSchema(
      [makeFile({ operation: "delete", filePath: "missing.ts" })],
      new Set()
    );
    expect(result.valid).toBe(false);
  });
});
