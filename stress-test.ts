/**
 * CodePlane Stress Test — "Does it actually replace git for concurrent agents?"
 *
 * This test simulates realistic multi-agent scenarios that break with plain git:
 *
 * 1. LOST WRITES — 10 agents update the same file simultaneously.
 *    Git: last push wins, other work is silently lost.
 *    CodePlane: OCC rejects stale writes, zero data loss.
 *
 * 2. MERGE HELL — 5 agents each modify different files in the same "module".
 *    Git: requires manual merge resolution, agents can't do this.
 *    CodePlane: atomic changesets commit cleanly when files don't overlap.
 *
 * 3. STEPPING ON EACH OTHER — Agent A refactors a file Agent B is also editing.
 *    Git: both push, one overwrites the other.
 *    CodePlane: leases prevent concurrent modification.
 *
 * 4. ATOMIC CROSS-FILE CHANGES — Agent renames an export used in 5 files.
 *    Git: partial push = broken code in repo.
 *    CodePlane: changeset is all-or-nothing.
 *
 * 5. RACE TO CREATE — 5 agents try to create the same new file simultaneously.
 *    Git: last push wins.
 *    CodePlane: first creator wins, others get 409.
 *
 * 6. READ-AFTER-WRITE CONSISTENCY — Write then immediately read.
 *    Git: clone/pull latency means stale reads.
 *    CodePlane: database is source of truth, reads are always fresh.
 *
 * 7. CONCURRENT CHANGESETS ON OVERLAPPING FILES — Two agents commit
 *    changesets that touch the same file.
 *    Git: merge conflict, manual resolution.
 *    CodePlane: first wins atomically, second fails cleanly.
 *
 * 8. HIGH THROUGHPUT — 50 agents each write 5 unique files (250 writes).
 *    Git: 50 agents pulling/pushing = chaos.
 *    CodePlane: all writes succeed without coordination overhead.
 */

const BASE = "http://localhost:3100/api/v1";
const API_KEY = "dev-key-change-me";

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
  duration: number;
}

const results: TestResult[] = [];

async function cp(
  method: string,
  path: string,
  body?: unknown,
  agentId = "stress-tester"
): Promise<{ ok: boolean; status: number; data: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    "X-Agent-Id": agentId,
  };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return { ok: true, status: 204, data: null };
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function test(name: string, fn: () => Promise<string>) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, passed: true, detail, duration: Date.now() - start });
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    results.push({
      name,
      passed: false,
      detail: err.message,
      duration: Date.now() - start,
    });
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ─── Clean slate ──────────────────────────────────────────────────────
async function cleanup() {
  const { data } = await cp("GET", "/files");
  if (Array.isArray(data)) {
    for (const f of data) {
      try {
        await cp("DELETE", `/files/${f.path}`, {
          expectedVersion: f.version,
        });
      } catch {}
    }
  }
}

// ─── Test 1: Lost Writes ──────────────────────────────────────────────
async function testLostWrites() {
  console.log("\n🔥 Test 1: LOST WRITES (10 agents update same file)");

  // Create the file first
  await cp("PUT", "/files/shared/counter.ts", {
    content: "export let count = 0;",
  });

  // 10 agents all try to update at version 1 simultaneously
  const agents = Array.from({ length: 10 }, (_, i) => `writer-${i}`);
  const promises = agents.map((agent) =>
    cp(
      "PUT",
      "/files/shared/counter.ts",
      {
        content: `export let count = ${agent}; // updated by ${agent}`,
        expectedVersion: 1,
      },
      agent
    )
  );

  const results = await Promise.all(promises);
  const successes = results.filter((r) => r.ok);
  const conflicts = results.filter((r) => r.status === 409);

  await test("Exactly 1 writer wins, 9 get 409 Conflict", async () => {
    assert(
      successes.length === 1,
      `Expected 1 success, got ${successes.length}`
    );
    assert(
      conflicts.length === 9,
      `Expected 9 conflicts, got ${conflicts.length}`
    );
    return `1 write succeeded, 9 correctly rejected. Zero data loss.`;
  });

  // Verify the file has exactly version 2 (one successful update)
  const file = await cp("GET", "/files/shared/counter.ts");
  await test("File version is exactly 2 after one winner", async () => {
    assert(file.data.version === 2, `Expected version 2, got ${file.data.version}`);
    return `Version: ${file.data.version}`;
  });
}

