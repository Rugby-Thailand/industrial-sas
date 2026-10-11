// Installed resolution contexts retain store variants and every root/edge alias.
import { readInstalledStore } from "./installed-store.mjs";
import { compareResolutionContexts } from "./resolution-context.mjs";

/** Legacy name/version summaries are diagnostic; resolution is the parity proof. */
export function installedGraph(projectDirectory, manager, options = {}) {
  const store = readInstalledStore(projectDirectory, manager, options);
  const roots = new Map();
  const edges = new Set();
  const keys = new Set();
  for (const row of store.entries) {
    keys.add(row.key);
    for (const { owner: child } of row.links) {
      edges.add(`${row.key} -> ${child.key}`);
    }
  }
  for (const root of store.roots) {
    roots.set(root.alias, root.owner.key);
  }
  return { roots, edges, keys, resolution: store.resolution };
}

/** Summaries cannot prove parity: compare the complete resolution contexts too. */
export function compareInstalled(baseline, candidate) {
  if (!baseline.resolution || !candidate.resolution)
    throw new Error("Installed parity requires complete resolution contexts");
  const minus = (a, b) => [...a].filter((x) => !b.has(x)).sort();
  const rootText = (graph) =>
    new Set([...graph.roots].map(([alias, key]) => `${alias} -> ${key}`));
  return {
    packagesOnlyInBaseline: minus(baseline.keys, candidate.keys),
    packagesOnlyInCandidate: minus(candidate.keys, baseline.keys),
    edgesOnlyInBaseline: minus(baseline.edges, candidate.edges),
    edgesOnlyInCandidate: minus(candidate.edges, baseline.edges),
    rootsOnlyInBaseline: minus(rootText(baseline), rootText(candidate)),
    rootsOnlyInCandidate: minus(rootText(candidate), rootText(baseline)),
    contexts: compareResolutionContexts(
      baseline.resolution,
      candidate.resolution,
    ),
  };
}
