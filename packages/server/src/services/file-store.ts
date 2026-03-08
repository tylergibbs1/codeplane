import { eq, like, sql } from "drizzle-orm";
import { db } from "../db";
import { files, type File } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";

function hashContent(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export class FileStore {
  async getFile(path: string): Promise<File | null> {
    const result = await db
      .select()
      .from(files)
      .where(eq(files.path, path))
      .limit(1);
    return result[0] ?? null;
  }

  async writeFile(
    path: string,
    content: string,
    agentId: string,
    expectedVersion?: number
  ): Promise<File> {
    const contentHash = hashContent(content);

    if (expectedVersion === undefined) {
      // Create new file — use INSERT with PK conflict handling for race safety
      try {
        const result = await db
          .insert(files)
          .values({
            path,
            content,
            contentHash,
            lastModifiedBy: agentId,
            version: 1,
          })
          .returning();

        return result[0];
      } catch (err: any) {
        const pgCode = err.code ?? err.cause?.code ?? err.constraint_name;
        if (pgCode === "23505" || err.message?.includes("duplicate key") || err.message?.includes("unique constraint")) {
          const existing = await this.getFile(path);
          throw new ConflictError("File already exists. Provide expectedVersion to update.", {
            path,
            currentVersion: existing?.version,
          });
        }
        throw err;
      }
    }

    // Update existing file with OCC
    const result = await db
      .update(files)
      .set({
        content,
        contentHash,
        lastModifiedBy: agentId,
        version: sql`${files.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        sql`${files.path} = ${path} AND ${files.version} = ${expectedVersion}`
      )
      .returning();

    if (result.length === 0) {
      const current = await this.getFile(path);
      if (!current) {
        throw new NotFoundError(`File not found: ${path}`);
      }
      throw new ConflictError("Version conflict", {
        path,
        expectedVersion,
        currentVersion: current.version,
      });
    }

    return result[0];
  }

  async listFiles(prefix?: string): Promise<File[]> {
    if (prefix) {
      return db
        .select()
        .from(files)
        .where(like(files.path, `${prefix}%`));
    }
    return db.select().from(files);
  }

  async deleteFile(
    path: string,
    expectedVersion: number,
    agentId: string
  ): Promise<void> {
    const result = await db
      .delete(files)
      .where(
        sql`${files.path} = ${path} AND ${files.version} = ${expectedVersion}`
      )
      .returning();

    if (result.length === 0) {
      const current = await this.getFile(path);
      if (!current) {
        throw new NotFoundError(`File not found: ${path}`);
      }
      throw new ConflictError("Version conflict", {
        path,
        expectedVersion,
        currentVersion: current.version,
      });
    }
  }
}

export const fileStore = new FileStore();
