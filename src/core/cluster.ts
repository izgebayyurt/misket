/**
 * Code similarity and average-linkage hierarchical clustering, over the
 * co-occurrence matrix's counts. Pure math: no SVG, no React.
 *
 * Both similarity measures are computed straight from set sizes and pair
 * counts (own excerpt counts on the diagonal, overlapping-pair counts off
 * it) rather than materializing excerpt sets, since that is exactly what a
 * `CoOccurrence` cell already is: `own(a)`, `own(b)` and their intersection
 * `pair(a, b)`.
 */

export type SimilarityMethod = "jaccard" | "cosine";

/** `|A ∩ B| / |A ∪ B|`. 0 when both sets are empty (nothing in common, by
 * convention, rather than `NaN`). */
export function jaccardSimilarity(intersection: number, sizeA: number, sizeB: number): number {
  const union = sizeA + sizeB - intersection;
  return union > 0 ? intersection / union : 0;
}

/** `|A ∩ B| / sqrt(|A| · |B|)` — cosine similarity between the two codes'
 * binary excerpt-membership vectors. */
export function cosineSimilarity(intersection: number, sizeA: number, sizeB: number): number {
  const denom = Math.sqrt(sizeA * sizeB);
  return denom > 0 ? intersection / denom : 0;
}

export function similarity(
  method: SimilarityMethod,
  intersection: number,
  sizeA: number,
  sizeB: number,
): number {
  return method === "cosine"
    ? cosineSimilarity(intersection, sizeA, sizeB)
    : jaccardSimilarity(intersection, sizeA, sizeB);
}

/**
 * The full `n × n` similarity matrix for `ids`, from a own-size lookup and a
 * pairwise-intersection lookup (both typically backed by a `CoOccurrence`).
 * The diagonal is always 1 (a code is identical to itself) regardless of
 * method.
 */
export function similarityMatrix(
  ids: string[],
  ownSize: (id: string) => number,
  pairCount: (a: string, b: string) => number,
  method: SimilarityMethod = "jaccard",
): number[][] {
  const n = ids.length;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    m[i]![i] = 1;
    for (let j = i + 1; j < n; j++) {
      const s = similarity(method, pairCount(ids[i]!, ids[j]!), ownSize(ids[i]!), ownSize(ids[j]!));
      m[i]![j] = s;
      m[j]![i] = s;
    }
  }
  return m;
}

// ------------------------------------------------------------ clustering

export interface DendroLeaf {
  type: "leaf";
  id: string;
  /** Every leaf under this node, i.e. `[id]` — kept alongside `DendroNode`'s
   * `members` so callers can walk either kind uniformly. */
  members: string[];
}

export interface DendroNode {
  type: "node";
  left: DendroTree;
  right: DendroTree;
  /** The linkage distance at which `left` and `right` were merged (average
   * pairwise distance between their members). Dendrogram height. */
  height: number;
  members: string[];
}

export type DendroTree = DendroLeaf | DendroNode;

/** One merge, in the order it happened — what a "merge order and heights"
 * test asserts against directly, without walking the tree. */
export interface Merge {
  /** Members of the left/right clusters just before this merge. */
  left: string[];
  right: string[];
  height: number;
}

export interface Clustering {
  /** `null` when there are fewer than two ids (nothing to cluster). */
  tree: DendroTree | null;
  merges: Merge[];
  /** Leaf order a dendrogram should draw in, so no two branches cross. */
  leafOrder: string[];
}

/**
 * Average-linkage (UPGMA) agglomerative clustering: start with every id as
 * its own cluster, repeatedly merge the pair with the smallest distance
 * (`distance(a, b)`, symmetric; a dissimilarity, e.g. `1 - similarity`),
 * and record the merge distance as that new node's height. A merged
 * cluster's distance to any other cluster is the size-weighted average of
 * its two parents' distances to it — the textbook UPGMA update rule, which
 * is what keeps "average linkage" exact rather than approximated by
 * recomputing from raw pairs each time.
 *
 * Ties are broken by the ids' position in `ids`, so the result is
 * deterministic. The left child of a merge is always the one containing the
 * earlier-indexed original id, which is what makes `leafOrder` stable and
 * crossing-free.
 */
