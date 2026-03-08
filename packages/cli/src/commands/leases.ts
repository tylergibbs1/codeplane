import type { CodePlaneClient } from "@codeplane/sdk";

export async function handleLeases(
  client: CodePlaneClient,
  subcommand: string,
  args: string[]
) {
  switch (subcommand) {
    case "acquire": {
      const filePath = args[0];
      if (!filePath) {
        console.error("Usage: codeplane leases acquire <filePath> [--ttl=N] [--intent=...]");
        process.exit(1);
      }
      const ttlArg = args.find((a) => a.startsWith("--ttl="));
      const intentArg = args.find((a) => a.startsWith("--intent="));
      const ttl = ttlArg ? Number(ttlArg.split("=")[1]) : undefined;
      const intent = intentArg ? intentArg.split("=").slice(1).join("=") : undefined;

      const lease = await client.leases.acquire(filePath, ttl, intent);
      console.log(`Lease acquired: ${lease.id}`);
      console.log(`  File: ${lease.filePath}`);
      console.log(`  Expires: ${lease.expiresAt}`);
      break;
    }
    case "release": {
      const leaseId = args[0];
      if (!leaseId) {
        console.error("Usage: codeplane leases release <leaseId>");
        process.exit(1);
      }
      await client.leases.release(leaseId);
      console.log("Lease released");
      break;
    }
    case "list": {
      const filePath = args[0];
      const lease = filePath ? await client.leases.check(filePath) : null;
      if (lease) {
        console.log(`${lease.id} | ${lease.filePath} | ${lease.agentId} | expires ${lease.expiresAt}`);
      } else if (filePath) {
        console.log("No active lease");
      }
      break;
    }
    default:
      console.error("Usage: codeplane leases <acquire|release|list>");
      process.exit(1);
  }
}
