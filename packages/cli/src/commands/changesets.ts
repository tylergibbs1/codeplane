import type { CodePlaneClient } from "@codeplane/sdk";
import * as fs from "node:fs";

export async function handleChangesets(
  client: CodePlaneClient,
  subcommand: string,
  args: string[]
) {
  switch (subcommand) {
    case "create": {
      const message = args[0];
      const cs = await client.changesets.create(message);
      console.log(`Changeset created: ${cs.id}`);
      break;
    }
    case "get": {
      const id = args[0];
      if (!id) {
        console.error("Usage: codeplane changesets get <id>");
        process.exit(1);
      }
      const cs = await client.changesets.get(id);
      console.log(JSON.stringify(cs, null, 2));
      break;
    }
    case "add-file": {
      const id = args[0];
      const filePath = args[1];
      const contentOrFlag = args[2];
      if (!id || !filePath || !contentOrFlag) {
        console.error("Usage: codeplane changesets add-file <id> <path> <content|--file=path> [--op=create|update|delete]");
        process.exit(1);
      }

      let content: string;
      if (contentOrFlag.startsWith("--file=")) {
        content = fs.readFileSync(contentOrFlag.slice(7), "utf-8");
      } else {
        content = contentOrFlag;
      }

      const opArg = args.find((a) => a.startsWith("--op="));
      const operation = opArg?.split("=")[1] as "create" | "update" | "delete" | undefined;

      await client.changesets.addFile(id, filePath, content, operation);
      console.log(`File ${filePath} added to changeset ${id}`);
      break;
    }
    case "submit": {
      const id = args[0];
      if (!id) {
        console.error("Usage: codeplane changesets submit <id>");
        process.exit(1);
      }
      const cs = await client.changesets.submit(id);
      console.log(`Changeset ${cs.id}: ${cs.status}`);
      if (cs.gitSha) console.log(`Git SHA: ${cs.gitSha}`);
      break;
    }
    case "list": {
      const status = args.find((a) => a.startsWith("--status="))?.split("=")[1];
      const list = await client.changesets.list(status);
      for (const cs of list) {
        console.log(`${cs.id} | ${cs.status} | ${cs.message || "(no message)"}`);
      }
      break;
    }
    default:
      console.error("Usage: codeplane changesets <create|get|add-file|submit|list>");
      process.exit(1);
  }
}
