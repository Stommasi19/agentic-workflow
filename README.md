# Agentic Workflow

A portable Claude Code workflow toolkit: custom skills, configuration archive, repo bootstrapper, and a bidirectional MCP bridge for multi-agent communication.

## Prerequisites

- Node.js >= 20
- [Claude Code](https://claude.com/claude-code) installed
- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated (required by review skills)

## Contents

### 1. Skills & Config Archive

Extracted from `~/.claude/` for replication on any machine.

| Skill | Purpose |
|-------|---------|
| `/review` | Multi-agent PR code review orchestrator |
| `/postReview` | Publish review findings to GitHub as batched comments |
| `/addressReview` | Implement review fixes with parallel agents |
| `/enhancePrompt` | Context-aware prompt rewriter |
| `/bootstrap` | Repo documentation generator (see below) |

**Config files:** `config/settings.json`, `config/mcp.json`

### 2. Bootstrap Skill

Invocable via `/bootstrap` in any repo. Orchestrates documentation generation:

- Detects which of 17 Pivot-pattern docs exist (BUSINESS_PLAN, ARCHITECTURE, ERD, etc.)
- Generates missing docs adapted to the target repo's tech stack
- Creates a CLAUDE.md if none exists
- Handles bare repos, partially documented repos, and well-documented repos

### 3. MCP Bridge (Claude Code / Codex)

A TypeScript MCP server for bidirectional multi-agent communication.

**MCP Tools:**
- `send_context` — Send task context + meta-prompt between agents
- `get_messages` — Retrieve conversation history by UUID
- `get_unread` — Check for unread messages (marks as read on retrieval)
- `assign_task` — Assign tasks with domain and implementation details
- `report_status` — Report back with feedback or completion

**Features:**
- SQLite store-and-forward (messages queue when recipient is offline)
- Conversation continuity via UUID
- Fastify REST API (port 3100) + MCP stdio server
- Full end-to-end type safety with `AppResult<T>` pattern
- Atomic transactions for multi-step operations

## Setup

```bash
git clone https://github.com/joi-fairshare/agentic-workflow.git ~/repos/agentic-workflow
cd ~/repos/agentic-workflow
./setup.sh
```

The setup script:
- Symlinks skills into `~/.claude/skills/`
- Copies config files (settings, MCP)
- Installs and builds the MCP bridge
- Registers `agentic-bridge` MCP server with Claude Code and Codex
- Adds plugin marketplaces and installs plugins (github, superpowers, compound-engineering, playwright)

### Run the REST API (optional)

```bash
cd mcp-bridge
npm start          # Fastify on http://127.0.0.1:3100
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | REST API port |
| `HOST` | `127.0.0.1` | Bind address (loopback only by default) |
| `DB_PATH` | `./bridge.db` | SQLite database file path |
| `ALLOW_REMOTE` | unset | Set to `1` to allow non-loopback binding |

## Architecture

```
agentic-workflow/
├── skills/                    # Claude Code custom skills
│   ├── review/                # Multi-agent PR review
│   ├── postReview/            # GitHub comment publisher
│   ├── addressReview/         # Review fix implementer
│   └── enhancePrompt/         # Context-aware prompt rewriter
├── bootstrap/                 # Repo documentation generator skill
├── config/                    # Settings & MCP config archive
├── mcp-bridge/                # MCP bridge application
│   └── src/
│       ├── application/       # AppResult<T>, services (never throw)
│       ├── db/                # SQLite schema, client interface, transactions
│       ├── transport/         # Typed router, Zod schemas, controllers
│       ├── routes/            # Route factories (wire schemas to handlers)
│       ├── server.ts          # Fastify server factory
│       ├── mcp.ts             # MCP stdio server (5 tools)
│       └── index.ts           # REST API entry point
└── setup.sh                   # One-command setup script
```
