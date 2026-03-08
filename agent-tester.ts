import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const BASE = process.env.CODEPLANE_URL || "http://localhost:3100";
const API_KEY = process.env.CODEPLANE_API_KEY || process.env.API_KEY || "dev-key-change-me";

// --- HTTP helper ---
async function cp(
  method: string,
  path: string,
  body?: unknown,
  agentId = "claude-tester"
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    "X-Agent-Id": agentId,
  };
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return JSON.stringify({ ok: true, status: 204 });
  const data = await res.json();
  return JSON.stringify({ ok: res.ok, status: res.status, ...data }, null, 2);
}

// --- Tool definitions ---
const tools: Anthropic.Tool[] = [
  {
    name: "codeplane_write_file",
    description:
      "Write or update a file in CodePlane. Omit expectedVersion to create a new file.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path, e.g. src/index.ts" },
        content: { type: "string", description: "Full file content" },
        expectedVersion: {
          type: "number",
          description: "Current version for OCC update. Omit to create.",
        },
        agentId: {
          type: "string",
          description: "Agent identity (default: claude-tester)",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "codeplane_read_file",
    description: "Read a file from CodePlane. Returns content, version, and metadata.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path to read" },
      },
      required: ["path"],
    },
  },
  {
    name: "codeplane_list_files",
    description: "List all files in CodePlane, optionally filtered by prefix",
    input_schema: {
      type: "object" as const,
      properties: {
        prefix: { type: "string", description: "Path prefix filter" },
      },
      required: [],
    },
  },
  {
    name: "codeplane_delete_file",
    description: "Delete a file from CodePlane (requires current version for OCC)",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path" },
        expectedVersion: { type: "number", description: "Current version" },
        agentId: { type: "string" },
      },
      required: ["path", "expectedVersion"],
    },
  },
  {
    name: "codeplane_acquire_lease",
    description:
      "Acquire an exclusive lease on a file. Other agents get 423 Locked until released or expired.",
    input_schema: {
      type: "object" as const,
      properties: {
        filePath: { type: "string", description: "File path to lease" },
        ttlSeconds: { type: "number", description: "Lease TTL in seconds (default 300)" },
        intent: { type: "string", description: "What you plan to do" },
        agentId: { type: "string" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "codeplane_release_lease",
    description: "Release a file lease",
    input_schema: {
      type: "object" as const,
      properties: {
        leaseId: { type: "string", description: "Lease ID" },
        agentId: { type: "string" },
      },
      required: ["leaseId"],
    },
  },
  {
    name: "codeplane_create_changeset",
    description: "Create a new changeset for staging atomic multi-file changes",
    input_schema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "Commit message" },
        agentId: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "codeplane_add_file_to_changeset",
    description: "Stage a file in a changeset",
    input_schema: {
      type: "object" as const,
      properties: {
        changesetId: { type: "string" },
        filePath: { type: "string" },
        content: { type: "string" },
        operation: {
          type: "string",
          enum: ["create", "update", "delete"],
          description: "Default: update",
        },
        agentId: { type: "string" },
      },
      required: ["changesetId", "filePath", "content"],
    },
  },
  {
    name: "codeplane_submit_changeset",
    description:
      "Submit changeset for atomic commit. Checks versions, commits atomically — all files succeed or all fail.",
    input_schema: {
      type: "object" as const,
      properties: {
        changesetId: { type: "string" },
        agentId: { type: "string" },
      },
      required: ["changesetId"],
    },
  },
  {
    name: "codeplane_get_changeset",
    description: "Get changeset details including staged files and status",
    input_schema: {
      type: "object" as const,
      properties: {
        changesetId: { type: "string" },
      },
      required: ["changesetId"],
    },
  },
];

// --- Tool execution ---
async function executeTool(name: string, input: any): Promise<string> {
  switch (name) {
    case "codeplane_write_file":
      return cp(
        "PUT",
        `/files/${input.path}`,
        {
          content: input.content,
          expectedVersion: input.expectedVersion,
        },
        input.agentId
      );
    case "codeplane_read_file":
      return cp("GET", `/files/${input.path}`);
    case "codeplane_list_files": {
      const q = input.prefix
        ? `?prefix=${encodeURIComponent(input.prefix)}`
        : "";
      return cp("GET", `/files${q}`);
    }
    case "codeplane_delete_file":
      return cp(
        "DELETE",
        `/files/${input.path}`,
        { expectedVersion: input.expectedVersion },
        input.agentId
      );
    case "codeplane_acquire_lease":
      return cp(
        "POST",
        "/leases",
        {
          filePath: input.filePath,
          ttlSeconds: input.ttlSeconds,
          intent: input.intent,
        },
        input.agentId
      );
    case "codeplane_release_lease":
      return cp("DELETE", `/leases/${input.leaseId}`, undefined, input.agentId);
    case "codeplane_create_changeset":
      return cp(
        "POST",
        "/changesets",
        { message: input.message },
        input.agentId
      );
    case "codeplane_add_file_to_changeset":
      return cp(
        "PUT",
        `/changesets/${input.changesetId}/files/${input.filePath}`,
        { content: input.content, operation: input.operation },
        input.agentId
      );
    case "codeplane_submit_changeset":
      return cp(
        "POST",
        `/changesets/${input.changesetId}/submit`,
        undefined,
        input.agentId
      );
    case "codeplane_get_changeset":
      return cp("GET", `/changesets/${input.changesetId}`);
    default:
      return `Unknown tool: ${name}`;
  }
}

// --- Agentic loop ---
const SYSTEM = `You are a QA agent testing CodePlane — a transactional code coordination layer for AI agents.

CodePlane provides three primitives that git doesn't have:
1. Optimistic Concurrency Control — every file has a version, stale writes get 409 Conflict
2. File Leases — advisory exclusive locks with TTL, per agent identity (423 Locked)
3. Atomic Changesets — stage multiple files, submit atomically (all succeed or all fail)

You have tools to interact with a running CodePlane server. Your job is to thoroughly test it.

Run these test categories:

1. **Basic CRUD**: Create, read, update, delete files. Verify versions increment correctly.
2. **OCC conflicts**: Update with stale version → expect 409. Try to create a file that already exists → expect 409.
3. **Multi-agent leases**: Acquire lease as agent-a, try to write as agent-b → expect 423. Release, retry → success.
4. **Atomic changesets**: Create changeset, stage 2-3 files, submit. Verify all files exist with correct content.
5. **Changeset conflicts**: Two changesets touching same file, second submit should fail with version conflict.
6. **Edge cases**: Empty content, nested paths, special chars in content, large content.

Use the agentId parameter to simulate different agents (e.g., "agent-a", "agent-b").

After all tests, write a structured report:
- Category name
- Test description
- Expected result
- Actual result
- PASS or FAIL

Be systematic. Test one thing at a time. Report every result.`;

async function main() {
  console.log("Starting CodePlane QA Agent\n");

  // Load API key from env
  const envFile = await Bun.file(".env").text();
  for (const line of envFile.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "Run a comprehensive test suite against the CodePlane server. Test every category systematically. Use unique file paths with a 'qa/' prefix so you don't collide with existing data.",
    },
  ];

  let turns = 0;
  const MAX_TURNS = 50;

  while (turns < MAX_TURNS) {
    turns++;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM,
      tools,
      messages,
    });

    // Print any text blocks
    for (const block of response.content) {
      if (block.type === "text") {
        console.log(block.text);
      }
    }

    if (response.stop_reason === "end_turn") {
      console.log(`\n(Agent finished after ${turns} turns)`);
      break;
    }

    if (response.stop_reason !== "tool_use") {
      console.log(`\n(Stopped: ${response.stop_reason} after ${turns} turns)`);
      break;
    }

    // Execute tool calls
    const toolBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolBlocks) {
      const shortName = tool.name.replace("codeplane_", "");
      const inputSummary = JSON.stringify(tool.input).slice(0, 100);
      console.log(`  → ${shortName} ${inputSummary}`);

      const result = await executeTool(tool.name, tool.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (turns >= MAX_TURNS) {
    console.log(`\n(Hit max turns: ${MAX_TURNS})`);
  }
}

main().catch(console.error);