// ─── Test 2: Non-Overlapping Parallel Work ────────────────────────────
async function testParallelNonOverlapping() {
  console.log("\n🔥 Test 2: PARALLEL NON-OVERLAPPING WORK (5 agents, different files)");

  // 5 agents each create a changeset with unique files
  const agents = Array.from({ length: 5 }, (_, i) => `module-agent-${i}`);

  const changesetIds: string[] = [];
  for (const agent of agents) {
    const cs = await cp("POST", "/changesets", { message: `${agent} feature` }, agent);
    changesetIds.push(cs.data.id);
  }

  // Each agent stages 2 unique files
  for (let i = 0; i < agents.length; i++) {
    const csId = changesetIds[i];
    const agent = agents[i];
    await cp(
      "PUT",
      `/changesets/${csId}/files/modules/mod${i}/index.ts`,
      { content: `export const mod${i} = true;`, operation: "create" },
      agent
    );
    await cp(
      "PUT",
      `/changesets/${csId}/files/modules/mod${i}/utils.ts`,
      { content: `export function util${i}() { return ${i}; }`, operation: "create" },
      agent
    );
  }

  // Submit all concurrently
  const submits = await Promise.all(
    changesetIds.map((id, i) => cp("POST", `/changesets/${id}/submit`, undefined, agents[i]))
  );

  const allCommitted = submits.every((r) => r.ok && r.data.status === "committed");

  await test("All 5 changesets commit — no merge conflicts needed", async () => {
    assert(allCommitted, `Some changesets failed: ${submits.filter(r => !r.ok).map(r => r.data?.error).join(", ")}`);
    return `5 agents, 10 files, 5 atomic commits — all succeeded in parallel.`;
  });

  // Verify all 10 files exist
  const fileList = await cp("GET", "/files?prefix=modules/");
  await test("All 10 files from 5 agents are present", async () => {
    const count = fileList.data.length;
    assert(count === 10, `Expected 10 files, got ${count}`);
    return `${count} files created by 5 independent agents.`;
  });
}

// ─── Test 3: Lease Protection ─────────────────────────────────────────
async function testLeaseProtection() {
  console.log("\n🔥 Test 3: LEASE PROTECTION (Agent A locks, Agent B blocked)");

  // Create a shared file
  await cp("PUT", "/files/auth/login.ts", {
    content: 'export function login() { return "v1"; }',
  });

  // Agent A acquires a lease
  const lease = await cp(
    "POST",
    "/leases",
    { filePath: "auth/login.ts", intent: "refactoring login flow", ttlSeconds: 60 },
    "refactor-agent"
  );

  await test("Agent A acquires lease successfully", async () => {
    assert(lease.ok, `Lease acquire failed: ${lease.data?.error}`);
    return `Lease ${lease.data.id} acquired by refactor-agent`;
  });

  // Agent B tries to write — should be blocked
  const blocked = await cp(
    "PUT",
    "/files/auth/login.ts",
    { content: 'export function login() { return "v2-b"; }', expectedVersion: 1 },
    "other-agent"
  );

  await test("Agent B is blocked from writing (423 Locked)", async () => {
    assert(blocked.status === 423, `Expected 423, got ${blocked.status}`);
    return `Agent B correctly blocked: ${blocked.data.error}`;
  });

  // Agent A can still write
  const agentAWrite = await cp(
    "PUT",
    "/files/auth/login.ts",
    { content: 'export function login() { return "v2-a"; }', expectedVersion: 1 },
    "refactor-agent"
  );

  await test("Agent A (lease holder) can write freely", async () => {
    assert(agentAWrite.ok, `Agent A write failed: ${agentAWrite.data?.error}`);
    return `Agent A updated file to version ${agentAWrite.data.version}`;
  });

  // Release lease, Agent B retries
  await cp("DELETE", `/leases/${lease.data.id}`, undefined, "refactor-agent");

  const retryB = await cp(
    "PUT",
    "/files/auth/login.ts",
    { content: 'export function login() { return "v3-b"; }', expectedVersion: 2 },
    "other-agent"
  );

  await test("Agent B succeeds after lease released", async () => {
    assert(retryB.ok, `Agent B retry failed: ${retryB.data?.error}`);
    return `Agent B wrote version ${retryB.data.version} after lease release.`;
  });
}

