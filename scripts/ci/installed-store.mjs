// Complete, contained installed-store inventory shared by graph and lifecycle checks.
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { parseUniqueJson } from "./json-input.mjs";
import {
  bunGraph,
  parseBunLockText,
  parseRestrictedYaml,
  pnpmGraph,
  graphProblems,
} from "./lockfile-graph.mjs";
import { isExactVersion } from "./semver-range.mjs";
import { compareResolutionContexts } from "./resolution-context.mjs";

const MANAGERS = { bun: ".bun", pnpm: ".pnpm" };
const KINDS = ["dependencies", "optionalDependencies", "peerDependencies"];
const ROOT_KINDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const plain = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
// A `node_modules` segment (any casing: macOS volumes are case-insensitive)
// is a resolution root, never a package name or scoped alias.
const NODE_MODULES = /^node_modules$/i;
const packageName = (value) =>
  typeof value === "string" &&
  /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(value) &&
  !value.split("/").some((segment) => NODE_MODULES.test(segment));
// pnpm writes these regular files beside its store; they are not packages.
const ROOT_METADATA = {
  bun: [],
  pnpm: [".modules.yaml", ".pnpm-workspace-state-v1.json"],
};
const METADATA_BYTES = 16 * 1024 * 1024;
const PACKAGE_TREE_ENTRIES = 2_000_000;