export function averageLinkage(
  ids: string[],
  distance: (a: string, b: string) => number,
): Clustering {
  if (ids.length < 2) {
    return {
      tree: ids.length === 1 ? { type: "leaf", id: ids[0]!, members: [ids[0]!] } : null,
      merges: [],
      leafOrder: [...ids],
    };
  }

  const order = new Map(ids.map((id, i) => [id, i]));
  interface Cluster {
    tree: DendroTree;
    size: number;
  }
  let clusters: Cluster[] = ids.map((id) => ({
    tree: { type: "leaf", id, members: [id] },
    size: 1,
  }));
  // dist[i][j] for the *current* `clusters` array; rebuilt incrementally as
  // clusters merge and the array compacts.
  let dist: number[][] = ids.map((a) => ids.map((b) => (a === b ? 0 : distance(a, b))));

  const merges: Merge[] = [];
  const firstIndex = (members: string[]) => Math.min(...members.map((m) => order.get(m)!));

  while (clusters.length > 1) {
    let bi = 0;
    let bj = 1;
    let best = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (dist[i]![j]! < best) {
          best = dist[i]![j]!;
          bi = i;
          bj = j;
        }
      }
    }
    const a = clusters[bi]!;
    const b = clusters[bj]!;
    const aFirst = firstIndex(a.tree.members);
    const bFirst = firstIndex(b.tree.members);
    const [left, right] = aFirst <= bFirst ? [a, b] : [b, a];
    merges.push({ left: left.tree.members, right: right.tree.members, height: best });
    const merged: Cluster = {
      tree: {
        type: "node",
        left: left.tree,
        right: right.tree,
        height: best,
        members: [...left.tree.members, ...right.tree.members],
      },
      size: a.size + b.size,
    };

    // Weighted-average (UPGMA) distance from the merged cluster to every
    // survivor, then drop the two rows/columns that merged and append the
    // new one at the end — keeping `clusters` and `dist` in lockstep by index.
    const keep = clusters.map((_, k) => k).filter((k) => k !== bi && k !== bj);
    const toMerged = keep.map(
      (k) => (a.size * dist[bi]![k]! + b.size * dist[bj]![k]!) / (a.size + b.size),
    );
    const n = keep.length;
    const rebuilt: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) rebuilt[r]![c] = dist[keep[r]!]![keep[c]!]!;
      rebuilt[r]![n] = toMerged[r]!;
      rebuilt[n]![r] = toMerged[r]!;
    }
    clusters = [...keep.map((k) => clusters[k]!), merged];
    dist = rebuilt;
  }

  const tree = clusters[0]!.tree;
  return { tree, merges, leafOrder: leafOrder(tree) };
}

/** Leaves in left-to-right dendrogram order (no crossing branches). */
export function leafOrder(tree: DendroTree): string[] {
  if (tree.type === "leaf") return [tree.id];
  return [...leafOrder(tree.left), ...leafOrder(tree.right)];
}

/**
 * Cut the dendrogram at `height`: every node whose own merge height is
 * `<= height` collapses into one cluster (all its leaves together); a node
 * merged *above* `height` instead contributes its two children as separate
 * clusters. Clusters come back in leaf order.
 */
export function cutTree(tree: DendroTree | null, height: number): string[][] {
  if (!tree) return [];
  const out: string[][] = [];
  const visit = (node: DendroTree) => {
    if (node.type === "leaf" || node.height <= height) {
      out.push([...node.members]);
      return;
    }
    visit(node.left);
    visit(node.right);
  };
  visit(tree);
  return out;
}

/** The full range of merge heights in a tree, for sizing a cut-height
 * slider (`[0, 0]` for a single leaf or an empty tree). */
export function heightRange(tree: DendroTree | null): [number, number] {
  if (!tree || tree.type === "leaf") return [0, 0];
  let max = -Infinity;
  const visit = (node: DendroTree) => {
    if (node.type === "node") {
      max = Math.max(max, node.height);
      visit(node.left);
      visit(node.right);
    }
  };
  visit(tree);
  return [0, max];
}
