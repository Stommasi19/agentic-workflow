// mcp-bridge/src/application/services/ingest-git.ts
import { execSync } from "node:child_process";
import type { MemoryDbClient, NodeRow } from "../../db/memory-client.js";
import type { SecretFilter } from "../../ingestion/secret-filter.js";
import type { AppResult } from "../result.js";
import { ok, err } from "../result.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface IngestGitInput {
  repo: string;
  repoPath: string; // Filesystem path to the git repo
}

export interface IngestGitResult {
  commits_ingested: number;
  prs_ingested: number;
  references_created: number;
}

// ── Reference detection patterns ──────────────────────────────────────

/** SHA references: 7+ hex chars that match a known commit */
const SHA_PATTERN = /\b([0-9a-f]{7,40})\b/g;
/** PR references: #123 or PR #123 */
const PR_PATTERN = /#(\d+)\b/g;

// ── Helpers ───────────────────────────────────────────────────────────

interface CommitRecord {
  sha: string;
  subject: string;
  author: string;
  date: string;
}

interface PrRecord {
  number: number;
  title: string;
  author: string;
  state: string;
  createdAt: string;
  body: string;
}

function parseGitLog(output: string): CommitRecord[] {
  if (!output.trim()) return [];
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split("|");
      const [sha = "", subject = "", author = "", date = ""] = parts;
      return { sha: sha.trim(), subject: subject.trim(), author: author.trim(), date: date.trim() };
    })
    .filter((c) => c.sha.length > 0);
}

function runGitLog(repoPath: string): CommitRecord[] {
  const output = execSync(
    `git log --format="%H|%s|%an|%ai" --since="30 days ago"`,
    { cwd: repoPath, encoding: "utf8" },
  ) as unknown as string;
  return parseGitLog(output);
}

function runGhPrList(repoPath: string): PrRecord[] | null {
  try {
    const output = execSync(
      `gh pr list --state all --limit 50 --json number,title,author,state,createdAt,body`,
      { cwd: repoPath, encoding: "utf8" },
    ) as unknown as string;
    if (!output.trim()) return [];
    const parsed = JSON.parse(output) as Array<{
      number: number;
      title: string;
      author: { login: string };
      state: string;
      createdAt: string;
      body: string;
    }>;
    return parsed.map((p) => ({
      number: p.number,
      title: p.title,
      author: p.author?.login ?? "unknown",
      state: p.state,
      createdAt: p.createdAt,
      body: p.body ?? "",
    }));
  } catch {
    // gh CLI not available or not in a GitHub repo — skip PR ingestion
    return null;
  }
}

// ── Reference scanning ────────────────────────────────────────────────

/**
 * Scan all message nodes in the repo and create `references` edges
 * for any SHAs or PR numbers that match known artifact nodes.
 *
 * Returns the number of new edges created.
 */
function scanAndLinkReferences(
  mdb: MemoryDbClient,
  repo: string,
  commitNodes: Map<string, NodeRow>,
  prNodes: Map<string, NodeRow>,
): number {
  const messages = mdb.getNodesByRepoAndKind(repo, "message");
  let refsCreated = 0;

  for (const msg of messages) {
    const body = msg.body;
    const seenTargets = new Set<string>();

    // Check SHA references
    SHA_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SHA_PATTERN.exec(body)) !== null) {
      const sha = match[1];
      // Look for full SHA match among commit nodes by checking if any commit sha starts with this
      for (const [commitSha, commitNode] of commitNodes) {
        if (commitSha.startsWith(sha) || sha.startsWith(commitSha.slice(0, 7))) {
          const targetId = commitNode.id;
          if (!seenTargets.has(targetId)) {
            seenTargets.add(targetId);
            try {
              mdb.insertEdge({
                repo,
                from_node: msg.id,
                to_node: targetId,
                kind: "references",
                weight: 1.0,
                meta: JSON.stringify({ matched_sha: sha }),
                auto: true,
              });
              refsCreated++;
            } catch {
              // Edge already exists (unique constraint) — skip
            }
          }
        }
      }
    }

    // Check PR references
    PR_PATTERN.lastIndex = 0;
    while ((match = PR_PATTERN.exec(body)) !== null) {
      const prNumber = match[1];
      const prKey = `#${prNumber}`;
      const prNode = prNodes.get(prKey);
      if (prNode && !seenTargets.has(prNode.id)) {
        seenTargets.add(prNode.id);
        try {
          mdb.insertEdge({
            repo,
            from_node: msg.id,
            to_node: prNode.id,
            kind: "references",
            weight: 1.0,
            meta: JSON.stringify({ matched_pr: prKey }),
            auto: true,
          });
          refsCreated++;
        } catch {
          // Edge already exists — skip
        }
      }
    }
  }

  return refsCreated;
}

