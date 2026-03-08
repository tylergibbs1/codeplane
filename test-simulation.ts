/**
 * Multi-Agent Simulation: Does CodePlane actually solve the coordination problem?
 *
 * Scenario: 3 AI agents are working on the same codebase concurrently.
 *   - Agent A: Building an auth module (auth.ts, types.ts)
 *   - Agent B: Building an API layer that imports from auth (api.ts, types.ts)
 *   - Agent C: Building a utils module (utils.ts) — no conflicts expected
 *
 * What we're testing:
 *   1. Can agents work concurrently without stepping on each other?
 *   2. Do leases prevent conflicting writes to shared files (types.ts)?
 *   3. Does OCC catch stale writes when leases aren't used?
 *   4. Do changesets provide atomic multi-file commits?
 *   5. Does the git history come out clean?
 *   6. Do WebSocket events actually propagate between agents?
 */

const BASE = "http://localhost:3100/api/v1";
const API_KEY = "dev-key-change-me";

async function req(
  method: string,
  path: string,
  body?: unknown,
  agentId?: string
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
  if (agentId) {
    headers["X-Agent-Id"] = agentId;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) return { _error: true, status: res.status, ...data };
  return data;
}

function log(agent: string, msg: string) {
  const colors: Record<string, string> = {
    A: "\x1b[36m",
    B: "\x1b[33m",
    C: "\x1b[32m",
    SYS: "\x1b[90m",
  };
  const reset = "\x1b[0m";
  console.log(`${colors[agent] || ""}[Agent ${agent}]${reset} ${msg}`);
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    failed++;
  }
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log(" CodePlane Multi-Agent Simulation");
  console.log("=".repeat(70) + "\n");

  // ─────────────────────────────────────────────────────────
  // TEST 1: Independent agents can work in parallel
  // ─────────────────────────────────────────────────────────
  console.log("── Test 1: Independent agents work in parallel ──\n");

  const [resultA, resultC] = await Promise.all([
    (async () => {
      log("A", "Creating auth module via changeset...");
      const cs = await req(
        "POST",
        "/changesets",
        { message: "Agent A: Add auth module" },
        "agent-a"
      );
      await req(
        "PUT",
        `/changesets/${cs.id}/files/src/auth/login.ts`,
        {
          content: `import { User } from "../types";\n\nexport async function login(email: string, password: string): Promise<User> {\n  // TODO: implement\n  return { id: "1", email, role: "user" };\n}\n`,
          operation: "create",
        },
        "agent-a"
      );
      await req(
        "PUT",
        `/changesets/${cs.id}/files/src/types.ts`,
        {
          content: `export interface User {\n  id: string;\n  email: string;\n  role: "admin" | "user";\n}\n\nexport interface AuthToken {\n  token: string;\n  expiresAt: number;\n}\n`,
          operation: "create",
        },
        "agent-a"
      );
      const result = await req(
        "POST",
        `/changesets/${cs.id}/submit`,
        undefined,
        "agent-a"
      );
      log("A", `Changeset ${result.status}: ${result.id?.slice(0, 8)}`);
      return result;
    })(),
    (async () => {
      log("C", "Creating utils module via changeset...");
      const cs = await req(
        "POST",
        "/changesets",
        { message: "Agent C: Add utils module" },
        "agent-c"
      );
      await req(
        "PUT",
        `/changesets/${cs.id}/files/src/utils/hash.ts`,
        {
          content: `export function sha256(input: string): string {\n  const hasher = new Bun.CryptoHasher("sha256");\n  hasher.update(input);\n  return hasher.digest("hex");\n}\n`,
          operation: "create",
        },
        "agent-c"
      );
      await req(
        "PUT",
        `/changesets/${cs.id}/files/src/utils/validate.ts`,
        {
          content: `export function isEmail(s: string): boolean {\n  return /^[^@]+@[^@]+\\.[^@]+$/.test(s);\n}\n\nexport function isStrongPassword(s: string): boolean {\n  return s.length >= 8 && /[A-Z]/.test(s) && /[0-9]/.test(s);\n}\n`,
          operation: "create",
        },
        "agent-c"
      );
      const result = await req(
        "POST",
        `/changesets/${cs.id}/submit`,
        undefined,
        "agent-c"
      );
      log("C", `Changeset ${result.status}: ${result.id?.slice(0, 8)}`);
      return result;
    })(),
  ]);

  assert(resultA.status === "committed", "Agent A committed auth module");
  assert(resultC.status === "committed", "Agent C committed utils module");

  const authFile = await req("GET", "/files/src/auth/login.ts", undefined, "agent-a");
  const utilsFile = await req("GET", "/files/src/utils/hash.ts", undefined, "agent-c");
  assert(authFile.version === 1, "auth/login.ts at version 1");
  assert(utilsFile.version === 1, "utils/hash.ts at version 1");

  // ─────────────────────────────────────────────────────────
  // TEST 2: Conflicting writes on shared file (types.ts)
  // ─────────────────────────────────────────────────────────
  console.log("\n── Test 2: Conflicting writes on shared file ──\n");

  const typesFile = await req("GET", "/files/src/types.ts", undefined, "agent-a");
  log("SYS", `types.ts is at version ${typesFile.version}`);

  // Agent A modifies types.ts (adds Session interface)
  const csA2 = await req(
    "POST",
    "/changesets",
    { message: "Agent A: Add Session type" },
    "agent-a"
  );
  await req(
    "PUT",
    `/changesets/${csA2.id}/files/src/types.ts`,
    {
      content:
        typesFile.content +
        `\nexport interface Session {\n  userId: string;\n  token: AuthToken;\n  createdAt: number;\n}\n`,
    },
    "agent-a"
  );

  // Agent B also modifies types.ts (adds ApiResponse interface) — based on same version
  const csB1 = await req(
    "POST",
    "/changesets",
    { message: "Agent B: Add ApiResponse type" },
    "agent-b"
  );
  await req(
    "PUT",
    `/changesets/${csB1.id}/files/src/types.ts`,
    {
      content:
        typesFile.content +
        `\nexport interface ApiResponse<T> {\n  data: T;\n  error?: string;\n  status: number;\n}\n`,
    },
    "agent-b"
  );

  // Agent A submits first
  const resultA2 = await req(
    "POST",
    `/changesets/${csA2.id}/submit`,
    undefined,
    "agent-a"
  );
  log("A", `Submit: ${resultA2.status}`);
  assert(resultA2.status === "committed", "Agent A's types.ts update committed");

  // Agent B submits second — should FAIL (version conflict)
  const resultB1 = await req(
    "POST",
    `/changesets/${csB1.id}/submit`,
    undefined,
    "agent-b"
  );
  log(
    "B",
    `Submit: ${resultB1._error ? "REJECTED" : resultB1.status} — ${resultB1.error || "ok"}`
  );
  assert(
    resultB1._error && resultB1.status === 409,
    "Agent B's conflicting write rejected with 409"
  );

  // ─────────────────────────────────────────────────────────
  // TEST 3: Agent B retries after rebasing on new version
  // ─────────────────────────────────────────────────────────
  console.log("\n── Test 3: Agent B rebases and retries ──\n");

  const typesV2 = await req("GET", "/files/src/types.ts", undefined, "agent-b");
  log("B", `Re-read types.ts: now at version ${typesV2.version}`);
  assert(
    typesV2.version === 2,
    "types.ts advanced to version 2 after Agent A's commit"
  );

  const csB2 = await req(
    "POST",
    "/changesets",
    { message: "Agent B: Add ApiResponse type (rebased)" },
    "agent-b"
  );
  await req(
    "PUT",
    `/changesets/${csB2.id}/files/src/types.ts`,
    {
      content:
        typesV2.content +
        `\nexport interface ApiResponse<T> {\n  data: T;\n  error?: string;\n  status: number;\n}\n`,
    },
    "agent-b"
  );
  await req(
    "PUT",
    `/changesets/${csB2.id}/files/src/api/routes.ts`,
    {
      content: `import { User, ApiResponse } from "../types";\n\nexport function handleGetUser(id: string): ApiResponse<User> {\n  return { data: { id, email: "test@test.com", role: "user" }, status: 200 };\n}\n`,
      operation: "create",
    },
    "agent-b"
  );

  const resultB2 = await req(
    "POST",
    `/changesets/${csB2.id}/submit`,
    undefined,
    "agent-b"
  );
  log("B", `Retry submit: ${resultB2.status}`);
  assert(resultB2.status === "committed", "Agent B's rebased changeset committed");

  // ─────────────────────────────────────────────────────────
  // TEST 4: Leases prevent conflicting writes proactively
  // ─────────────────────────────────────────────────────────
  console.log("\n── Test 4: Leases prevent conflicts proactively ──\n");

  // Agent A acquires a lease on types.ts
  const lease = await req(
    "POST",
    "/leases",
    { filePath: "src/types.ts", ttlSeconds: 30, intent: "Adding Permission type" },
    "agent-a"
  );
  log("A", `Acquired lease: ${lease.id?.slice(0, 8)}`);
  assert(!lease._error, "Agent A acquired lease on types.ts");

  // Agent B tries to directly write to types.ts — should be BLOCKED (423)
  const directWrite = await req(
    "PUT",
    "/files/src/types.ts",
    { content: "// Agent B trying to write while leased", expectedVersion: 3 },
    "agent-b" // Different agent!
  );
  log(
    "B",
    `Direct write while leased: ${directWrite?._error ? `BLOCKED (${directWrite.status})` : "allowed"}`
  );
  assert(
    directWrite?._error && directWrite.status === 423,
    "Agent B blocked by Agent A's lease (423 Locked)"
  );

  // Agent A can still write (lease holder)
  const typesV3 = await req("GET", "/files/src/types.ts", undefined, "agent-a");
  const leaseHolderWrite = await req(
    "PUT",
    "/files/src/types.ts",
    {
      content:
        typesV3.content +
        `\nexport type Permission = "read" | "write" | "admin";\n`,
      expectedVersion: typesV3.version,
    },
    "agent-a"
  );
  log("A", `Write as lease holder: ${leaseHolderWrite?._error ? "FAILED" : `v${leaseHolderWrite.version}`}`);
  assert(!leaseHolderWrite?._error, "Agent A (lease holder) can still write");

  // Release the lease
  await req("DELETE", `/leases/${lease.id}`, undefined, "agent-a");
  log("A", "Released lease");

  const leaseCheckResult = await req("GET", "/leases?filePath=src/types.ts");
  assert(
    Array.isArray(leaseCheckResult) && leaseCheckResult.length === 0,
    "Lease properly released"
  );

  // ─────────────────────────────────────────────────────────
  // TEST 5: Validation catches bad code
  // ─────────────────────────────────────────────────────────
  console.log("\n── Test 5: Validation catches bad code ──\n");

  // Invalid TypeScript
  const csBad = await req(
    "POST",
    "/changesets",
    { message: "Broken code" },
    "agent-b"
  );
  await req(
    "PUT",
    `/changesets/${csBad.id}/files/src/broken.ts`,
    { content: `export function broken( { return "missing paren"; }`, operation: "create" },
    "agent-b"
  );
  const badResult = await req(
    "POST",
    `/changesets/${csBad.id}/submit`,
    undefined,
    "agent-b"
  );
  log("B", `Bad TS: ${badResult._error ? "REJECTED" : badResult.status}`);
  assert(badResult._error && badResult.status === 400, "Invalid TypeScript rejected");

  // Invalid JSON
  const csBadJson = await req(
    "POST",
    "/changesets",
    { message: "Bad config" },
    "agent-c"
  );
  await req(
    "PUT",
    `/changesets/${csBadJson.id}/files/tsconfig.app.json`,
    { content: `{ "compilerOptions": { "strict": true, }`, operation: "create" },
    "agent-c"
  );
  const badJsonResult = await req(
    "POST",
    `/changesets/${csBadJson.id}/submit`,
    undefined,
    "agent-c"
  );
  log("C", `Bad JSON: ${badJsonResult._error ? "REJECTED" : badJsonResult.status}`);
  assert(badJsonResult._error && badJsonResult.status === 400, "Invalid JSON rejected");

  // Path traversal
  const csEvil = await req("POST", "/changesets", { message: "Evil" }, "agent-evil");
  await req(
    "PUT",
    `/changesets/${csEvil.id}/files/src/..%2F..%2Fetc%2Fshadow`,
    { content: "pwned", operation: "create" },
    "agent-evil"
  );
  const evilResult = await req(
    "POST",
    `/changesets/${csEvil.id}/submit`,
    undefined,
    "agent-evil"
  );
  log("SYS", `Path traversal: ${evilResult._error ? `REJECTED (${evilResult.status})` : "submitted"}`);
  assert(evilResult._error === true, "Path traversal attempt rejected");

  // ─────────────────────────────────────────────────────────
  // TEST 6: Atomic multi-file changeset — all or nothing
  // ─────────────────────────────────────────────────────────
  console.log("\n── Test 6: Atomic changeset — all or nothing ──\n");

  const typesNow = await req("GET", "/files/src/types.ts", undefined, "agent-a");

  const csAtomic = await req(
    "POST",
    "/changesets",
    { message: "Agent A: Add middleware + update types" },
    "agent-a"
  );
  await req(
    "PUT",
    `/changesets/${csAtomic.id}/files/src/types.ts`,
    {
      content:
        typesNow.content +
        `\nexport interface Middleware {\n  name: string;\n  handler: (req: unknown) => Promise<unknown>;\n}\n`,
    },
    "agent-a"
  );
  await req(
    "PUT",
    `/changesets/${csAtomic.id}/files/src/middleware/auth.ts`,
    {
      content: `import { Middleware, AuthToken } from "../types";\n\nexport const authMiddleware: Middleware = {\n  name: "auth",\n  handler: async (req) => {\n    // verify token\n    return req;\n  },\n};\n`,
      operation: "create",
    },
    "agent-a"
  );

  const atomicResult = await req(
    "POST",
    `/changesets/${csAtomic.id}/submit`,
    undefined,
    "agent-a"
  );
  assert(atomicResult.status === "committed", "Multi-file changeset committed atomically");

  const typesAfter = await req("GET", "/files/src/types.ts", undefined, "agent-a");
  const middlewareFile = await req("GET", "/files/src/middleware/auth.ts", undefined, "agent-a");
  assert(typesAfter.content.includes("Middleware"), "types.ts includes Middleware interface");
  assert(middlewareFile.content.includes("authMiddleware"), "middleware/auth.ts created");

  // ─────────────────────────────────────────────────────────
  // TEST 7: Git history is clean and meaningful
  // ─────────────────────────────────────────────────────────
  console.log("\n── Test 7: Git history ──\n");

  await new Promise((r) => setTimeout(r, 2000));

  const gitLog = Bun.spawnSync(["git", "log", "--oneline"], {
    cwd: "./data/repo",
  });
  const logOutput = gitLog.stdout.toString().trim();
  const commits = logOutput.split("\n");
  console.log("  Git log:");
  for (const line of commits) {
    console.log(`    ${line}`);
  }

  assert(commits.length >= 5, `Git has ${commits.length} commits (expected ≥5)`);
  assert(
    commits.some((c) => c.includes("Agent A: Add auth module")),
    "Git log contains Agent A's auth commit"
  );
  assert(
    commits.some((c) => c.includes("Agent C: Add utils module")),
    "Git log contains Agent C's utils commit"
  );
  assert(
    commits.some((c) => c.includes("Agent B: Add ApiResponse type (rebased)")),
    "Git log contains Agent B's rebased commit"
  );

  // Check git blame shows different agents
  const blame = Bun.spawnSync(["git", "log", "--format=%an | %s"], {
    cwd: "./data/repo",
  });
  console.log("\n  Git authors:");
  for (const line of blame.stdout.toString().trim().split("\n")) {
    console.log(`    ${line}`);
  }

  const diskCheck = Bun.spawnSync(["find", "src", "-name", "*.ts", "-type", "f"], {
    cwd: "./data/repo",
  });
  const diskFiles = diskCheck.stdout.toString().trim().split("\n").sort();
  console.log("\n  Files on disk:");
  for (const f of diskFiles) {
    console.log(`    ${f}`);
  }
  assert(diskFiles.length >= 5, `${diskFiles.length} files on disk (expected ≥5)`);

  // ─────────────────────────────────────────────────────────
  // TEST 8: Final working state integrity
  // ─────────────────────────────────────────────────────────
  console.log("\n── Test 8: Complete working state ──\n");

  const allFiles = await req("GET", "/files", undefined, "agent-a");
  console.log("  Files in CodePlane DB:");
  for (const f of allFiles) {
    console.log(`    ${f.path} (v${f.version})`);
  }
  assert(allFiles.length >= 5, `${allFiles.length} files tracked (expected ≥5)`);

  // Verify types.ts accumulated all agent contributions
  const finalTypes = await req("GET", "/files/src/types.ts", undefined, "agent-a");
  assert(finalTypes.content.includes("User"), "types.ts has User (Agent A)");
  assert(finalTypes.content.includes("AuthToken"), "types.ts has AuthToken (Agent A)");
  assert(finalTypes.content.includes("Session"), "types.ts has Session (Agent A, round 2)");
  assert(finalTypes.content.includes("ApiResponse"), "types.ts has ApiResponse (Agent B)");
  assert(finalTypes.content.includes("Permission"), "types.ts has Permission (Agent A, via lease)");
  assert(finalTypes.content.includes("Middleware"), "types.ts has Middleware (Agent A, atomic)");

  // ─────────────────────────────────────────────────────────
  // TEST 9: Concurrent changeset race condition
  // ─────────────────────────────────────────────────────────
  console.log("\n── Test 9: Race condition — simultaneous submits ──\n");

  const utilsFile2 = await req("GET", "/files/src/utils/hash.ts", undefined, "agent-a");

  const [raceA, raceB] = await Promise.all([
    (async () => {
      const cs = await req("POST", "/changesets", { message: "Race A" }, "agent-a");
      await req(
        "PUT",
        `/changesets/${cs.id}/files/src/utils/hash.ts`,
        { content: utilsFile2.content + "\n// Agent A was here\n" },
        "agent-a"
      );
      return req("POST", `/changesets/${cs.id}/submit`, undefined, "agent-a");
    })(),
    (async () => {
      const cs = await req("POST", "/changesets", { message: "Race B" }, "agent-b");
      await req(
        "PUT",
        `/changesets/${cs.id}/files/src/utils/hash.ts`,
        { content: utilsFile2.content + "\n// Agent B was here\n" },
        "agent-b"
      );
      return req("POST", `/changesets/${cs.id}/submit`, undefined, "agent-b");
    })(),
  ]);

  const oneWon = raceA.status === "committed" || raceB.status === "committed";
  const oneLost =
    (raceA._error && raceA.status === 409) ||
    (raceB._error && raceB.status === 409);

  log("A", `Race: ${raceA._error ? `REJECTED (${raceA.status})` : raceA.status}`);
  log("B", `Race: ${raceB._error ? `REJECTED (${raceB.status})` : raceB.status}`);

  assert(oneWon, "One agent won the race");
  assert(oneLost, "Other agent correctly rejected (no data corruption)");

  // ─────────────────────────────────────────────────────────
  // TEST 10: WebSocket event delivery
  // ─────────────────────────────────────────────────────────
  console.log("\n── Test 10: WebSocket event delivery ──\n");

  const events: any[] = [];
  const ws = new WebSocket("ws://localhost:3100/api/v1/subscribe");

  await new Promise<void>((resolve) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: "subscribe", types: ["file.*", "changeset.*"] }));
      // Wait for subscription confirmation
      setTimeout(resolve, 200);
    };
  });

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data as string);
    if (data.type !== "subscribed") events.push(data);
  };

  // Trigger a file write that should produce an event
  await req(
    "PUT",
    "/files/src/ws-test.ts",
    { content: "// websocket test file" },
    "agent-a"
  );

  // Wait for event delivery
  await new Promise((r) => setTimeout(r, 500));
  ws.close();

  log("SYS", `Received ${events.length} WebSocket event(s)`);
  if (events.length > 0) {
    for (const e of events) {
      log("SYS", `  → ${e.type}: ${JSON.stringify(e.data)}`);
    }
  }
  assert(events.length > 0, "WebSocket received file change event");
  assert(
    events.some((e) => e.type === "file.created" && e.data?.path === "src/ws-test.ts"),
    "Event correctly identifies file path and type"
  );

  // ─────────────────────────────────────────────────────────
  // RESULTS
  // ─────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log(
    ` Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`
  );
  console.log("=".repeat(70) + "\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Simulation crashed:", err);
  process.exit(1);
});
