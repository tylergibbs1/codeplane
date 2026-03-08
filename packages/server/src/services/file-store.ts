import { eq, like, sql, and, desc } from "drizzle-orm";
import { db } from "../db";
import { files, fileVersions, type File, type FileVersion } from "../db/schema";
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
      // Create new file
      const existing = await this.getFile(path);
      if (existing) {
        throw new ConflictError("File already exists. Provide expectedVersion to update.", {
          path,
          currentVersion: existing.version,
        });
      }

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

      // Record version history
      await db.insert(fileVersions).values({
        path,
        version: 1,
        content,
        contentHash,
        modifiedBy: agentId,
      });

      return result[0];
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

    // Record version history
    await db.insert(fileVersions).values({
      path,
      version: result[0].version,
      content,
      contentHash,
      modifiedBy: agentId,
    });

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
  async getHistory(
    path: string,
    limit = 50
  ): Promise<FileVersion[]> {
    return db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.path, path))
      .orderBy(desc(fileVersions.version))
      .limit(limit);
  }

  async getVersion(path: string, version: number): Promise<FileVersion | null> {
    const result = await db
      .select()
      .from(fileVersions)
      .where(
        and(eq(fileVersions.path, path), eq(fileVersions.version, version))
      )
      .limit(1);
    return result[0] ?? null;
  }
}

export const fileStore = new FileStore();
