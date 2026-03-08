import type { CodePlaneClient } from "@codeplane/sdk";
import * as fs from "node:fs";

export async function handleChangesets(
  client: CodePlaneClient,
  subcommand: string,
  args: string[]
) {
  switch (subcommand) {
    case "create":
    case "new": {
      const message = args[0];
      const cs = await client.changesets.create(message);
      console.log(`\x1b[32m✓\x1b[0m Changeset created: \x1b[1m${cs.id}\x1b[0m`);
      break;
    }

    case "get":
    case "show": {
      const id = args[0];
      if (!id) die("Usage: codeplane changesets get <id>");
      const cs = await client.changesets.get(id);
      console.log(`  ID:      ${cs.id}`);
      console.log(`  Status:  ${statusColor(cs.status)}`);
      console.log(`  Agent:   ${cs.agentId}`);
      console.log(`  Message: ${cs.message || "(none)"}`);
      if (cs.gitSha) console.log(`  Git SHA: ${cs.gitSha.slice(0, 8)}`);
      if (cs.files && cs.files.length > 0) {
        console.log(`  Files:`);
        for (const f of cs.files) {
          const op = { create: "+", update: "~", delete: "-" }[f.operation] || "?";
          console.log(`    ${op} ${f.filePath}`);
        }
      }
      break;
    }

    case "add-file":
    case "stage": {
      const id = args[0];
      const filePath = args[1];
      const contentOrFlag = args[2];
      if (!id || !filePath || !contentOrFlag) {
        die("Usage: codeplane changesets add-file <id> <path> <content|--file=path> [--op=create|update|delete]");
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
      console.log(`\x1b[32m✓\x1b[0m Staged ${filePath}`);
      break;
    }

    case "submit":
    case "commit": {
      const id = args[0];
      if (!id) die("Usage: codeplane changesets submit <id>");
      const cs = await client.changesets.submit(id);
      console.log(`\x1b[32m✓\x1b[0m ${statusColor(cs.status)}`);
      if (cs.gitSha) console.log(`  Git SHA: ${cs.gitSha.slice(0, 8)}`);
      break;
    }

    case "list":
    case "ls": {
      const statusArg = args.find((a) => a.startsWith("--status="))?.split("=")[1];
      const list = await client.changesets.list(statusArg);
      if (list.length === 0) {
        console.log("\x1b[2mNo changesets found.\x1b[0m");
        break;
      }
      for (const cs of list) {
        const sha = cs.gitSha ? ` ${cs.gitSha.slice(0, 8)}` : "";
        console.log(
          `  ${cs.id.slice(0, 8)}…  ${statusColor(cs.status)}  \x1b[2m${cs.agentId}${sha}\x1b[0m  ${cs.message || ""}`
        );
      }
      console.log(`\n\x1b[2m${list.length} changeset(s)\x1b[0m`);
      break;
    }

    default:
      die("Usage: codeplane changesets <create|get|add-file|submit|list>");
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "committed": return `\x1b[32m${status}\x1b[0m`;
    case "failed":    return `\x1b[31m${status}\x1b[0m`;
    case "open":      return `\x1b[36m${status}\x1b[0m`;
    case "validating": return `\x1b[33m${status}\x1b[0m`;
    default:          return status;
  }
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
