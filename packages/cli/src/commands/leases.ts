import type { CodePlaneClient } from "@codeplane/sdk";

export async function handleLeases(
  client: CodePlaneClient,
  subcommand: string,
  args: string[]
) {
  switch (subcommand) {
    case "acquire":
    case "lock": {
      const filePath = args[0];
      if (!filePath) die("Usage: codeplane leases acquire <filePath> [--ttl=N] [--intent=...]");

      const ttlArg = args.find((a) => a.startsWith("--ttl="));
      const intentArg = args.find((a) => a.startsWith("--intent="));
      const ttlSeconds = ttlArg ? Number(ttlArg.split("=")[1]) : undefined;
      const intent = intentArg ? intentArg.split("=").slice(1).join("=") : undefined;

      const lease = await client.leases.acquire(filePath, { ttlSeconds, intent });
      console.log(`\x1b[32m✓\x1b[0m Lease acquired`);
      console.log(`  ID:      ${lease.id}`);
      console.log(`  File:    ${lease.filePath}`);
      console.log(`  Expires: ${new Date(lease.expiresAt).toLocaleString()}`);
      break;
    }

    case "release":
    case "unlock": {
      const leaseId = args[0];
      if (!leaseId) die("Usage: codeplane leases release <leaseId>");
      await client.leases.release(leaseId);
      console.log(`\x1b[32m✓\x1b[0m Lease released`);
      break;
    }

    case "check": {
      const filePath = args[0];
      if (!filePath) die("Usage: codeplane leases check <filePath>");
      const lease = await client.leases.check(filePath);
      if (lease) {
        console.log(`\x1b[33m⚠\x1b[0m File is leased`);
        console.log(`  Agent:   ${lease.agentId}`);
        console.log(`  Intent:  ${lease.intent || "(none)"}`);
        console.log(`  Expires: ${new Date(lease.expiresAt).toLocaleString()}`);
        console.log(`  ID:      ${lease.id}`);
      } else {
        console.log(`\x1b[32m✓\x1b[0m File is not leased`);
      }
      break;
    }

    case "list":
    case "ls": {
      const filePath = args[0];
      if (filePath) {
        const lease = await client.leases.check(filePath);
        if (lease) {
          console.log(`  ${lease.id}  ${lease.filePath}  \x1b[2m${lease.agentId}  expires ${new Date(lease.expiresAt).toLocaleString()}\x1b[0m`);
        } else {
          console.log("\x1b[2mNo active lease.\x1b[0m");
        }
      } else {
        console.log("\x1b[2mUse 'codeplane leases check <filePath>' to check a specific file.\x1b[0m");
      }
      break;
    }

    default:
      die("Usage: codeplane leases <acquire|release|check|list>");
  }
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
