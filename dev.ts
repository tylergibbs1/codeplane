#!/usr/bin/env bun
/**
 * CodePlane dev — one command to go from zero to running server.
 *
 *   bun run dev
 *
 * Automatically runs setup (postgres, env, schema) if needed,
 * then starts the server with hot reload.
 */

import { $ } from "bun";
import { existsSync } from "node:fs";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function log(icon: string, msg: string) {
  console.log(`  ${icon} ${msg}`);
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await $`which ${cmd}`.quiet();
    return true;
  } catch {
    return false;
  }
}

async function isPostgresReady(): Promise<boolean> {
  try {
    await $`docker compose exec -T postgres pg_isready -U codeplane`.quiet();
    return true;
  } catch {
    return false;
  }
}

async function waitForPostgres(maxWaitSec = 30): Promise<boolean> {
  for (let i = 0; i < maxWaitSec; i++) {
    if (await isPostgresReady()) return true;
    await Bun.sleep(1000);
  }
  return false;
}

async function ensureReady() {
  // Quick check: if postgres is running and .env exists, skip setup
  if (existsSync(".env") && existsSync("node_modules") && await isPostgresReady()) {
    return;
  }

  console.log(`\n${bold("CodePlane")} — setting up...\n`);

  // Check Docker
  if (!await commandExists("docker")) {
    log(red("✗"), "Docker required for PostgreSQL. Install Docker or OrbStack.");
    process.exit(1);
  }

  // Install deps
  if (!existsSync("node_modules")) {
    log("○", "Installing dependencies...");
    await $`bun install`.quiet();
    log(green("✓"), "Dependencies installed");
  }

  // Create .env
  if (!existsSync(".env")) {
    const apiKey = `cp_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    await Bun.write(".env", [
      `DATABASE_URL=postgres://codeplane:codeplane@localhost:5432/codeplane`,
      `API_KEY=${apiKey}`,
      `PORT=3100`,
    ].join("\n") + "\n");
    log(green("✓"), `Created .env ${dim(`(API key: ${apiKey})`)}`);
  }

  // Load env
  const envFile = await Bun.file(".env").text();
  for (const line of envFile.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }

  // Start Postgres
  if (!await isPostgresReady()) {
    log("○", "Starting PostgreSQL...");
    await $`docker compose up -d`.quiet();
    if (!await waitForPostgres()) {
      log(red("✗"), "PostgreSQL failed to start. Check `docker compose logs`.");
      process.exit(1);
    }
    log(green("✓"), "PostgreSQL ready");
  }

  // Push schema
  log("○", "Syncing database schema...");
  await $`cd packages/server && bunx drizzle-kit push --force`.quiet().env({
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL!,
  });
  log(green("✓"), "Schema synced");
  console.log("");
}

async function main() {
  await ensureReady();

  // Load env for the server process
  if (!process.env.DATABASE_URL) {
    const envFile = await Bun.file(".env").text();
    for (const line of envFile.split("\n")) {
      const [key, ...rest] = line.split("=");
      if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
    }
  }

  const port = process.env.PORT || "3100";
  const apiKey = process.env.API_KEY || "dev-key-change-me";

  console.log(`${bold("CodePlane")} ${dim(`v0.1.0`)}`);
  console.log(`${dim("→")} http://localhost:${port}`);
  console.log(`${dim("→")} API key: ${apiKey}`);
  console.log(`${dim("→")} Press Ctrl+C to stop\n`);

  // Start server with hot reload
  await $`bun --watch packages/server/src/index.ts`.env(process.env);
}

main().catch((err) => {
  console.error(`${red("Error:")} ${err.message}`);
  process.exit(1);
});
