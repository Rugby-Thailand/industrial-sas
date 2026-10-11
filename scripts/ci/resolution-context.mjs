// Compare contextual resolution across different package-manager node IDs.
// Joint partition refinement preserves root bindings and every edge alias/kind.
// Cycles are handled without path truncation; each iteration only splits classes.

const sorted = (values) => [...values].sort();
const text = (value) => JSON.stringify(value);

function validate(graph) {
  if (
    !(graph.nodes instanceof Map) ||
    !(graph.edges instanceof Map) ||
    !Array.isArray(graph.roots)
  )
    throw new Error("Incomplete contextual resolution graph");
  for (const [id, node] of graph.nodes)
    if (typeof node.key !== "string" || !node.key)
      throw new Error(`${id}: missing package identity`);
  for (const [from, edges] of graph.edges) {
    if (!graph.nodes.has(from) || !Array.isArray(edges))
      throw new Error(`${from}: unknown parent or malformed edges`);
    for (const edge of edges) validateEdge(graph, edge);
  }
  for (const root of graph.roots) validateEdge(graph, root);
}

function validateEdge(graph, edge) {
  if (
    !edge ||
    typeof edge.alias !== "string" ||
    !edge.alias ||
    typeof edge.kind !== "string" ||
    !edge.kind ||
    !graph.nodes.has(edge.target)
  )
    throw new Error("Unresolved or malformed contextual edge/root");
}

/**
 * Generic {nodes,edges,roots} graphs; opaque IDs need not match between stores.
 * Lock→physical coverage may share bisimilar nodes. Physical→physical parity
 * keeps the default multiplicity check; all modes require every class/root.
 */
export function compareResolutionContexts(
  baseline,
  candidate,
  { allowEquivalentSharing = false } = {},
) {
  if (typeof allowEquivalentSharing !== "boolean")
    throw new Error("Equivalent sharing must be an explicit boolean");
  validate(baseline);
  validate(candidate);
  const graphs = [baseline, candidate];
  const rows = graphs.flatMap((graph, side) =>
    [...graph.nodes].map(([id, node]) => ({ side, id, node })),
  );
  const assign = (signatures) => {
    const classes = new Map(
      sorted(new Set(signatures)).map((signature, index) => [signature, index]),
    );
    return {
      colors: signatures.map((signature) => classes.get(signature)),
      size: classes.size,
    };
  };
  let partition = assign(
    rows.map(({ node }) =>
      text([
        node.key,
        node.integrity ?? null,
        sorted(node.os ?? []),
        sorted(node.cpu ?? []),
        sorted(node.libc ?? []),
      ]),
    ),
  );
  let iterations = 0;
  while (true) {
    const colors = graphs.map(() => new Map());
    rows.forEach(({ side, id }, index) =>
      colors[side].set(id, partition.colors[index]),
    );
    const next = assign(
      rows.map(({ side, id }, index) =>
        text([
          partition.colors[index],
          sorted(
            (graphs[side].edges.get(id) ?? []).map((edge) =>
              text([edge.alias, edge.kind, colors[side].get(edge.target)]),
            ),
          ),
        ]),
      ),
    );
    iterations += 1;
    const stable = next.size === partition.size;
    partition = next;
    if (stable) break;
    if (iterations > rows.length)
      throw new Error("Contextual refinement failed to converge");
  }
  const inventories = graphs.map((graph, side) => {
    const colors = new Map();
    const counts = new Map();
    rows.forEach((row, index) => {
      if (row.side !== side) return;
      const color = partition.colors[index];
      colors.set(row.id, color);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    });
    const roots = sorted(
      graph.roots.map((root) =>
        text([root.alias, root.kind, colors.get(root.target)]),
      ),
    );
    return { counts, roots };
  });
  const [a, b] = inventories;
  const differences = {
    contextsOnlyInBaseline: sorted(
      [...a.counts.keys()].filter((color) => !b.counts.has(color)),
    ),
    contextsOnlyInCandidate: sorted(
      [...b.counts.keys()].filter((color) => !a.counts.has(color)),
    ),
    contextMultiplicityMismatches: sorted(
      [...a.counts]
        .filter(
          ([color, count]) =>
            b.counts.has(color) && b.counts.get(color) !== count,
        )
        .map(
          ([color, count]) => `${color}: ${count} -> ${b.counts.get(color)}`,
        ),
    ),
    contextualRootsOnlyInBaseline: a.roots.filter(
      (root) => !b.roots.includes(root),
    ),
    contextualRootsOnlyInCandidate: b.roots.filter(
      (root) => !a.roots.includes(root),
    ),
  };
  return {
    problems: Object.entries(differences)
      .filter(
        ([name, entries]) =>
          entries.length &&
          !(allowEquivalentSharing && name === "contextMultiplicityMismatches"),
      )
      .map(
        ([name, entries]) =>
          `${name}: ${entries.length} (${entries.slice(0, 5).join("; ")})`,
      ),
    differences,
    allowEquivalentSharing,
    counts: {
      baseline: baseline.nodes.size,
      candidate: candidate.nodes.size,
      classes: partition.size,
      iterations,
    },
  };
}