// ── Service ───────────────────────────────────────────────────────────

/** Parse git log output and create artifact nodes. */
export async function ingestGitMetadata(
  mdb: MemoryDbClient,
  filter: SecretFilter,
  input: IngestGitInput,
): Promise<AppResult<IngestGitResult>> {
  const { repo, repoPath } = input;

  try {
    // 1. Run git log
    let commits: CommitRecord[];
    try {
      commits = runGitLog(repoPath);
    } catch (e) {
      return err({
        code: "GIT_ERROR",
        message: `Failed to run git log: ${e instanceof Error ? e.message : String(e)}`,
        statusHint: 500,
      });
    }

    // 2. Ingest commits (idempotent via getNodeBySource)
    let commitsIngested = 0;
    const commitNodes = new Map<string, NodeRow>();
    let newestSha: string | undefined;

    for (const commit of commits) {
      if (!newestSha) newestSha = commit.sha;

      const existing = mdb.getNodeBySource("git", commit.sha);
      if (existing) {
        commitNodes.set(commit.sha, existing);
        continue;
      }

      const title = filter.redact(commit.subject);
      const body = filter.redact(
        `Author: ${commit.author}\nDate: ${commit.date}\n\n${commit.subject}`,
      );

      const node = mdb.insertNode({
        repo,
        kind: "artifact",
        title: `${commit.sha.slice(0, 7)}: ${title}`,
        body,
        meta: JSON.stringify({ sha: commit.sha, author: commit.author, date: commit.date }),
        source_id: commit.sha,
        source_type: "git",
      });

      commitNodes.set(commit.sha, node);
      commitsIngested++;
    }

    // 3. Run gh pr list (skip if gh not available)
    let prsIngested = 0;
    const prNodes = new Map<string, NodeRow>();
    const prs = runGhPrList(repoPath);

    if (prs !== null) {
      for (const pr of prs) {
        const sourceId = `#${pr.number}`;
        const existing = mdb.getNodeBySource("github_pr", sourceId);
        if (existing) {
          prNodes.set(sourceId, existing);
          continue;
        }

        const title = filter.redact(pr.title);
        const body = filter.redact(
          `PR ${sourceId}: ${pr.title}\nAuthor: ${pr.author}\nState: ${pr.state}\nCreated: ${pr.createdAt}\n\n${pr.body}`,
        );

        const node = mdb.insertNode({
          repo,
          kind: "artifact",
          title: `PR ${sourceId}: ${title}`,
          body,
          meta: JSON.stringify({ number: pr.number, author: pr.author, state: pr.state, createdAt: pr.createdAt }),
          source_id: sourceId,
          source_type: "github_pr",
        });

        prNodes.set(sourceId, node);
        prsIngested++;
      }
    }

    // 4. Scan message nodes and create references edges
    const refsCreated = scanAndLinkReferences(mdb, repo, commitNodes, prNodes);

    // 5. Advance cursor to most recent commit SHA
    if (newestSha) {
      mdb.upsertCursor("git-ingest", repo, newestSha);
    }

    return ok({ commits_ingested: commitsIngested, prs_ingested: prsIngested, references_created: refsCreated });
  } catch (e) {
    return err({
      code: "INGEST_ERROR",
      message: `Git ingestion failed: ${e instanceof Error ? e.message : String(e)}`,
      statusHint: 500,
    });
  }
}