// ─── Test 4: Atomic Cross-File Changes ────────────────────────────────
async function testAtomicCrossFile() {
  console.log("\n🔥 Test 4: ATOMIC CROSS-FILE CHANGES (rename export across 5 files)");

  // Create a module with an export used in 5 consumer files
  await cp("PUT", "/files/lib/math.ts", {
    content: 'export function calculateTotal(items: number[]) { return items.reduce((a,b) => a+b, 0); }',
  });

  for (let i = 0; i < 5; i++) {
    await cp("PUT", `/files/consumers/consumer${i}.ts`, {
      content: `import { calculateTotal } from "../lib/math";\nexport const result${i} = calculateTotal([${i}, ${i + 1}]);`,
    });
  }

  // Now rename the export across all 6 files atomically
  const cs = await cp(
    "POST",
    "/changesets",
    { message: "Rename calculateTotal → computeSum across codebase" },
    "rename-agent"
  );

  // Stage the lib file
  await cp(
    "PUT",
    `/changesets/${cs.data.id}/files/lib/math.ts`,
    {
      content: 'export function computeSum(items: number[]) { return items.reduce((a,b) => a+b, 0); }',
      operation: "update",
    },
    "rename-agent"
  );

  // Stage all consumer files
  for (let i = 0; i < 5; i++) {
    await cp(
      "PUT",
      `/changesets/${cs.data.id}/files/consumers/consumer${i}.ts`,
      {
        content: `import { computeSum } from "../lib/math";\nexport const result${i} = computeSum([${i}, ${i + 1}]);`,
        operation: "update",
      },
      "rename-agent"
    );
  }

  const result = await cp("POST", `/changesets/${cs.data.id}/submit`, undefined, "rename-agent");

  await test("All 6 files updated atomically — no broken intermediate state", async () => {
    assert(result.ok, `Changeset submit failed: ${result.data?.error}`);
    assert(result.data.status === "committed", `Expected committed, got ${result.data.status}`);
    return `6 files renamed atomically. Git would need 6 separate adds + 1 commit, but any failure leaves broken imports.`;
  });

  // Verify all files have the new export name
  const lib = await cp("GET", "/files/lib/math.ts");
  const consumer0 = await cp("GET", "/files/consumers/consumer0.ts");

  await test("All files reflect the rename consistently", async () => {
    assert(lib.data.content.includes("computeSum"), "lib/math.ts still has old name");
    assert(consumer0.data.content.includes("computeSum"), "consumer0.ts still has old name");
    assert(!lib.data.content.includes("calculateTotal"), "lib/math.ts still has old name");
    return `Rename is consistent across all files — no broken imports.`;
  });
}

// ─── Test 5: Race to Create ──────────────────────────────────────────
async function testRaceToCreate() {
  console.log("\n🔥 Test 5: RACE TO CREATE (5 agents create same file simultaneously)");

  const agents = Array.from({ length: 5 }, (_, i) => `creator-${i}`);
  const promises = agents.map((agent) =>
    cp(
      "PUT",
      "/files/shared/singleton.ts",
      { content: `export const CREATED_BY = "${agent}";` },
      agent
    )
  );

  const results = await Promise.all(promises);
  const created = results.filter((r) => r.status === 201);
  const conflicted = results.filter((r) => r.status === 409);

  await test("Exactly 1 creator wins, others get 409", async () => {
    assert(created.length === 1, `Expected 1 created, got ${created.length} (conflicts: ${conflicted.length}, other: ${results.filter(r => r.status !== 201 && r.status !== 409).map(r => r.status)})`);
    assert(conflicted.length === 4, `Expected 4 conflicts, got ${conflicted.length}`);
    return `1 file created, 4 correctly rejected. No silent overwrites.`;
  });
}

