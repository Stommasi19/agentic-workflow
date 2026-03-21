# Autonomous Codex Worker

> Fully automated dialogue between Claude Code and Codex via the agentic-bridge. Codex runs as a headless thinking partner — reads code for context, responds with analysis and pseudocode, never modifies files.

## Problem

The agentic-bridge is store-and-forward: messages persist in SQLite, but neither agent polls automatically. Every exchange requires the user to manually switch terminals and tell each agent to check for messages. This makes multi-agent dialogue impractical, especially when Claude Code subagents need Codex input.

## Solution

A Node.js worker orchestrator that:
1. Polls the bridge for unread messages addressed to its auto-generated worker ID
2. Spawns a dedicated Codex process per conversation (isolated context)
3. Routes messages to the correct Codex process
4. Uses exponential backoff when idle, resets on activity
5. Caps concurrent Codex processes, queues overflow
6. Kills idle Codex processes after a TTL

Plus supporting infrastructure:
- Desktop notifications via SSE watcher
- Claude Code hook for auto-checking after subagent completions
- Peek endpoint for checking unread count without consuming messages

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where it lives | `mcp-bridge/src/worker.ts` | Shares types and DbClient, avoids duplication |
| Worker identity | Auto-generated `codex-worker-{4 hex}` | Differentiates sessions without manual naming |
| Polling | Exponential backoff 5s→1hr, reset on message | Token-efficient during idle, responsive during activity |
| Context isolation | One Codex process per conversation | Zero context bleed between concurrent dialogues |
| Concurrent cap | 3 workers, configurable | Prevents resource exhaustion from burst conversations |
| Idle TTL | 10 minutes, configurable | Frees slots for queued conversations |
| Working directory | Required `working_dir` field on `assign_task` | Worker must know which repo to reason about |
| Codex mode | `--full-auto` but read-only prompt | Can read code for context, responds only via bridge |
| Schema change | Direct update, wipe DB | No production data to migrate |

## Schema Change

Add `working_dir` column to the `tasks` table:

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  conversation TEXT NOT NULL,
  domain TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT NOT NULL,
  analysis TEXT,
  assigned_to TEXT,
  working_dir TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','in_progress','completed','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`working_dir` is nullable in the schema (not all tasks target a worker), but the worker orchestrator rejects tasks without it — sends a `failed` status back via the bridge.

Cascading type changes:
- `TaskRow.working_dir: string | null`
- `assign_task` MCP tool and REST endpoint gain optional `working_dir` Zod param
- `insertTask` prepared statement includes `working_dir`
- Delete `bridge.db` to recreate with new schema

## Worker Orchestrator

### Entry point

`mcp-bridge/src/worker.ts` → `dist/worker.js`

### State model

```typescript
interface WorkerPool {
  workerId: string;                              // "codex-worker-" + 4 hex chars
  maxConcurrent: number;                         // env: WORKER_MAX_CONCURRENT (default 3)
  idleTtlMs: number;                             // env: WORKER_IDLE_TTL (default 600_000)
  pollFloorMs: number;                           // env: WORKER_POLL_FLOOR (default 5_000)
  pollCeilingMs: number;                         // env: WORKER_POLL_CEILING (default 3_600_000)
  active: Map<string, ConversationWorker>;       // keyed by conversation UUID
  queue: string[];                               // conversation UUIDs waiting for a slot
}

interface ConversationWorker {
  conversationId: string;
  codexProcess: ChildProcess;
  lastActivityAt: number;                        // epoch ms, reset on each message
  workingDir: string;                            // from task.working_dir
}
```

### Poll loop

```
currentInterval = pollFloor

loop forever:
  messages = db.getUnreadMessages(workerId)

  if messages.length > 0:
    currentInterval = pollFloor                  // reset backoff
    group messages by conversation UUID

    for each conversation:
      if conversation in active:
        forward messages to its Codex process
        update lastActivityAt
      else if active.size < maxConcurrent:
        find task for this conversation (get task from message payload)
        reject if task.working_dir is missing (report_status with failed)
        spawn ConversationWorker with cwd = task.working_dir
        forward messages
      else:
        add conversation to queue (deduplicated)
  else:
    currentInterval = min(currentInterval * 2, pollCeiling)

  // reap idle workers
  for each active worker:
    if now - worker.lastActivityAt > idleTtl:
      kill worker, remove from active
      if queue is not empty:
        spawn next queued conversation

  sleep(currentInterval)
```

### Backoff curve

5s → 10s → 20s → 40s → 80s → 160s → 320s → 640s → 1280s → 2560s → 3600s (cap)

Reaches the 1-hour ceiling in ~10 empty polls (~90 minutes of silence). Resets to 5s on any message.

### Codex spawning

Each `ConversationWorker` spawns:

```bash
codex --full-auto --quiet \
  --prompt "<system prompt>"
```

With `cwd` set to `task.working_dir`:

```typescript
spawn("codex", [...args], {
  cwd: task.working_dir
});
```

System prompt for each worker:

