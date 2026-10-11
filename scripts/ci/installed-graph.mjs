// T03 installed dependency graph read from an isolated node_modules layout
// (`node_modules/.bun/*` for Bun, `node_modules/.pnpm/*` for pnpm). The
// symlinks are what packages actually resolve at runtime, including peer and
// optional-peer links that a lockfile alone cannot always determine.
// Any unreadable entry or dangling link throws: no partial inventory.
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

const STORE = Object.freeze({ bun: ".bun", pnpm: ".pnpm" });

function linkedPackages(modulesDirectory) {
  const entries = [];
  for (const name of readdirSync(modulesDirectory)) {
    if (name.startsWith(".")) continue;
    const full = join(modulesDirectory, name);
    if (name.startsWith("@")) {
      for (const child of readdirSync(full))
        entries.push([`${name}/${child}`, join(full, child)]);
    } else entries.push([name, full]);
  }
  return entries;
}

function manifestKey(directory) {
  const manifest = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string")
    throw new Error(`${directory}: package.json lacks name/version`);
  return `${manifest.name}@${manifest.version}`;
}

/**
 * `{ roots, edges, keys }`: `roots` maps root alias → `name@version`,
 * `edges` is a Set of `parentKey -> childKey`, `keys` every installed
 * `name@version`. Store variants of one version (peer contexts) merge on key.
 */
export function installedGraph(projectDirectory, manager) {
  const store = STORE[manager];
  if (!store) throw new Error(`Unknown package manager ${manager}`);
  const modules = join(projectDirectory, "node_modules");
  const storeDirectory = join(modules, store);
  if (!existsSync(storeDirectory))
    throw new Error(`${storeDirectory} does not exist`);
  const roots = new Map();
  for (const [alias, path] of linkedPackages(modules)) {
    if (!lstatSync(path).isSymbolicLink())
      throw new Error(`${path}: root entry is not a link`);
    roots.set(alias, manifestKey(realpathSync(path)));
  }
  const edges = new Set();
  const keys = new Set();
  for (const entry of readdirSync(storeDirectory)) {
    if (
      entry === "node_modules" ||
      entry.startsWith(".") ||
      entry === "lock.yaml"
    )
      continue;
    const nested = join(storeDirectory, entry, "node_modules");
    if (!existsSync(nested)) continue;
    const packages = linkedPackages(nested);
    const own = packages.filter(
      ([, path]) => !lstatSync(path).isSymbolicLink(),
    );
    if (own.length !== 1)
      throw new Error(`${entry}: expected exactly one materialized package`);
    const parent = manifestKey(own[0][1]);
    keys.add(parent);
    for (const [, path] of packages) {
      if (!lstatSync(path).isSymbolicLink()) continue;
      const target = realpathSync(path);
      if (!existsSync(join(target, "package.json")))
        throw new Error(`${path} -> ${readlinkSync(path)}: dangling link`);
      edges.add(`${parent} -> ${manifestKey(target)}`);
    }
  }
  return { roots, edges, keys };
}

/** Differences between two installed graphs (empty arrays mean parity). */
export function compareInstalled(baseline, candidate) {
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
  };
}