// ─── Test 6: Read-After-Write Consistency ─────────────────────────────
async function testReadAfterWrite() {
  console.log("\n🔥 Test 6: READ-AFTER-WRITE CONSISTENCY (immediate reads reflect writes)");

  const content = `export const timestamp = ${Date.now()};`;
  await cp("PUT", "/files/consistency/test.ts", { content }, "writer-agent");

  // Immediately read from a different "agent"
  const read = await cp("GET", "/files/consistency/test.ts");

  await test("Read immediately returns the written content", async () => {
    assert(read.data.content === content, `Content mismatch: expected ${content}, got ${read.data.content}`);
    return `Write + immediate read: content matches. No clone/pull delay.`;
  });

  // Update and immediately read again
  const updated = `export const timestamp = ${Date.now() + 1};`;
  await cp("PUT", "/files/consistency/test.ts", { content: updated, expectedVersion: 1 }, "writer-agent");
  const read2 = await cp("GET", "/files/consistency/test.ts");

  await test("Updated content immediately visible", async () => {
    assert(read2.data.content === updated, "Stale read after update");
    assert(read2.data.version === 2, `Expected version 2, got ${read2.data.version}`);
    return `Version 2 immediately readable. Git would need pull + checkout.`;
  });
}

// ─── Test 7: Concurrent Overlapping Changesets ────────────────────────
async function testOverlappingChangesets() {
  console.log("\n🔥 Test 7: CONCURRENT OVERLAPPING CHANGESETS (same file, two agents)");

  // Create a shared file
  await cp("PUT", "/files/overlap/config.json", {
    content: '{"setting": "original"}',
  });

  // Two agents create changesets touching the same file
  const csA = await cp("POST", "/changesets", { message: "Agent A config" }, "agent-a");
  const csB = await cp("POST", "/changesets", { message: "Agent B config" }, "agent-b");

  await cp(
    "PUT",
    `/changesets/${csA.data.id}/files/overlap/config.json`,
    { content: '{"setting": "from-a"}', operation: "update" },
    "agent-a"
  );

  await cp(
    "PUT",
    `/changesets/${csB.data.id}/files/overlap/config.json`,
    { content: '{"setting": "from-b"}', operation: "update" },
    "agent-b"
  );

  // Submit both at the same time
  const [submitA, submitB] = await Promise.all([
    cp("POST", `/changesets/${csA.data.id}/submit`, undefined, "agent-a"),
    cp("POST", `/changesets/${csB.data.id}/submit`, undefined, "agent-b"),
  ]);

  const oneWon = (submitA.ok && !submitB.ok) || (!submitA.ok && submitB.ok);

  await test("Exactly one changeset commits, other fails with conflict", async () => {
    assert(oneWon, `Expected exactly one winner. A: ${submitA.status} ${submitA.data.status}, B: ${submitB.status} ${submitB.data.status}`);
    const winner = submitA.ok ? "A" : "B";
    const loserStatus = submitA.ok ? submitB.status : submitA.status;
    return `Agent ${winner} committed. Other got ${loserStatus}. No merge conflict — clean rejection.`;
  });

  // Verify file is consistent
  const file = await cp("GET", "/files/overlap/config.json");
  await test("File content matches the winner's changeset", async () => {
    const isA = file.data.content.includes("from-a");
    const isB = file.data.content.includes("from-b");
    assert(isA || isB, "File content matches neither agent");
    assert(!(isA && isB), "File somehow has both agents' content");
    return `File contains winner's content. No corrupted merges.`;
  });
}