```
You are a thinking partner in a dialogue via the agentic-bridge.
Your worker ID is {workerId}.
Conversation: {conversationId}.

You MUST NOT modify any files or run destructive commands.
You read code for context and respond with analysis,
suggestions, and pseudocode only.

Use the agentic-bridge report_status tool to send responses.
Use get_messages to read conversation history.

Process the message you've been given and respond via the bridge.
```

## Peek Endpoint

### REST: `GET /messages/peek`

Query params: `recipient` (string, required)

Response:
```json
{
  "ok": true,
  "data": { "count": 3 }
}
```

No side effects — does not mark messages as read.

### MCP tool: `peek_unread`

Same logic, exposed over stdio transport.

### Implementation

New prepared statement in `DbClient`:

```sql
SELECT COUNT(*) as count FROM messages
WHERE recipient = @recipient AND read_at IS NULL
```

New service: `peekUnreadCount(db, recipient): AppResult<{ count: number }>`

## Desktop Notifications

### Entry point

`mcp-bridge/src/notify.ts` → `dist/notify.js`

### Behavior

- Connects to `http://localhost:3100/events` SSE stream
- On `message:created`: macOS notification with sender, recipient, payload preview (80 chars)
- On `task:created`: macOS notification with domain, summary, assigned_to
- Auto-reconnects on connection drop
- No polling, no tokens — purely event-driven

### Notification format

```
Title: "Bridge: message for {recipient}"
Body:  "{sender}: {payload first 80 chars}"
```

```
Title: "Bridge: task for {assigned_to}"
Body:  "{domain}: {summary}"
```

Uses `osascript` for macOS notifications — no external dependencies.

Dependency: `eventsource` npm package (or Node 22 native `EventSource` if available).

## Claude Code Hook

### Script: `mcp-bridge/scripts/check-bridge.sh`

```bash
#!/usr/bin/env bash
count=$(curl -sf 'http://localhost:3100/messages/peek?recipient=claude-code' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log(r.data?.count??0)})")

if [ "$count" -gt 0 ]; then
  echo "You have $count unread message(s) on the agentic-bridge. Use get_unread to read them."
fi
```

Hits the peek endpoint (not unread) — no race condition, messages stay unconsumed until Claude Code explicitly calls `get_unread`.

Fires as a `PostToolUse` hook after `Agent` tool calls complete.

## Start Script

`start.sh` enhanced with two additional background processes:

```bash
echo "Starting MCP bridge on :3100..."
(cd "$BRIDGE_DIR" && npm start) &

echo "Starting UI dashboard on :3000..."
(cd "$UI_DIR" && npm run dev) &

echo "Starting Codex worker..."
(cd "$BRIDGE_DIR" && node dist/worker.js) &

echo "Starting desktop notifications..."
node "$BRIDGE_DIR/dist/notify.js" &

wait
```

Existing `cleanup()` trap (`kill 0`) handles shutdown of all processes including spawned Codex instances.

Worker logs its identity on startup:
```
Codex worker started: codex-worker-a3f2
Polling interval: 5s–3600s (exponential backoff)
Max concurrent: 3, idle TTL: 10m
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_MAX_CONCURRENT` | `3` | Max simultaneous Codex processes |
| `WORKER_IDLE_TTL` | `600000` | Ms before idle worker is killed |
| `WORKER_POLL_FLOOR` | `5000` | Fastest poll interval (ms) |
| `WORKER_POLL_CEILING` | `3600000` | Slowest poll interval (ms) |

## File Changes

### New files

| File | Purpose |
|------|---------|
| `mcp-bridge/src/worker.ts` | Worker orchestrator — poll loop, process pool, backoff |
| `mcp-bridge/src/notify.ts` | SSE watcher — macOS desktop notifications |
| `mcp-bridge/scripts/check-bridge.sh` | Hook script — peek for unread, notify Claude Code |
| `mcp-bridge/src/application/services/peek-unread.ts` | Peek service — count without marking read |
| `mcp-bridge/src/routes/peek.ts` | REST route for `GET /messages/peek` |

### Modified files

| File | Change |
|------|--------|
| `mcp-bridge/src/db/schema.ts` | Add `working_dir` column to tasks table |
| `mcp-bridge/src/db/client.ts` | Add `working_dir` to `TaskRow`, `insertTask`, new `peekUnreadCount` |
| `mcp-bridge/src/mcp.ts` | Add `working_dir` to `assign_task`, add `peek_unread` tool |
| `mcp-bridge/src/transport/schemas/tasks.ts` | Add `working_dir` to task Zod schemas |
| `mcp-bridge/src/routes/tasks.ts` | Pass `working_dir` through |
| `mcp-bridge/src/routes/messages.ts` | Register peek route |
| `mcp-bridge/src/index.ts` | Wire peek route |
| `mcp-bridge/src/application/services/assign-task.ts` | Accept `working_dir` in input |
| `mcp-bridge/package.json` | Add `eventsource` dep, add `worker` script |
| `start.sh` | Add worker + notify background processes |
| `planning/API_CONTRACT.md` | Document peek endpoint and working_dir |
| `planning/ERD.md` | Document working_dir column |