function directory(path) {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${path}: expected materialized directory`);
}

function manifest(path) {
  const value = parseUniqueJson(readFileSync(path, "utf8"));
  if (
    !plain(value) ||
    !packageName(value.name) ||
    !isExactVersion(value.version)
  )
    throw new Error(`${path}: invalid package name/version`);
  for (const kind of [...ROOT_KINDS, "scripts"]) {
    if (value[kind] === undefined) continue;
    if (
      !plain(value[kind]) ||
      Object.entries(value[kind]).some(
        ([key, spec]) => !key || typeof spec !== "string",
      )
    )
      throw new Error(`${path}: invalid ${kind} schema`);
  }
  const bundled = value.bundledDependencies ?? value.bundleDependencies;
  if (bundled !== undefined && (!Array.isArray(bundled) || bundled.length))
    throw new Error(`${path}: bundled dependency inventory unsupported`);
  if (
    value.peerDependenciesMeta !== undefined &&
    (!plain(value.peerDependenciesMeta) ||
      Object.values(value.peerDependenciesMeta).some(
        (meta) =>
          !plain(meta) ||
          (meta.optional !== undefined && typeof meta.optional !== "boolean"),
      ))
  )
    throw new Error(`${path}: invalid peerDependenciesMeta`);
  return value;
}

function packagePaths(modules, ignored = []) {
  directory(modules);
  const paths = [];
  for (const name of readdirSync(modules).sort()) {
    if (name === ".bin" || ignored.includes(name)) continue;
    if (name.startsWith("."))
      throw new Error(`${modules}: unknown entry ${name}`);
    const full = join(modules, name);
    if (name.startsWith("@")) {
      directory(full);
      const children = readdirSync(full).sort();
      if (!children.length) throw new Error(`${full}: empty package scope`);
      for (const child of children) {
        if (!packageName(`${name}/${child}`))
          throw new Error(`${full}: invalid alias ${child}`);
        paths.push([`${name}/${child}`, join(full, child)]);
      }
    } else {
      if (!packageName(name)) throw new Error(`${full}: invalid package alias`);
      paths.push([name, full]);
    }
  }
  return paths;
}

/**
 * Node resolves a bare specifier from the `node_modules` nearest to the
 * requiring file's real path. Inside a materialized package, that is any
 * nested `node_modules` at any depth, or whatever a link inside it reaches.
 * Such trees are not modelled: every entry is visited and anything except
 * regular files, directories and one manager-written `<package>/node_modules`
 * holding only `.bin` (validated later like every other `.bin`) fails closed
 * before ownership is accepted. Returns that `.bin` parent or null.
 */
function packageTree(path, budget) {
  let localBin = null;
  const pending = [path];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (--budget.remaining < 0)
        throw new Error(`${path}: package tree exceeds the supported bound`);
      const full = join(current, entry.name);
      if (NODE_MODULES.test(entry.name)) {
        const names =
          current === path &&
          entry.name === "node_modules" &&
          entry.isDirectory()
            ? readdirSync(full)
            : null;
        if (names?.length !== 1 || names[0] !== ".bin")
          throw new Error(
            `${full}: unsupported nested node_modules inside materialized package`,
          );
        directory(join(full, ".bin"));
        localBin = full;
      } else if (entry.isSymbolicLink())
        throw new Error(`${full}: link inside materialized package`);
      else if (entry.isDirectory()) pending.push(full);
      else if (!entry.isFile())
        throw new Error(
          `${full}: unsupported entry inside materialized package`,
        );
    }
  }
  return localBin;
}

function regularMetadata(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > METADATA_BYTES)
    throw new Error(`${path}: metadata must be a bounded regular file`);
}

function target(path, owners, store) {
  if (!lstatSync(path).isSymbolicLink())
    throw new Error(`${path}: expected package link`);
  const real = realpathSync(path);
  if (!real.startsWith(store + sep))
    throw new Error(`${path}: package link escapes outside store`);
  const owner = owners.get(real);
  if (!owner) throw new Error(`${path}: unaccounted package link`);
  return owner;
}

function bins(modules, store, owners) {
  const path = join(modules, ".bin");
  if (!existsSync(path)) return;
  directory(path);
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    const stat = lstatSync(file);
    if (!stat.isSymbolicLink()) {
      // pnpm writes executable shell shims; they are not package manifests.
      if (!stat.isFile()) throw new Error(`${file}: unknown bin entry`);
      continue;
    }
    const real = realpathSync(file);
    if (
      !real.startsWith(store + sep) ||
      ![...owners.keys()].some((owner) => real.startsWith(owner + sep))
    )
      throw new Error(`${file}: bin link escapes package ownership`);
  }
}

function compatible(node, platform) {
  const matches = (list, value) => {
    if (!Array.isArray(list) || list.some((part) => typeof part !== "string"))
      throw new Error(`${node.key}: invalid platform metadata`);
    if (!list.length) return true;
    if (!value)
      throw new Error(
        `${node.key}: platform selection requires explicit value`,
      );
    return (
      !list.includes(`!${value}`) &&
      (!list.some((part) => !part.startsWith("!")) || list.includes(value))
    );
  };
  return (
    matches(node.os ?? [], platform.os) &&
    matches(node.cpu ?? [], platform.cpu) &&
    matches(node.libc ?? [], platform.libc)
  );
}

function expectedInventory(graph, platform) {
  const problems = graphProblems(graph);
  if (problems.length)
    throw new Error(`Expected graph invalid: ${problems.join("; ")}`);
  const nodes = new Set();
  const visit = (id) => {
    if (id === null || nodes.has(id)) return;
    const node = graph.nodes.get(id);
    if (!node) throw new Error(`${id}: expected graph target missing`);
    if (!compatible(node, platform)) return;
    nodes.add(id);
    for (const edge of graph.edges.get(id) ?? []) visit(edge.target);
  };
  for (const root of graph.roots) visit(root.target);
  return nodes;
}

/** Requires a frozen expected graph; it is never inferred from a nonempty store. */
export function readInstalledStore(projectDirectory, manager, options = {}) {
  const inputRoot = resolve(projectDirectory);
  directory(inputRoot);
  const root = realpathSync(inputRoot);
  const storeName = MANAGERS[manager];
  if (!storeName) throw new Error(`Unknown package manager ${manager}`);
  const modules = join(root, "node_modules");
  const store = join(modules, storeName);
  if (!existsSync(store)) throw new Error(`${store} does not exist`);
  directory(modules);
  directory(store);
  const owners = new Map();
  const entries = [];
  const budget = { remaining: PACKAGE_TREE_ENTRIES };
  for (const entry of readdirSync(store).sort()) {
    if (entry === "node_modules") continue;
    if (manager === "pnpm" && entry === "lock.yaml") {
      const stat = lstatSync(join(store, entry));
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`${entry}: lock metadata must be materialized`);
      continue;
    }
    if (entry.startsWith("."))
      throw new Error(`${store}: unknown store entry ${entry}`);
    const container = join(store, entry);
    directory(container);
    const nested = join(container, "node_modules");
    if (!existsSync(nested)) throw new Error(`${entry}: missing node_modules`);
    const packages = packagePaths(nested);
    const own = packages.filter(
      ([, path]) => !lstatSync(path).isSymbolicLink(),
    );
    if (own.length !== 1)
      throw new Error(`${entry}: expected exactly one materialized package`);
    const [alias, path] = own[0];
    directory(path);
    // Reject nearer resolution roots before this package's manifest counts.
    const localBin = packageTree(path, budget);
    const file = join(path, "package.json");
    if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile())
      throw new Error(`${file}: package manifest must be materialized`);
    const data = manifest(file);
    const prefix = `${data.name.replace("/", "+")}@${data.version}`;
    if (
      alias !== data.name ||
      !(
        entry === prefix ||
        entry.startsWith(prefix + "+") ||
        entry.startsWith(prefix + "_") ||
        entry.startsWith(prefix + "(")
      )
    )
      throw new Error(`${entry}: materialized package ownership mismatch`);
    const row = {
      id: entry,
      key: `${data.name}@${data.version}`,
      manifest: data,
      file,
      directory: path,
      packages,
      modules: nested,
      localBin,
    };
    owners.set(realpathSync(path), row);
    entries.push(row);
  }
  if (!entries.length) throw new Error(`${store}: no package manifests found`);
  let graph = options.expectedGraph;
  if (!graph) {
    const lockFile = join(
      root,
      manager === "bun" ? "bun.lock" : "pnpm-lock.yaml",
    );
    if (!existsSync(lockFile))
      throw new Error(`${lockFile}: expected graph is required`);
    const text = readFileSync(lockFile, "utf8");
    graph =
      manager === "bun"
        ? bunGraph(parseBunLockText(text))
        : pnpmGraph(parseRestrictedYaml(text));
  }
  const platform = options.platform ?? {
    os: process.platform,
    cpu: process.arch,
  };
  const expected = expectedInventory(graph, platform);
  const expectedEdges = (key) =>
    [...expected]
      .filter((id) => graph.nodes.get(id).key === key)
      .flatMap((id) => graph.edges.get(id) ?? [])
      .filter((edge) => expected.has(edge.target));
  // Validate every dependency/shared/root link before using any inventory row.
  for (const row of entries) {
    for (const [alias, path] of row.packages)
      if (lstatSync(path).isSymbolicLink()) {
        const child = target(path, owners, store);
        if (
          !KINDS.some((kind) =>
            Object.hasOwn(row.manifest[kind] ?? {}, alias),
          ) &&
          !expectedEdges(row.key).some(
            (edge) =>
              edge.alias === alias &&
              graph.nodes.get(edge.target).key === child.key,
          )
        )
          throw new Error(`${row.id}: unaccounted dependency alias ${alias}`);
      }
    bins(row.modules, store, owners);
    if (row.localBin) bins(row.localBin, store, owners);
  }
  const shared = join(store, "node_modules");
  const sharedOwners = new Map();
  if (existsSync(shared)) {
    for (const [alias, path] of packagePaths(shared))
      sharedOwners.set(alias, target(path, owners, store));
    bins(shared, store, owners);
  }
  const roots = [];
  const metadata = ROOT_METADATA[manager];
  for (const name of readdirSync(modules).sort()) {
    if (name === storeName || name === ".bin") continue;
    if (metadata.includes(name)) regularMetadata(join(modules, name));
    else if (name.startsWith("."))
      throw new Error(`${modules}: unknown root entry ${name}`);
  }
  const rootPaths = packagePaths(modules, [storeName, ...metadata]);
  for (const [alias, path] of rootPaths)
    roots.push({ alias, owner: target(path, owners, store) });
  bins(modules, store, owners);
  const wanted = new Set([...expected].map((id) => graph.nodes.get(id).key));
  const actual = new Set(entries.map((row) => row.key));
  for (const key of new Set([...wanted.keys(), ...actual.keys()]))
    if (wanted.has(key) !== actual.has(key))
      throw new Error(`${key}: expected inventory package coverage differs`);
  const expectedRoots = graph.roots.filter((row) => expected.has(row.target));
  for (const binding of expectedRoots) {
    const found = roots.find((row) => row.alias === binding.alias);
    if (!found || found.owner.key !== graph.nodes.get(binding.target).key)
      throw new Error(
        `${binding.alias}: expected root binding missing or changed`,
      );
  }
  for (const binding of roots)
    if (!expectedRoots.some((row) => row.alias === binding.alias))
      throw new Error(`${binding.alias}: unaccounted root link`);
  for (const [alias, child] of sharedOwners) {
    const accounted =
      graph.roots.some(
        (binding) =>
          binding.alias === alias &&
          expected.has(binding.target) &&
          graph.nodes.get(binding.target).key === child.key,
      ) ||
      [...expected].some((id) =>
        expectedEdges(graph.nodes.get(id).key).some(
          (edge) =>
            edge.alias === alias &&
            graph.nodes.get(edge.target).key === child.key,
        ),
      );
    if (!accounted) throw new Error(`${alias}: unaccounted shared link`);
  }
  const rootOwners = new Map(roots.map((row) => [row.alias, row.owner]));
  for (const row of entries) {
    const direct = new Map(
      row.packages.map(([alias, path]) => [
        alias,
        lstatSync(path).isSymbolicLink() ? target(path, owners, store) : row,
      ]),
    );
    row.links = [];
    for (const kind of KINDS)
      for (const alias of Object.keys(row.manifest[kind] ?? {})) {
        const child =
          direct.get(alias) ?? sharedOwners.get(alias) ?? rootOwners.get(alias);
        if (child) {
          row.links.push({ alias, kind, owner: child });
          continue;
        }
        const expectedLink = [...expected].some(
          (id) =>
            graph.nodes.get(id).key === row.key &&
            (graph.edges.get(id) ?? []).some(
              (edge) => edge.alias === alias && expected.has(edge.target),
            ),
        );
        const optional =
          kind === "optionalDependencies" ||
          (kind === "peerDependencies" &&
            row.manifest.peerDependenciesMeta?.[alias]?.optional === true);
        if (!optional || expectedLink)
          throw new Error(
            `${row.id}: declared ${kind} alias ${alias} has no accounted resolution`,
          );
      }
    // Frozen lock metadata can declare registry-added peers/overrides absent
    // from the published manifest. Resolve their actual links, then require
    // complete contextual equivalence below; a name/version union is no proof.
    const extraAliases = new Set(
      expectedEdges(row.key)
        .filter(
          (edge) =>
            !KINDS.some((kind) =>
              Object.hasOwn(row.manifest[kind] ?? {}, edge.alias),
            ),
        )
        .map((edge) => edge.alias),
    );
    for (const alias of extraAliases) {
      const child =
        direct.get(alias) ?? sharedOwners.get(alias) ?? rootOwners.get(alias);
      if (!child) continue; // The contextual coverage check will reject omission.
      const kinds = new Set(
        expectedEdges(row.key)
          .filter(
            (edge) =>
              edge.alias === alias &&
              graph.nodes.get(edge.target).key === child.key,
          )
          .map((edge) => edge.kind),
      );
      if (kinds.size !== 1)
        throw new Error(
          `${row.id}: ambiguous frozen dependency kind for ${alias}`,
        );
      row.links.push({ alias, kind: [...kinds][0], owner: child });
    }
  }
  const resolution = {
    nodes: new Map(entries.map((row) => [row.id, { key: row.key }])),
    edges: new Map(
      entries.map((row) => [
        row.id,
        row.links.map((link) => ({
          alias: link.alias,
          kind: link.kind,
          target: link.owner.id,
        })),
      ]),
    ),
    roots: expectedRoots.map((binding) => ({
      alias: binding.alias,
      kind: binding.kind,
      target: rootOwners.get(binding.alias).id,
    })),
  };
  const expectedResolution = {
    nodes: new Map(
      [...expected].map((id) => [id, { key: graph.nodes.get(id).key }]),
    ),
    edges: new Map(
      [...expected].map((id) => [
        id,
        (graph.edges.get(id) ?? [])
          .filter((edge) => expected.has(edge.target))
          .map(({ alias, kind, target }) => ({ alias, kind, target })),
      ]),
    ),
    roots: expectedRoots.map(({ alias, kind, target }) => ({
      alias,
      kind,
      target,
    })),
  };
  const coverage = compareResolutionContexts(expectedResolution, resolution, {
    allowEquivalentSharing: true,
  });
  const contextProblems = coverage.problems;
  if (contextProblems.length)
    throw new Error(
      `Installed resolution does not match expected graph: ${contextProblems.join("; ")}`,
    );
  return {
    entries,
    roots,
    graph,
    expected,
    store,
    owners,
    platform,
    root,
    resolution,
    coverage,
  };
}
