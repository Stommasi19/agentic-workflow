// mcp-bridge/src/application/services/search-memory.ts
import type { MemoryDbClient, FTSResult } from "../../db/memory-client.js";
import type { EmbeddingService } from "../../ingestion/embedding.js";
import type { NodeKind } from "../../db/memory-schema.js";
import type { AppResult } from "../result.js";
import { ok, err } from "../result.js";

// ── Constants ────────────────────────────────────────────────

const RRF_K = 60;

// ── Types ────────────────────────────────────────────────────

export interface SearchInput {
  query: string;
  repo: string;
  mode?: "semantic" | "keyword" | "hybrid";
  kinds?: NodeKind[];
  limit?: number;
}

export interface SearchResult {
  node_id: string;
  kind: NodeKind;
  title: string;
  body: string;
  score: number;
  match_type: "keyword" | "semantic" | "hybrid";
}

// ── Service ──────────────────────────────────────────────────

export async function searchMemory(
  mdb: MemoryDbClient,
  embedService: EmbeddingService,
  input: SearchInput,
): Promise<AppResult<SearchResult[]>> {
  const { query, repo, limit = 20 } = input;
  let mode = input.mode ?? "hybrid";

  // P1: Degrade to keyword if embedding service is known-degraded
  if (mode !== "keyword" && embedService.isDegraded()) {
    mode = "keyword";
  }

  const ftsResults = new Map<string, { node: FTSResult; rank: number }>();
  const vecResults = new Map<string, { node_id: string; rank: number }>();

  // FTS5 search
  if (mode === "keyword" || mode === "hybrid") {
    const fts = mdb.searchFTS(query, repo, limit * 2);
    fts.forEach((r, i) => ftsResults.set(r.id, { node: r, rank: i + 1 }));
  }

  // Vector search
  if (mode === "semantic" || mode === "hybrid") {
    const embedResult = await embedService.embed(`search_query: ${query}`);
    if (embedResult.ok) {
      const knn = mdb.searchKNN(embedResult.data, limit * 2, repo);
      knn.forEach((r, i) => vecResults.set(r.node_id, { node_id: r.node_id, rank: i + 1 }));
    } else if (mode === "semantic") {
      return err({ code: "EMBEDDING_FAILED", message: "Semantic search requires working embeddings", statusHint: 503 });
    }
    // If hybrid and embedding failed, continue with FTS results only
  }

  // RRF fusion
  const scores = new Map<string, number>();
  for (const [id, { rank }] of ftsResults) {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank));
  }
  for (const [id, { rank }] of vecResults) {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank));
  }

  // Collect and sort by score descending
  let nodeIds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // Kind filter
  if (input.kinds && input.kinds.length > 0) {
    const kindSet = new Set<string>(input.kinds);
    nodeIds = nodeIds.filter((id) => {
      const ftsEntry = ftsResults.get(id);
      if (ftsEntry) return kindSet.has(ftsEntry.node.kind);
      const node = mdb.getNode(id);
      return node ? kindSet.has(node.kind) : false;
    });
  }

  // Build results
  const results: SearchResult[] = [];
  for (const id of nodeIds.slice(0, limit)) {
    const ftsEntry = ftsResults.get(id);
    const node = ftsEntry?.node ?? mdb.getNode(id);
    if (!node) continue;

    const matchType = ftsResults.has(id) && vecResults.has(id) ? "hybrid"
      : ftsResults.has(id) ? "keyword" : "semantic";

    results.push({
      node_id: node.id,
      kind: node.kind as NodeKind,
      title: node.title,
      body: node.body.slice(0, 500),
      score: scores.get(id) ?? 0,
      match_type: matchType,
    });
  }

  return ok(results);
}