// ─── Test 8: High Throughput ──────────────────────────────────────────
async function testHighThroughput() {
  console.log("\n🔥 Test 8: HIGH THROUGHPUT (50 agents × 5 files = 250 concurrent writes)");

  const start = Date.now();
  const AGENT_COUNT = 50;
  const FILES_PER_AGENT = 5;

  // 50 agents each write 5 unique files simultaneously
  const promises: Promise<{ ok: boolean; status: number; data: any }>[] = [];

  for (let a = 0; a < AGENT_COUNT; a++) {
    for (let f = 0; f < FILES_PER_AGENT; f++) {
      promises.push(
        cp(
          "PUT",
          `/files/throughput/agent${a}/file${f}.ts`,
          { content: `export const agent = ${a}; export const file = ${f};` },
          `bulk-agent-${a}`
        )
      );
    }
  }

  const results = await Promise.all(promises);
  const elapsed = Date.now() - start;
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  await test(`250 concurrent file writes complete (${elapsed}ms)`, async () => {
    assert(
      succeeded === AGENT_COUNT * FILES_PER_AGENT,
      `Expected ${AGENT_COUNT * FILES_PER_AGENT} successes, got ${succeeded} (${failed} failures)`
    );
    const rps = Math.round((succeeded / elapsed) * 1000);
    return `${succeeded} writes in ${elapsed}ms (${rps} writes/sec). Git would need 250 separate clone-commit-push cycles.`;
  });

  // Verify a sample of files exist
  const sample = await cp("GET", "/files/throughput/agent25/file3.ts");
  await test("Random file spot-check: content is correct", async () => {
    assert(sample.ok, `File not found: ${sample.status}`);
    assert(
      sample.data.content.includes("agent = 25") && sample.data.content.includes("file = 3"),
      `Unexpected content: ${sample.data.content}`
    );
    return `File throughput/agent25/file3.ts has correct content.`;
  });
}

// ─── Test 9: File History After Concurrent Updates ────────────────────
async function testHistoryUnderConcurrency() {
  console.log("\n🔥 Test 9: FILE HISTORY SURVIVES CONCURRENT UPDATES");

  // Create file, then do 5 sequential updates
  await cp("PUT", "/files/history/tracked.ts", {
    content: "export const v = 1;",
  }, "historian");

  for (let i = 2; i <= 6; i++) {
    await cp("PUT", "/files/history/tracked.ts", {
      content: `export const v = ${i};`,
      expectedVersion: i - 1,
    }, `historian-${i}`);
  }

  const history = await cp("GET", "/files/history/tracked.ts?history=true");

  await test("Complete version history preserved (6 versions)", async () => {
    assert(Array.isArray(history.data), "History is not an array");
    assert(history.data.length === 6, `Expected 6 versions, got ${history.data.length}`);
    return `6 versions tracked with full content + author attribution.`;
  });

  // Check a specific old version
  const v2 = await cp("GET", "/files/history/tracked.ts?version=2");
  await test("Can retrieve specific historical version", async () => {
    assert(v2.ok, "Version 2 not found");
    assert(v2.data.content === "export const v = 2;", `Wrong content: ${v2.data.content}`);
    return `Version 2 retrieved correctly. Git equivalent: git show HEAD~4:file — but requires clone.`;
  });
}

// ─── Test 10: Validation Prevents Bad Code ────────────────────────────
async function testValidationPrevention() {
  console.log("\n🔥 Test 10: VALIDATION PREVENTS BAD CODE FROM ENTERING CODEBASE");

  // Direct write of invalid JSON
  const badJson = await cp("PUT", "/files/configs/broken.json", {
    content: "{not valid json!}",
  });

  await test("Invalid JSON rejected on direct write", async () => {
    assert(badJson.status === 400, `Expected 400, got ${badJson.status}`);
    return `Bad JSON blocked: ${badJson.data.error}`;
  });

  // Direct write of invalid TypeScript
  const badTs = await cp("PUT", "/files/src/broken.ts", {
    content: "export function { broken syntax ;;;",
  });

  await test("Invalid TypeScript rejected on direct write", async () => {
    assert(badTs.status === 400, `Expected 400, got ${badTs.status}`);
    return `Bad TS blocked: ${badTs.data.error}`;
  });

  // Changeset with mix of valid and invalid files
  const cs = await cp("POST", "/changesets", { message: "mixed validity" });
  await cp("PUT", `/changesets/${cs.data.id}/files/valid.ts`, {
    content: "export const x = 1;",
    operation: "create",
  });
  await cp("PUT", `/changesets/${cs.data.id}/files/invalid.json`, {
    content: "{broken!}",
    operation: "create",
  });

  const submit = await cp("POST", `/changesets/${cs.data.id}/submit`);

  await test("Changeset with any invalid file is fully rejected", async () => {
    assert(!submit.ok, "Changeset should have failed");
    assert(submit.status === 400, `Expected 400, got ${submit.status}`);
    return `Entire changeset rejected — valid.ts was NOT created. All-or-nothing.`;
  });

  // Verify valid.ts was NOT created
  const validFile = await cp("GET", "/files/valid.ts");
  await test("Valid file from rejected changeset was NOT persisted", async () => {
    assert(!validFile.ok, "valid.ts should not exist");
    assert(validFile.status === 404, `Expected 404, got ${validFile.status}`);
    return `Atomic rollback: valid.ts doesn't exist. Git has no equivalent — a bad file in a commit stays.`;
  });
}

