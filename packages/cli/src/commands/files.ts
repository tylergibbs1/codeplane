import type { CodePlaneClient } from "@codeplane/sdk";
import * as fs from "node:fs";

export async function handleFiles(
  client: CodePlaneClient,
  subcommand: string,
  args: string[]
) {
  switch (subcommand) {
    case "get": {
      const path = args[0];
      if (!path) {
        console.error("Usage: codeplane files get <path>");
        process.exit(1);
      }
      const file = await client.files.get(path);
      console.log(file.content);
      break;
    }
    case "write": {
      const path = args[0];
      const contentOrFlag = args[1];
      if (!path || !contentOrFlag) {
        console.error("Usage: codeplane files write <path> <content|--file=path> [--version=N]");
        process.exit(1);
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
      console.log(`Written ${file.path} (version ${file.version})`);
      break;
    }
    case "list": {
      const prefix = args[0];
      const files = await client.files.list(prefix);
      for (const f of files) {
        console.log(`${f.path} (v${f.version})`);
      }
      break;
    }
    case "delete": {
      const path = args[0];
      const version = Number(args[1]);
      if (!path || isNaN(version)) {
        console.error("Usage: codeplane files delete <path> <version>");
        process.exit(1);
      }
      await client.files.delete(path, version);
      console.log(`Deleted ${path}`);
      break;
    }
    default:
      console.error("Usage: codeplane files <get|write|list|delete>");
      process.exit(1);
  }
}
