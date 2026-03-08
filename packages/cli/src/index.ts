#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { CodePlaneClient } from "@codeplane/sdk";
import { handleFiles } from "./commands/files";
import { handleLeases } from "./commands/leases";
import { handleChangesets } from "./commands/changesets";
import { handleSubscribe } from "./commands/subscribe";

const baseUrl = process.env.CODEPLANE_URL || "http://localhost:3100";
const apiKey = process.env.CODEPLANE_API_KEY || "dev-key-change-me";

const client = new CodePlaneClient({ baseUrl, apiKey });

const [command, subcommand, ...rest] = process.argv.slice(2);

async function main() {
  if (!command) {
    console.log("Usage: codeplane <command> <subcommand> [args]");
    console.log("Commands: files, leases, changesets, subscribe");
    process.exit(1);
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
        await handleChangesets(client, subcommand, rest);
        break;
      case "subscribe":
        await handleSubscribe(client, rest);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    if (err.details) console.error("Details:", JSON.stringify(err.details, null, 2));
    process.exit(1);
  }
}

main();
