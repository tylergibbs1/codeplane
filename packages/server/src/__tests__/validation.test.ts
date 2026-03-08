import { describe, test, expect } from "bun:test";
import { validateSingleFile } from "../services/validation-pipeline";
import { validateSchema } from "../services/validators/schema-validator";
import { validateSyntax } from "../services/validators/syntax-validator";
import type { ChangesetFile } from "../db/schema";

describe("validateSingleFile", () => {
  test("accepts valid TypeScript", () => {
    const result = validateSingleFile("src/index.ts", "export const x = 1;");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("accepts valid JSON", () => {
    const result = validateSingleFile("config.json", '{"key": "value"}');
    expect(result.valid).toBe(true);
  });

  test("rejects invalid JSON", () => {
    const result = validateSingleFile("config.json", "{bad json");
    expect(result.valid).toBe(false);
    expect(result.errors[0].stage).toBe(1);
  });

  test("rejects invalid TypeScript", () => {
    const result = validateSingleFile("src/bad.ts", "const x: = ;; export {");
    expect(result.valid).toBe(false);
    expect(result.errors[0].stage).toBe(1);
  });

  test("rejects path traversal", () => {
    const result = validateSingleFile("../etc/passwd", "content");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("traversal");
  });

  test("rejects absolute paths", () => {
    const result = validateSingleFile("/etc/passwd", "content");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Absolute");
  });

  test("rejects empty paths", () => {
    const result = validateSingleFile("", "content");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("Empty");
  });

  test("rejects paths over 500 chars", () => {
    const result = validateSingleFile("a".repeat(501) + ".ts", "const x = 1;");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("too long");
  });

  test("accepts plain text files without syntax check", () => {
    const result = validateSingleFile("readme.md", "# Hello\nThis is markdown");
    expect(result.valid).toBe(true);
  });

  test("accepts nested paths", () => {
    const result = validateSingleFile("src/deep/nested/file.ts", "export default {};");
    expect(result.valid).toBe(true);
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

describe("validateSyntax", () => {
  function makeFile(filePath: string, content: string): ChangesetFile {
    return {
      id: "test-id",
      changesetId: "cs-id",
      filePath,
      content,
      baseVersion: null,
      operation: "update",
    };
  }

  test("skips delete operations", () => {
    const result = validateSyntax([
      { ...makeFile("bad.json", "{invalid"), operation: "delete" },
    ]);
    expect(result.valid).toBe(true);
  });

  test("validates .tsx files", () => {
    const result = validateSyntax([
      makeFile("component.tsx", "export default function App() { return <div />; }"),
    ]);
    expect(result.valid).toBe(true);
  });

  test("validates .jsx files", () => {
    const result = validateSyntax([
      makeFile("component.jsx", "export default function App() { return <div />; }"),
    ]);
    expect(result.valid).toBe(true);
  });

  test("passes unknown extensions without checking", () => {
    const result = validateSyntax([
      makeFile("data.csv", "not,valid,json,or,ts"),
    ]);
    expect(result.valid).toBe(true);
  });
});
