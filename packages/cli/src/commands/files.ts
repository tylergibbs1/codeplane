import type { CodePlaneClient } from "@codeplane/sdk";
import * as fs from "node:fs";

export async function handleFiles(
  client: CodePlaneClient,
  subcommand: string,
  args: string[]
) {
  switch (subcommand) {
    case "get":
    case "read":
    case "cat": {
      const path = args[0];
      if (!path) die("Usage: codeplane files get <path>");
      const file = await client.files.get(path);
      console.log(file.content);
      break;
    }

    case "write":
    case "put": {
      const path = args[0];
      const contentOrFlag = args[1];
      if (!path || !contentOrFlag) {
        die("Usage: codeplane files write <path> <content|--file=./local> [--version=N]");
      }

      let content: string;
      if (contentOrFlag.startsWith("--file=")) {
        content = fs.readFileSync(contentOrFlag.slice(7), "utf-8");
      } else {
        content = contentOrFlag;
      }

      const versionArg = args.find((a) => a.startsWith("--version="));
      const expectedVersion = versionArg
        ? Number(versionArg.split("=")[1])
        : undefined;

      const file = await client.files.write(path, content, expectedVersion);
      console.log(
        `\x1b[32m✓\x1b[0m ${file.path} \x1b[2m(v${file.version})\x1b[0m`
      );
      break;
    }

    case "list":
    case "ls": {
      const prefix = args[0];
      const files = await client.files.list(prefix);
      if (files.length === 0) {
        console.log("\x1b[2mNo files found.\x1b[0m");
        break;
      }
      for (const f of files) {
        console.log(
          `  ${f.path}  \x1b[2mv${f.version}  ${f.lastModifiedBy || ""}\x1b[0m`
        );
      }
      console.log(`\n\x1b[2m${files.length} file(s)\x1b[0m`);
      break;
    }

    case "delete":
    case "rm": {
      const path = args[0];
      const version = Number(args[1]);
      if (!path || isNaN(version)) {
        die("Usage: codeplane files delete <path> <version>");
      }
      await client.files.delete(path, version);
      console.log(`\x1b[32m✓\x1b[0m Deleted ${path}`);
      break;
    }

    case "history":
    case "log": {
      const path = args[0];
      if (!path) die("Usage: codeplane files history <path>");
      const limitArg = args.find((a) => a.startsWith("--limit="));
      const limit = limitArg ? Number(limitArg.split("=")[1]) : 20;
      const history = await client.files.history(path, limit);
      if (history.length === 0) {
        console.log("\x1b[2mNo history found.\x1b[0m");
        break;
      }
      for (const v of history) {
        const date = new Date(v.createdAt).toLocaleString();
        console.log(
          `  \x1b[33mv${v.version}\x1b[0m  ${date}  \x1b[2m${v.modifiedBy || "unknown"}\x1b[0m  ${v.contentHash.slice(0, 8)}…`
        );
      }
      break;
    }

    case "version": {
      const path = args[0];
      const version = Number(args[1]);
      if (!path || isNaN(version)) {
        die("Usage: codeplane files version <path> <version>");
      }
      const v = await client.files.version(path, version);
      console.log(v.content);
      break;
    }

    case "diff": {
      const path = args[0];
      const v1 = Number(args[1]);
      const v2 = Number(args[2]);
      if (!path || isNaN(v1) || isNaN(v2)) {
        die("Usage: codeplane files diff <path> <version1> <version2>");
      }
      const [a, b] = await Promise.all([
        client.files.version(path, v1),
        client.files.version(path, v2),
      ]);
      const linesA = a.content.split("\n");
      const linesB = b.content.split("\n");
      console.log(`\x1b[2m--- v${v1}\x1b[0m`);
      console.log(`\x1b[2m+++ v${v2}\x1b[0m`);
      const maxLines = Math.max(linesA.length, linesB.length);
      for (let i = 0; i < maxLines; i++) {
        if (linesA[i] !== linesB[i]) {
          if (linesA[i] !== undefined) console.log(`\x1b[31m- ${linesA[i]}\x1b[0m`);
          if (linesB[i] !== undefined) console.log(`\x1b[32m+ ${linesB[i]}\x1b[0m`);
        }
      }
      break;
    }

    default:
      die("Usage: codeplane files <get|write|list|delete|history|version|diff>");
  }
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
