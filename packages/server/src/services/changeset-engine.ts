import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  changesets,
  changesetFiles,
  files,
  type Changeset,
  type ChangesetFile,
} from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { runValidation } from "./validation-pipeline";

function hashContent(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export class ChangesetEngine {
  async createChangeset(agentId: string, message?: string): Promise<Changeset> {
    const result = await db
      .insert(changesets)
      .values({ agentId, message })
      .returning();
    return result[0];
  }

  async getChangeset(
    id: string
  ): Promise<Changeset & { files: ChangesetFile[] }> {
    const cs = await db
      .select()
      .from(changesets)
      .where(eq(changesets.id, id))
      .limit(1);

    if (cs.length === 0) {
      throw new NotFoundError(`Changeset not found: ${id}`);
    }

    const csFiles = await db
      .select()
      .from(changesetFiles)
      .where(eq(changesetFiles.changesetId, id));

    return { ...cs[0], files: csFiles };
  }

  async addFile(
    changesetId: string,
    filePath: string,
    content: string,
    operation: "create" | "update" | "delete" = "update"
  ): Promise<ChangesetFile> {
    const cs = await db
      .select()
      .from(changesets)
      .where(eq(changesets.id, changesetId))
      .limit(1);

    if (cs.length === 0) {
      throw new NotFoundError(`Changeset not found: ${changesetId}`);
    }
    if (cs[0].status !== "open") {
      throw new ValidationError(
        `Changeset is ${cs[0].status}, cannot add files`
      );
    }

    let baseVersion: number | null = null;
    if (operation !== "create") {
      const existing = await db
        .select()
        .from(files)
        .where(eq(files.path, filePath))
        .limit(1);
      if (existing.length > 0) {
        baseVersion = existing[0].version;
      }
    }

    // Upsert: replace if already staged
    const existing = await db
      .select()
      .from(changesetFiles)
      .where(
        and(
          eq(changesetFiles.changesetId, changesetId),
          eq(changesetFiles.filePath, filePath)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const result = await db
        .update(changesetFiles)
        .set({ content, baseVersion, operation })
        .where(eq(changesetFiles.id, existing[0].id))
        .returning();
      return result[0];
    }

    const result = await db
      .insert(changesetFiles)
      .values({ changesetId, filePath, content, baseVersion, operation })
      .returning();

    return result[0];
  }

  async removeFile(changesetId: string, filePath: string): Promise<void> {
    const result = await db
      .delete(changesetFiles)
      .where(
        and(
          eq(changesetFiles.changesetId, changesetId),
          eq(changesetFiles.filePath, filePath)
        )
      )
      .returning();

    if (result.length === 0) {
      throw new NotFoundError("File not found in changeset");
    }
  }

  async submit(changesetId: string): Promise<Changeset> {
    const pgClient = (db as any)._.session.client;

    const result = await pgClient.begin(
      async (tx: any) => {
        // 1. Lock the changeset row
        const [cs] = await tx`
          SELECT * FROM changesets WHERE id = ${changesetId} FOR UPDATE
        `;

        if (!cs) {
          throw new NotFoundError(`Changeset not found: ${changesetId}`);
        }
        if (cs.status !== "open") {
          throw new ValidationError(`Changeset is ${cs.status}, cannot submit`);
        }

        await tx`
          UPDATE changesets SET status = 'validating', submitted_at = now()
          WHERE id = ${changesetId}
        `;

        // 2. Get changeset files
        const csFiles = await tx`
          SELECT * FROM changeset_files WHERE changeset_id = ${changesetId}
        `;

        if (csFiles.length === 0) {
          throw new ValidationError("Changeset has no files");
        }

        // 3. Lock and version-check each file
        const existingPaths = new Set<string>();
        for (const csFile of csFiles) {
          if (csFile.operation === "create") {
            const [existing] = await tx`
              SELECT path, version FROM files WHERE path = ${csFile.file_path} FOR UPDATE
            `;
            if (existing) {
              existingPaths.add(csFile.file_path);
            }
          } else {
            const [existing] = await tx`
              SELECT path, version FROM files WHERE path = ${csFile.file_path} FOR UPDATE
            `;
            if (!existing) {
              await tx`UPDATE changesets SET status = 'failed', validation_errors = ${JSON.stringify([{ stage: 0, message: `File not found: ${csFile.file_path}` }])} WHERE id = ${changesetId}`;
              throw new ConflictError(`File not found: ${csFile.file_path}`);
            }
            existingPaths.add(csFile.file_path);

            if (
              csFile.base_version !== null &&
              existing.version !== csFile.base_version
            ) {
              await tx`UPDATE changesets SET status = 'failed', validation_errors = ${JSON.stringify([{ stage: 0, message: `Version conflict on ${csFile.file_path}: expected ${csFile.base_version}, got ${existing.version}` }])} WHERE id = ${changesetId}`;
              throw new ConflictError("Version conflict", {
                filePath: csFile.file_path,
                expectedVersion: csFile.base_version,
                currentVersion: existing.version,
              });
            }
          }
        }

        // 4. Run validation pipeline
        const typedFiles: ChangesetFile[] = csFiles.map((f: any) => ({
          id: f.id,
          changesetId: f.changeset_id,
          filePath: f.file_path,
          content: f.content,
          baseVersion: f.base_version,
          operation: f.operation,
        }));

        const validationResult = await runValidation(typedFiles, existingPaths);
        if (!validationResult.valid) {
          await tx`
            UPDATE changesets
            SET status = 'failed',
                validation_errors = ${JSON.stringify(validationResult.errors)}
            WHERE id = ${changesetId}
          `;
          throw new ValidationError("Validation failed", validationResult.errors);
        }

        // 5. Apply file changes
        for (const csFile of csFiles) {
          const contentHash = hashContent(csFile.content);

          if (csFile.operation === "create") {
            await tx`
              INSERT INTO files (path, content, content_hash, version, last_modified_by)
              VALUES (${csFile.file_path}, ${csFile.content}, ${contentHash}, 1, ${cs.agent_id})
            `;
          } else if (csFile.operation === "update") {
            await tx`
              UPDATE files
              SET content = ${csFile.content},
                  content_hash = ${contentHash},
                  version = version + 1,
                  last_modified_by = ${cs.agent_id},
                  updated_at = now()
              WHERE path = ${csFile.file_path}
            `;
          } else if (csFile.operation === "delete") {
            await tx`DELETE FROM files WHERE path = ${csFile.file_path}`;
          }
        }

        // 6. Mark committed
        const [committed] = await tx`
          UPDATE changesets
          SET status = 'committed', committed_at = now(), validation_stage = 2
          WHERE id = ${changesetId}
          RETURNING *
        `;

        return committed;
      }
    );

    return {
      id: result.id,
      agentId: result.agent_id,
      status: result.status,
      message: result.message,
      validationStage: result.validation_stage,
      validationErrors: result.validation_errors,
      createdAt: result.created_at,
      submittedAt: result.submitted_at,
      committedAt: result.committed_at,
    };
  }

  async listChangesets(status?: string): Promise<Changeset[]> {
    if (status) {
      return db
        .select()
        .from(changesets)
        .where(eq(changesets.status, status as any));
    }
    return db.select().from(changesets);
  }
}

export const changesetEngine = new ChangesetEngine();
