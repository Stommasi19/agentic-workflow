// mcp-bridge/src/application/services/infer-topics.ts
import type { MemoryDbClient } from "../../db/memory-client.js";
import type { EmbeddingService } from "../../ingestion/embedding.js";
import type { AppResult } from "../result.js";
import { ok } from "../result.js";

// ── Types ────────────────────────────────────────────────────

export interface InferTopicsInput {
  repo: string;
  /** Number of topic clusters to create. Default: 10. */
  k?: number;
  /** Minimum cosine similarity to assign a node to a cluster. Default: 0.7. */
  threshold?: number;
}

export interface InferTopicsResult {
  topics_created: number;
  edges_created: number;
}

// ── Cosine Similarity ────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Centroid Computation ─────────────────────────────────────

function computeCentroid(embeddings: Float32Array[]): Float32Array {
  const dims = embeddings[0].length;
  const centroid = new Float32Array(dims);
  for (const emb of embeddings) {
    for (let i = 0; i < dims; i++) {
      centroid[i] += emb[i];
    }
  }
  const n = embeddings.length;
  for (let i = 0; i < dims; i++) {
    centroid[i] /= n;
  }
  return centroid;
}

// ── K-Means ──────────────────────────────────────────────────

const MAX_ITERATIONS = 10;

interface ClusterEntry {
  nodeId: string;
  embedding: Float32Array;
  title: string;
}

function runKMeans(
  entries: ClusterEntry[],
  k: number,
  threshold: number,
): Map<number, ClusterEntry[]> {
  const n = entries.length;
  const actualK = Math.min(k, n);

  // K-means++ initialization: spread initial centroids to improve convergence.
  // Pick first centroid randomly, then each subsequent centroid is chosen
  // with probability proportional to the squared distance from the nearest
  // already-chosen centroid.
  const usedIndices = new Set<number>();
  const firstIdx = Math.floor(Math.random() * n);
  usedIndices.add(firstIdx);
  const centroids: Float32Array[] = [entries[firstIdx].embedding];

  while (centroids.length < actualK) {
    // For each entry compute (1 - max_cosine_sim_to_existing_centroids)^2 as weight
    const weights = entries.map((entry, i) => {
      if (usedIndices.has(i)) return 0;
      const maxSim = Math.max(...centroids.map((c) => cosineSimilarity(entry.embedding, c)));
      const dist = 1 - maxSim;
      return dist * dist;
    });
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight === 0) {
      // All remaining entries are identical to existing centroids — stop early
      break;
    }
    let r = Math.random() * totalWeight;
    let chosen = -1;
    for (let i = 0; i < n; i++) {
      r -= weights[i];
      if (r <= 0) { chosen = i; break; }
    }
    if (chosen === -1) chosen = weights.findIndex((w) => w > 0);
    usedIndices.add(chosen);
    centroids.push(entries[chosen].embedding);
  }

  let assignments = new Array<number>(n).fill(-1);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Assignment step
    const newAssignments = new Array<number>(n).fill(-1);
    for (let i = 0; i < n; i++) {
      let bestCluster = -1;
      let bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = cosineSimilarity(entries[i].embedding, centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          bestCluster = c;
        }
      }
      // Apply threshold: only assign if similarity meets the bar
      if (bestSim >= threshold) {
        newAssignments[i] = bestCluster;
      }
    }

    // Check convergence
    const converged = newAssignments.every((a, i) => a === assignments[i]);
    assignments = newAssignments;
    if (converged) break;

    // Update step: recompute centroids from assigned members
    for (let c = 0; c < centroids.length; c++) {
      const members = entries.filter((_, i) => assignments[i] === c);
      if (members.length > 0) {
        centroids[c] = computeCentroid(members.map((m) => m.embedding));
      }
      // If no members, keep old centroid to avoid NaN
    }
  }

  // Build cluster map (only include assigned entries)
  const clusters = new Map<number, ClusterEntry[]>();
  for (let i = 0; i < n; i++) {
    const c = assignments[i];
    if (c === -1) continue;
    if (!clusters.has(c)) clusters.set(c, []);
    clusters.get(c)!.push(entries[i]);
  }

  return clusters;
}

// ── Most-Central Member ──────────────────────────────────────

/** Return the index of the entry whose embedding is closest to the cluster centroid. */
function mostCentralIndex(members: ClusterEntry[]): number {
  const centroid = computeCentroid(members.map((m) => m.embedding));
  let bestIdx = 0;
  let bestSim = -Infinity;
  for (let i = 0; i < members.length; i++) {
    const sim = cosineSimilarity(members[i].embedding, centroid);
    if (sim > bestSim) {
      bestSim = sim;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ── Service ──────────────────────────────────────────────────

/** Cluster conversation node embeddings and create topic nodes. */
export async function inferTopics(
  mdb: MemoryDbClient,
  _embedService: EmbeddingService,
  input: InferTopicsInput,
): Promise<AppResult<InferTopicsResult>> {
  const { repo, k = 10, threshold = 0.7 } = input;

  // 1. Fetch all conversation-kind nodes for the repo
  const conversations = mdb.getNodesByRepoAndKind(repo, "conversation");

  // 2. Collect entries that have embeddings
  const entries: ClusterEntry[] = [];
  for (const node of conversations) {
    const embedding = mdb.getEmbedding(node.id);
    if (embedding) {
      entries.push({ nodeId: node.id, embedding, title: node.title });
    }
  }

  // Need at least 2 nodes to form any cluster of size ≥ 2
  if (entries.length < 2) {
    return ok({ topics_created: 0, edges_created: 0 });
  }

  // 3. Run k-means clustering
  const clusters = runKMeans(entries, k, threshold);

  // 4. Create topic nodes and edges (only for clusters with 2+ members)
  let topics_created = 0;
  let edges_created = 0;

  mdb.transaction(() => {
    for (const [, members] of clusters) {
      if (members.length < 2) continue;

      // Determine topic title from most-central member
      const centralIdx = mostCentralIndex(members);
      const topicTitle = members[centralIdx].title;

      // Create topic node
      const topicNode = mdb.insertNode({
        repo,
        kind: "topic",
        title: topicTitle,
        body: `Auto-inferred topic from ${members.length} conversations.`,
        meta: JSON.stringify({ auto: true, member_count: members.length }),
        source_id: `topic-cluster-${topics_created}`,
        source_type: "infer-topics",
      });
      topics_created++;

      // Create discussed_in edges: topic → conversation
      for (const member of members) {
        mdb.insertEdge({
          repo,
          from_node: topicNode.id,
          to_node: member.nodeId,
          kind: "discussed_in",
          weight: 1.0,
          meta: "{}",
          auto: true,
        });
        edges_created++;
      }
    }
  });

  return ok({ topics_created, edges_created });
}
