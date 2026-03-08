#!/usr/bin/env bun
import { CodePlaneClient } from "@codeplane/sdk";
import { handleFiles } from "./commands/files";
import { handleLeases } from "./commands/leases";
import { handleChangesets } from "./commands/changesets";
import { handleSubscribe } from "./commands/subscribe";

const HELP = `
codeplane — CLI for CodePlane

Usage:
  codeplane <command> [subcommand] [args] [--agent=<id>]

Commands:
  files       get, write, list, delete, history, version
  leases      acquire, release, list
  changesets  create, add-file, submit, get, list
  subscribe   [event-types...]

Global flags:
  --agent=<id>   Agent identity (for multi-agent coordination)

Environment:
  CODEPLANE_URL       Server URL (default: http://localhost:3100)
  CODEPLANE_API_KEY   API key
  CODEPLANE_AGENT     Default agent identity

Examples:
  codeplane files write src/index.ts "export const x = 1;"
  codeplane files write src/app.ts --file=./local/app.ts --version=3
  codeplane files history src/index.ts
  codeplane leases acquire src/index.ts --intent="refactoring"
  codeplane changesets create "Add auth module"
  codeplane subscribe file.* lease.*
`.trim();

// Parse global --agent flag
const args = process.argv.slice(2);
const agentFlag = args.find((a) => a.startsWith("--agent="));
const agentId =
  agentFlag?.split("=").slice(1).join("=") ||
  process.env.CODEPLANE_AGENT;
const filteredArgs = args.filter((a) => !a.startsWith("--agent="));

const [command, subcommand, ...rest] = filteredArgs;

const client = new CodePlaneClient({
  apiKey: process.env.CODEPLANE_API_KEY || "dev-key-change-me",
  agentId,
});

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }

  try {
    switch (command) {
      case "files":
        await handleFiles(client, subcommand, rest);
        break;
      case "leases":
        await handleLeases(client, subcommand, rest);
        break;
      case "changesets":
      case "cs":
        await handleChangesets(client, subcommand, rest);
        break;
      case "subscribe":
      case "sub":
        await handleSubscribe(client, [subcommand, ...rest].filter(Boolean));
        break;
      default:
        console.error(`Unknown command: ${command}\nRun 'codeplane help' for usage.`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`\x1b[31mError:\x1b[0m ${err.message}`);
    if (err.details) {
      console.error(
        `\x1b[2m${JSON.stringify(err.details, null, 2)}\x1b[0m`
      );
    }
    process.exit(1);
  }
}

main();
