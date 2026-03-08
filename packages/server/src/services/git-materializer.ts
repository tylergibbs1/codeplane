import * as git from "isomorphic-git";
import * as fs from "node:fs";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { changesets, type Changeset, type ChangesetFile } from "../db/schema";

const repoPath = process.env.GIT_REPO_PATH || "./data/repo";

export class GitMaterializer {
  private initialized = false;
  private queue: Promise<unknown> = Promise.resolve();

  async init(): Promise<void> {
    if (this.initialized) return;

    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
    }

    try {
      await git.resolveRef({ fs, dir: repoPath, ref: "HEAD" });
    } catch {
      await git.init({ fs, dir: repoPath, defaultBranch: "main" });

      const sha = await git.commit({
        fs,
        dir: repoPath,
        message: "Initial commit (CodePlane)",
        author: { name: "CodePlane", email: "codeplane@localhost" },
      });
      console.log(`Git repo initialized at ${repoPath} (${sha})`);
    }

    this.initialized = true;
  }

  /** Enqueue materialization — serializes all git operations */
  materialize(
    changeset: Changeset & { files: ChangesetFile[] }
  ): Promise<string> {
    const task = this.queue.then(() => this._materialize(changeset));
    // Update queue to wait for this task (swallow errors so queue continues)
    this.queue = task.catch(() => {});
    return task;
  }

  private async _materialize(
    changeset: Changeset & { files: ChangesetFile[] }
  ): Promise<string> {
    await this.init();

    for (const f of changeset.files) {
      const filePath = path.join(repoPath, f.filePath);

      if (f.operation === "delete") {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        try {
          await git.remove({ fs, dir: repoPath, filepath: f.filePath });
        } catch {
          // File may not be in index
        }
      } else {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, f.content, "utf-8");
        await git.add({ fs, dir: repoPath, filepath: f.filePath });
      }
    }

    const message = [
      changeset.message || "Changeset commit",
      "",
      `Changeset-ID: ${changeset.id}`,
      `Agent-ID: ${changeset.agentId}`,
      `Files: ${changeset.files.map((f) => f.filePath).join(", ")}`,
    ].join("\n");

    const sha = await git.commit({
      fs,
      dir: repoPath,
      message,
      author: {
        name: changeset.agentId,
        email: `${changeset.agentId}@codeplane`,
      },
    });

    await db
      .update(changesets)
      .set({ gitSha: sha })
      .where(eq(changesets.id, changeset.id));

    console.log(
      `Git commit ${sha.slice(0, 8)} for changeset ${changeset.id.slice(0, 8)}`
    );
    return sha;
  }
}

export const gitMaterializer = new GitMaterializer();