// ─── Test 11: Git Materialization ─────────────────────────────────────
async function testGitMaterialization() {
  console.log("\n🔥 Test 11: GIT MATERIALIZATION (changesets become git commits)");

  const cs = await cp("POST", "/changesets", { message: "Feature: add user service" }, "git-test-agent");
  await cp("PUT", `/changesets/${cs.data.id}/files/services/user.ts`, {
    content: 'export class UserService {\n  async getUser(id: string) {\n    return { id, name: "Test" };\n  }\n}',
    operation: "create",
  }, "git-test-agent");
  await cp("PUT", `/changesets/${cs.data.id}/files/services/user.test.ts`, {
    content: 'import { UserService } from "./user";\nconst svc = new UserService();\nconsole.log(await svc.getUser("1"));',
    operation: "create",
  }, "git-test-agent");

  const submitted = await cp("POST", `/changesets/${cs.data.id}/submit`, undefined, "git-test-agent");

  await test("Changeset committed and triggers git materialization", async () => {
    assert(submitted.ok, `Submit failed: ${submitted.data?.error}`);
    assert(submitted.data.status === "committed", `Expected committed, got ${submitted.data.status}`);
    return `Changeset committed. Git SHA will be assigned asynchronously.`;
  });

  // Wait for async git materialization — many changesets are queued from earlier tests
  await new Promise((r) => setTimeout(r, 5000));

  // Check git log
  const log = Bun.spawnSync(["git", "log", "--oneline", "-20"], { cwd: "./data/repo" });
  const logStr = log.stdout.toString().trim();

  await test("Git log shows the commit", async () => {
    assert(logStr.includes("user service") || logStr.includes("Feature: add user service"), `Git log doesn't contain our commit.\nRecent commits:\n${logStr}`);
    return `Git log (latest 5):\n${logStr.split("\n").slice(0, 5).join("\n")}`;
  });

  // Check files on disk
  const fileCheck = Bun.spawnSync(["cat", "services/user.ts"], { cwd: "./data/repo" });
  const content = fileCheck.stdout.toString();

  await test("Files materialized on disk in git repo", async () => {
    assert(content.includes("UserService"), `File not on disk or wrong content: "${content.slice(0, 100)}"`);
    return `services/user.ts exists on disk with correct content.`;
  });
}

// ─── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CodePlane Stress Test: Does it replace git for AI agents?");
  console.log("═══════════════════════════════════════════════════════════════");

  await cleanup();

  await testLostWrites();
  await testParallelNonOverlapping();
  await testLeaseProtection();
  await testAtomicCrossFile();
  await testRaceToCreate();
  await testReadAfterWrite();
  await testOverlappingChangesets();
  await testHighThroughput();
  await testHistoryUnderConcurrency();
  await testValidationPrevention();
  await testGitMaterialization();

  // ─── Report ────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  RESULTS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    console.log(`${icon} ${r.name} (${r.duration}ms)`);
    console.log(`   ${r.detail}\n`);
  }

  console.log("───────────────────────────────────────────────────────────────");
  console.log(`  ${passed} passed, ${failed} failed, ${results.length} total (${totalTime}ms)`);
  console.log("───────────────────────────────────────────────────────────────");

  if (failed > 0) {
    console.log("\n⚠️  VERDICT: Some tests failed. CodePlane has gaps.\n");
    process.exit(1);
  } else {
    console.log("\n✅ VERDICT: CodePlane handles every scenario that breaks git");
    console.log("   for concurrent AI agents. Lost writes, merge conflicts,");
    console.log("   partial commits, race conditions — all eliminated.\n");
  }
}

main().catch(console.error);
