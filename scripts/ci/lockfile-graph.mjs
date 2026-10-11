#!/usr/bin/env node
// T03 resolved dependency graph for pnpm-lock.yaml (v9) and bun.lock (v3).
// Opt-in candidate check; pnpm stays the authoritative installer.
//
//   node scripts/ci/lockfile-graph.mjs --scope=app|release --bun-dir=<dir>
//
// Normalizes both locks into one graph shape (nodes, parent edges, roots),
// validates integrity, unresolved/unknown edges, aliases, peers,
// optional/native constraints and every security override against the
// actual resolved parent edges, then compares the two graphs. Unsupported
// lockfile syntax or schema throws: an incomplete inventory never passes.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isExactVersion, parseRange, satisfies } from "./semver-range.mjs";

/** Path enumeration cap; exceeding it fails closed instead of truncating. */
export const MAX_PATHS = 50_000;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const PROD_ROOT_KINDS = new Set([
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
]);
const EDGE_KINDS = ["dependencies", "optionalDependencies", "peerDependencies"];

const dictionary = () => Object.create(null);

// ---------------------------------------------------------------------------
// Restricted YAML: exactly the subset pnpm writes for lockfile v9 and
// pnpm-workspace.yaml (block maps, `- scalar` lists, one-level flow maps and
// lists, quoted/plain scalars, full-line comments). Anything else throws.
// ---------------------------------------------------------------------------

function unquote(text, line) {
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2)
      throw new Error(`YAML line ${line}: unterminated quoted scalar`);
    const body = text.slice(1, -1);
    if (/(^|[^'])'([^']|$)/.test(body.replace(/''/g, "")))
      throw new Error(`YAML line ${line}: unsupported quoted scalar`);
    return body.replace(/''/g, "'");
  }
  if (text.startsWith('"')) {
    try {
      const value = JSON.parse(text);
      if (typeof value === "string") return value;
    } catch {
      // fall through
    }
    throw new Error(`YAML line ${line}: unsupported double-quoted scalar`);
  }
  return null;
}

function scalar(text, line) {
  const quoted = unquote(text, line);
  if (quoted !== null) return quoted;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^[|>&*!%@`]/.test(text) || /\s#/.test(text) || text.startsWith("- "))
    throw new Error(`YAML line ${line}: unsupported scalar ${text}`);
  return text;
}

function splitFlow(inner, line) {
  const items = [];
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === "{" || char === "[" || char === "}" || char === "]")
      throw new Error(`YAML line ${line}: nested flow collections`);
    else if (char === ",") {
      items.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote) throw new Error(`YAML line ${line}: unterminated quote`);
  items.push(inner.slice(start).trim());
  if (items.some((item) => item === ""))
    throw new Error(`YAML line ${line}: empty flow item`);
  return items;
}

function splitKey(text, line) {
  if (text.startsWith("'") || text.startsWith('"')) {
    const quote = text[0];
    let end = 1;
    while (end < text.length) {
      if (text[end] === quote) {
        if (quote === "'" && text[end + 1] === "'") {
          end += 2;
          continue;
        }
        break;
      }
      end += 1;
    }
    if (text[end + 1] !== ":")
      throw new Error(`YAML line ${line}: expected ':' after quoted key`);
    return [unquote(text.slice(0, end + 1), line), text.slice(end + 2)];
  }
  const separator = text.indexOf(": ");
  if (separator > 0)
    return [text.slice(0, separator), text.slice(separator + 1)];
  if (text.endsWith(":") && !text.slice(0, -1).includes(": "))
    return [text.slice(0, -1), ""];
  throw new Error(`YAML line ${line}: expected key: value`);
}

function value(text, line) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    if (!trimmed.endsWith("}"))
      throw new Error(`YAML line ${line}: unterminated flow map`);
    const map = dictionary();
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return map;
    for (const item of splitFlow(inner, line)) {
      const [key, rest] = splitKey(item, line);
      if (key === "__proto__" || key in map)
        throw new Error(`YAML line ${line}: duplicate or reserved key`);
      map[key] = scalar(rest.trim(), line);
    }
    return map;
  }
  if (trimmed.startsWith("[")) {
    if (!trimmed.endsWith("]"))
      throw new Error(`YAML line ${line}: unterminated flow list`);
    const inner = trimmed.slice(1, -1).trim();
    return inner
      ? splitFlow(inner, line).map((item) => scalar(item, line))
      : [];
  }
  return scalar(trimmed, line);
}

/** Parses the YAML subset used by pnpm v9 locks and pnpm-workspace.yaml. */
export function parseRestrictedYaml(text) {
  if (typeof text !== "string") throw new Error("YAML input must be text");
  const lines = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");
    if (/^\s*(#.*)?$/.test(line)) return;
    if (line.includes("\t")) throw new Error(`YAML line ${index + 1}: tab`);
    const indent = line.length - line.trimStart().length;
    lines.push({ indent, body: line.trim(), number: index + 1 });
  });
  let position = 0;
  const block = (indent) => {
    if (lines[position].body.startsWith("- ")) {
      const list = [];
      while (position < lines.length && lines[position].indent === indent) {
        const { body, number } = lines[position];
        if (!body.startsWith("- "))
          throw new Error(`YAML line ${number}: mixed list and map`);
        list.push(scalar(body.slice(2).trim(), number));
        position += 1;
      }
      return list;
    }
    const map = dictionary();
    while (position < lines.length && lines[position].indent === indent) {
      const { body, number } = lines[position];
      const [key, rest] = splitKey(body, number);
      if (key === "__proto__" || key in map)
        throw new Error(
          `YAML line ${number}: duplicate or reserved key ${key}`,
        );
      position += 1;
      if (rest.trim() === "") {
        if (position >= lines.length || lines[position].indent <= indent)
          map[key] = null;
        else map[key] = block(lines[position].indent);
      } else map[key] = value(rest, number);
    }
    if (position < lines.length && lines[position].indent > indent)
      throw new Error(`YAML line ${lines[position].number}: bad indentation`);
    return map;
  };
  if (!lines.length) return dictionary();
  if (lines[0].indent !== 0) throw new Error("YAML must start at column 0");
  const result = block(0);
  if (position !== lines.length)
    throw new Error(`YAML line ${lines[position].number}: bad indentation`);
  return result;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Splits `name@version` (scoped names keep their leading `@`). */
export function splitNameVersion(id) {
  const at = id.indexOf("@", 1);
  if (at <= 0) throw new Error(`Not a name@version identifier: ${id}`);
  return { name: id.slice(0, at), version: id.slice(at + 1) };
}

/** pnpm's dependency-reference resolution (refToRelative, pnpm 10.33.2). */
export function pnpmReference(reference, alias) {
  if (typeof reference !== "string") return null;
  if (reference.startsWith("link:")) return null;
  if (reference[0] === "@") return reference;
  const at = reference.indexOf("@");
  if (at === -1) return `${alias}@${reference}`;
  const colon = reference.indexOf(":");
  const bracket = reference.indexOf("(");
  if ((colon === -1 || at < colon) && (bracket === -1 || at < bracket))
    return reference;
  return `${alias}@${reference}`;
}

const asList = (value) =>
  value === undefined || value === null
    ? []
    : (Array.isArray(value) ? value : [value]).map(String).sort();

function graphShell(format, scope) {
  return {
    format,
    scope,
    nodes: new Map(),
    edges: new Map(),
    roots: [],
    overrides: dictionary(),
    problems: [],
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// pnpm-lock.yaml v9
// ---------------------------------------------------------------------------

/** Normalized graph from a parsed pnpm v9 lock with one importer (`.`). */
export function pnpmGraph(lock, { scope } = {}) {
  if (lock?.lockfileVersion !== "9.0")
    throw new Error(
      `Unsupported pnpm lockfileVersion ${lock?.lockfileVersion}`,
    );
  const importers = lock.importers ?? {};
  if (Object.keys(importers).join() !== ".")
    throw new Error("Expected exactly one pnpm importer `.`");
  const graph = graphShell("pnpm-lock-v9", scope);
  graph.overrides = { ...(lock.overrides ?? {}) };
  const packages = lock.packages ?? dictionary();
  const snapshots = lock.snapshots ?? dictionary();
  const referenced = new Set();
  for (const [id, snapshot] of Object.entries(snapshots)) {
    const packageKey = id.includes("(") ? id.slice(0, id.indexOf("(")) : id;
    const record = packages[packageKey];
    if (!record) {
      graph.problems.push(`${id}: snapshot has no package record`);
      continue;
    }
    referenced.add(packageKey);
    const { name, version } = splitNameVersion(packageKey);
    const resolution = record.resolution ?? {};
    const keys = Object.keys(resolution);
    if (keys.length !== 1 || keys[0] !== "integrity")
      graph.problems.push(
        `${packageKey}: unsupported resolution (${keys.join(",") || "none"})`,
      );
    graph.nodes.set(id, {
      id,
      name,
      version,
      key: packageKey,
      integrity: resolution.integrity ?? null,
      registry: "",
      os: asList(record.os),
      cpu: asList(record.cpu),
      libc: asList(record.libc),
      optional: snapshot?.optional === true,
    });
  }
  for (const key of Object.keys(packages))
    if (!referenced.has(key))
      graph.problems.push(`${key}: package record has no snapshot`);
  for (const [id, snapshot] of Object.entries(snapshots)) {
    if (!graph.nodes.has(id)) continue;
    const edges = [];
    for (const kind of ["dependencies", "optionalDependencies"]) {
      for (const [alias, reference] of Object.entries(snapshot?.[kind] ?? {})) {
        const target = pnpmReference(reference, alias);
        if (target === null || !graph.nodes.has(target)) {
          graph.problems.push(
            `${id} -> ${alias}@${reference}: unresolved edge`,
          );
          edges.push({
            alias,
            kind,
            target: null,
            declared: String(reference),
          });
          continue;
        }
        edges.push({ alias, kind, target, declared: String(reference) });
      }
    }
    graph.edges.set(id, edges);
  }
  const importer = importers["."];
  for (const kind of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    for (const [alias, entry] of Object.entries(importer[kind] ?? {})) {
      const target = pnpmReference(entry?.version, alias);
      if (target === null || !graph.nodes.has(target))
        graph.problems.push(`. -> ${alias}: unresolved root`);
      graph.roots.push({
        alias,
        kind,
        specifier: entry?.specifier ?? null,
        target: target && graph.nodes.has(target) ? target : null,
      });
    }
  }
  return graph;
}

// ---------------------------------------------------------------------------
// bun.lock v3 (text lockfile; JSON with trailing commas)
// ---------------------------------------------------------------------------

/** Parses bun.lock text: JSON plus trailing commas, nothing else. */
export function parseBunLockText(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && (text[i + 1] === "/" || text[i + 1] === "*"))
      throw new Error("bun.lock comments are unsupported");
    if (char === ",") {
      let j = i + 1;
      while (/\s/.test(text[j] ?? "")) j += 1;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += char;
  }
  return JSON.parse(out);
}

/** Package-name segments of a bun.lock key (`a/@s/b/c` → a, @s/b, c). */
export function bunKeySegments(key) {
  if (key === "") return [];
  const parts = key.split("/");
  const segments = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith("@")) {
      if (i + 1 >= parts.length) throw new Error(`Bad bun.lock key ${key}`);
      segments.push(`${parts[i]}/${parts[i + 1]}`);
      i += 1;
    } else segments.push(parts[i]);
  }
  return segments;
}

/** Normalizes bun.lock `overrides` into pnpm-style `parent>child` keys. */
export function normalizeBunOverrides(overrides = {}) {
  const flat = dictionary();
  for (const [key, entry] of Object.entries(overrides)) {
    if (typeof entry === "string") {
      flat[key] = entry;
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error(`Unsupported bun.lock override ${key}`);
    for (const [child, target] of Object.entries(entry)) {
      if (typeof target !== "string")
        throw new Error(`Unsupported nested bun.lock override ${key}>${child}`);
      flat[child === "." ? key : `${key}>${child}`] = target;
    }
  }
  return flat;
}

const NPM_TUPLE_ID = /^(@[^@/]+\/[^@/]+|[^@/]+)@([^:]+)$/;

/** Normalized graph from a parsed bun.lock v3 with one root workspace. */
export function bunGraph(lock, { scope } = {}) {
  if (lock?.lockfileVersion !== 3)
    throw new Error(
      `Unsupported bun.lock lockfileVersion ${lock?.lockfileVersion}`,
    );
  const workspaces = lock.workspaces ?? {};
  if (Object.keys(workspaces).join() !== "")
    throw new Error("Expected exactly one bun.lock workspace (the root)");
  const graph = graphShell("bun-lock-v3", scope);
  graph.overrides = normalizeBunOverrides(lock.overrides);
  const packages = lock.packages ?? {};
  const metas = new Map();
  for (const [key, tuple] of Object.entries(packages)) {
    const match =
      Array.isArray(tuple) && typeof tuple[0] === "string"
        ? NPM_TUPLE_ID.exec(tuple[0])
        : null;
    if (
      !match ||
      tuple.length !== 4 ||
      typeof tuple[1] !== "string" ||
      !tuple[2] ||
      typeof tuple[2] !== "object" ||
      !isExactVersion(match[2])
    ) {
      graph.problems.push(`${key}: unsupported bun.lock package entry`);
      continue;
    }
    const meta = tuple[2];
    metas.set(key, meta);
    if (tuple[1] !== "")
      graph.notes.push(`${key}: non-default registry ${tuple[1]}`);
    graph.nodes.set(key, {
      id: key,
      name: match[1],
      version: match[2],
      key: `${match[1]}@${match[2]}`,
      integrity: typeof tuple[3] === "string" ? tuple[3] : null,
      registry: tuple[1],
      os: asList(meta.os),
      cpu: asList(meta.cpu),
      libc: asList(meta.libc),
      optional: false,
    });
  }
  const lookup = (fromKey, alias) => {
    const segments = bunKeySegments(fromKey);
    for (let i = segments.length; i >= 0; i--) {
      const candidate = [...segments.slice(0, i), alias].join("/");
      if (graph.nodes.has(candidate)) return candidate;
    }
    return null;
  };
  const resolveEdge = (fromKey, alias, kind, declared, optionalPeers) => {
    const target = lookup(fromKey, alias);
    const label = `${fromKey || "."} -> ${alias}`;
    if (target === null) {
      if (kind === "peerDependencies" && optionalPeers.has(alias)) return null;
      graph.problems.push(`${label}: unresolved ${kind} edge`);
      return { alias, kind, target: null, declared };
    }
    const node = graph.nodes.get(target);
    const aliased = /^npm:(.+)$/.exec(declared ?? "");
    const expected = aliased
      ? aliased[1].startsWith("@")
        ? aliased[1].slice(0, aliased[1].indexOf("@", 1))
        : aliased[1].split("@")[0]
      : alias;
    if (node.name !== expected)
      graph.problems.push(
        `${label}: resolves to ${node.key}, expected package ${expected}`,
      );
    return { alias, kind, target, declared };
  };
  for (const [key, meta] of metas) {
    const optionalPeers = new Set(meta.optionalPeers ?? []);
    const edges = [];
    for (const kind of EDGE_KINDS)
      for (const [alias, declared] of Object.entries(meta[kind] ?? {})) {
        const edge = resolveEdge(
          key,
          alias,
          kind,
          String(declared),
          optionalPeers,
        );
        if (edge) edges.push(edge);
      }
    graph.edges.set(key, edges);
  }
  const root = workspaces[""];
  for (const kind of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [alias, specifier] of Object.entries(root[kind] ?? {})) {
      const edge = resolveEdge("", alias, kind, String(specifier), new Set());
      graph.roots.push({
        alias,
        kind,
        specifier: String(specifier),
        target: edge?.target ?? null,
      });
    }
  }
  return graph;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function traverse(graph, starts) {
  const seen = new Set();
  const queue = [...starts];
  while (queue.length) {
    const id = queue.pop();
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.edges.get(id) ?? [])
      if (edge.target !== null) queue.push(edge.target);
  }
  return seen;
}

/** Node IDs reachable from production roots and from development roots. */
export function reachability(graph) {
  const production = traverse(
    graph,
    graph.roots
      .filter((root) => PROD_ROOT_KINDS.has(root.kind))
      .map((root) => root.target),
  );
  const development = traverse(
    graph,
    graph.roots
      .filter((root) => root.kind === "devDependencies")
      .map((root) => root.target),
  );
  return { production, development };
}

/**
 * Structural problems: parse-level problems, missing/invalid integrity,
 * conflicting integrity for one name@version and lock entries no root reaches.
 */
export function graphProblems(graph) {
  const problems = [...graph.problems];
  const integrity = new Map();
  for (const node of graph.nodes.values()) {
    if (!INTEGRITY.test(node.integrity ?? ""))
      problems.push(`${node.key}: missing or invalid sha512 integrity`);
    const known = integrity.get(node.key);
    if (known && known !== node.integrity)
      problems.push(`${node.key}: conflicting integrity values`);
    integrity.set(node.key, node.integrity);
  }
  const { production, development } = reachability(graph);
  for (const id of graph.nodes.keys())
    if (!production.has(id) && !development.has(id))
      problems.push(`${id}: lock entry is not reachable from any root`);
  return problems;
}

/**
 * Every simple root→target chain (cycle-free, multiple routes kept) as
 * `.>parent>…>name`. `production` is true when the chain starts at a
 * production root. Throws past `maxPaths`: a capped list is never returned.
 */
export function allSimplePaths(graph, isTarget, { maxPaths = MAX_PATHS } = {}) {
  const targets = [...graph.nodes.values()]
    .filter(isTarget)
    .map((node) => node.id);
  const reverse = new Map();
  for (const [from, edges] of graph.edges)
    for (const edge of edges)
      if (edge.target !== null) {
        if (!reverse.has(edge.target)) reverse.set(edge.target, new Set());
        reverse.get(edge.target).add(from);
      }
  const canReach = new Set();
  const queue = [...targets];
  while (queue.length) {
    const id = queue.pop();
    if (canReach.has(id)) continue;
    canReach.add(id);
    for (const parent of reverse.get(id) ?? []) queue.push(parent);
  }
  const found = new Map();
  const targetSet = new Set(targets);
  const stack = new Set();
  const visit = (id, names, production) => {
    if (stack.has(id) || !canReach.has(id)) return;
    const node = graph.nodes.get(id);
    const trail = [...names, node.name];
    if (targetSet.has(id)) {
      const path = trail.join(">");
      const entry = found.get(path) ?? {
        path,
        production: false,
        versions: new Set(),
      };
      entry.production ||= production;
      entry.versions.add(node.version);
      found.set(path, entry);
      if (found.size > maxPaths)
        throw new Error(
          `More than ${maxPaths} dependency paths; refusing to truncate`,
        );
    }
    stack.add(id);
    for (const edge of graph.edges.get(id) ?? [])
      if (edge.target !== null) visit(edge.target, trail, production);
    stack.delete(id);
  };
  for (const root of graph.roots)
    if (root.target !== null)
      visit(root.target, ["."], PROD_ROOT_KINDS.has(root.kind));
  return [...found.values()]
    .map((entry) => ({ ...entry, versions: [...entry.versions].sort() }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The single path per peer-qualified snapshot that pnpm 10.33.2 sends to the
 * registry: its audit tree (lockfileToAuditTree) walks each snapshot once,
 * claiming all siblings before descending, so later routes are pruned.
 * Returns `name@version` → paths, for explaining `findings.paths`.
 */
export function pnpmAuditTreePaths(lock, { includeDev = true } = {}) {
  const snapshots = lock.snapshots ?? {};
  const importer = lock.importers?.["."];
  if (!importer) throw new Error("Expected pnpm importer `.`");
  const walked = new Set();
  const step = (depPaths) => {
    const entries = [];
    for (const depPath of depPaths) {
      if (walked.has(depPath)) continue;
      walked.add(depPath);
      if (snapshots[depPath]) entries.push(depPath);
    }
    return entries;
  };
  const build = (depPaths) => {
    const children = new Map();
    for (const depPath of depPaths) {
      const snapshot = snapshots[depPath];
      const base = depPath.includes("(")
        ? depPath.slice(0, depPath.indexOf("("))
        : depPath;
      const { name, version } = splitNameVersion(base);
      const next = Object.entries({
        ...(snapshot.dependencies ?? {}),
        ...(snapshot.optionalDependencies ?? {}),
      })
        .map(([alias, reference]) => pnpmReference(reference, alias))
        .filter((id) => id !== null);
      children.set(name, { version, children: build(step(next)) });
    }
    return children;
  };
  const roots = Object.entries({
    ...(includeDev ? importer.devDependencies : {}),
    ...importer.dependencies,
    ...importer.optionalDependencies,
  })
    .map(([alias, entry]) => pnpmReference(entry?.version, alias))
    .filter((id) => id !== null);
  const tree = build(step(roots));
  const paths = new Map();
  const collect = (children, trail) => {
    for (const [name, child] of children) {
      const path = [...trail, name];
      const key = `${name}@${child.version}`;
      if (!paths.has(key)) paths.set(key, []);
      paths.get(key).push(path.join(">"));
      collect(child.children, path);
    }
  };
  collect(tree, ["."]);
  return paths;
}

/** Parses `name`, `name@range`, `parent>child`, `parent@range>child@range`. */
export function parseOverrideKey(key) {
  // `>` separates parent and child; inside a selector it is a comparator
  // (`>=1`, `> 1`, `>1`), always followed by `=`, whitespace, a digit or `v`.
  const parts = key.split(/>(?![=\s\dvxX*])/);
  if (parts.length > 2)
    throw new Error(`${key}: Bun supports one parent level only`);
  const selector = (text) => {
    const at = text.indexOf("@", text.startsWith("@") ? 1 : 0);
    if (at <= 0) return { name: text, range: null };
    const range = text.slice(at + 1);
    if (!range) throw new Error(`${key}: empty version selector`);
    parseRange(range);
    return { name: text.slice(0, at), range };
  };
  const child = selector(parts.at(-1));
  const parent = parts.length === 2 ? selector(parts[0]) : null;
  return {
    key,
    parent: parent?.name ?? null,
    parentRange: parent?.range ?? null,
    child: child.name,
    childRange: child.range,
  };
}

function* allEdges(graph) {
  for (const root of graph.roots)
    yield {
      from: null,
      alias: root.alias,
      kind: root.kind,
      target: root.target,
      declared: root.specifier,
    };
  for (const [from, edges] of graph.edges)
    for (const edge of edges) yield { from, ...edge };
}

/**
 * Checks each exact override against actual resolved parent edges:
 * unscoped/parent rules must resolve to the override version; a
 * version-scoped rule must leave no resolved version inside its selector.
 */
export function overrideProblems(graph, overrides) {
  const problems = [];
  const applied = dictionary();
  for (const [key, target] of Object.entries(overrides ?? {})) {
    let rule;
    try {
      rule = parseOverrideKey(key);
    } catch (error) {
      problems.push(error.message);
      continue;
    }
    if (!isExactVersion(target)) {
      problems.push(`${key}: override value ${target} is not an exact version`);
      continue;
    }
    applied[key] = 0;
    for (const edge of allEdges(graph)) {
      if (edge.target === null) continue;
      const node = graph.nodes.get(edge.target);
      if (node.name !== rule.child) continue;
      const parent = edge.from === null ? null : graph.nodes.get(edge.from);
      if (rule.parent !== null) {
        if (!parent || parent.name !== rule.parent) continue;
        if (rule.parentRange && !satisfies(parent.version, rule.parentRange))
          continue;
      }
      const label = `${parent?.key ?? "."}>${node.key}`;
      if (rule.childRange !== null) {
        if (satisfies(node.version, rule.childRange))
          problems.push(
            `${key}: ${label} is still inside the overridden range`,
          );
        else if (node.version === target) applied[key] += 1;
      } else if (node.version !== target)
        problems.push(
          `${key}: ${label} resolved ${node.version}, override requires ${target}`,
        );
      else applied[key] += 1;
    }
  }
  const inactive = Object.entries(applied)
    .filter(([, count]) => count === 0)
    .map(([key]) => key);
  return { problems, applied, inactive };
}

/**
 * Declared-range check for locks that record declared ranges (bun.lock):
 * each resolved version must satisfy its declared range unless an
 * override applies. Peer mismatches are warnings (strict peers are off).
 */
export function declaredRangeProblems(graph, overrides = {}) {
  const rules = Object.entries(overrides).map(([key, target]) => ({
    ...parseOverrideKey(key),
    target,
  }));
  const problems = [];
  const warnings = [];
  for (const edge of allEdges(graph)) {
    if (edge.target === null || edge.declared === null) continue;
    const node = graph.nodes.get(edge.target);
    const declared = String(edge.declared).replace(/^npm:(@?[^@]+)@/, "");
    let ok;
    try {
      ok = satisfies(
        node.version,
        declared.includes("(")
          ? declared.slice(0, declared.indexOf("("))
          : declared,
      );
    } catch {
      problems.push(
        `${edge.from ?? "."} -> ${edge.alias}: unsupported declared spec ${edge.declared}`,
      );
      continue;
    }
    if (ok) continue;
    const parent = edge.from === null ? null : graph.nodes.get(edge.from);
    const explained = rules.some(
      (rule) =>
        rule.child === node.name &&
        rule.target === node.version &&
        (rule.parent === null || rule.parent === parent?.name),
    );
    if (explained) continue;
    const message = `${parent?.key ?? "."} -> ${node.key}: outside declared ${edge.declared}`;
    if (edge.kind === "peerDependencies") warnings.push(message);
    else problems.push(message);
  }
  return { problems, warnings };
}

/** Root pins: every manifest dependency is an exact pin resolved exactly. */
export function rootPinProblems(graph, manifest) {
  const problems = [];
  const kinds = ["dependencies", "devDependencies", "optionalDependencies"];
  for (const kind of kinds)
    for (const [name, specifier] of Object.entries(manifest[kind] ?? {})) {
      const root = graph.roots.find(
        (entry) => entry.alias === name && entry.kind === kind,
      );
      if (!isExactVersion(specifier))
        problems.push(`${kind}.${name}: ${specifier} is not an exact pin`);
      if (!root || root.target === null) {
        problems.push(`${kind}.${name}: not resolved in ${graph.format}`);
        continue;
      }
      const node = graph.nodes.get(root.target);
      if (root.specifier !== specifier || node.version !== specifier)
        problems.push(
          `${kind}.${name}: manifest ${specifier}, lock ${root.specifier} → ${node.version}`,
        );
    }
  for (const root of graph.roots)
    if (!(manifest[root.kind] ?? {})[root.alias])
      problems.push(`${root.kind}.${root.alias}: in lock but not in manifest`);
  return problems;
}

/** Installed packages that violate OS/CPU constraints or are missing. */
export function platformProblems(graph, installedKeys, { os, cpu }) {
  const problems = [];
  const matches = (node) =>
    (!node.os.length ||
      node.os.includes(os) ||
      node.os.every((v) => v.startsWith("!") && v !== `!${os}`)) &&
    (!node.cpu.length ||
      node.cpu.includes(cpu) ||
      node.cpu.every((v) => v.startsWith("!") && v !== `!${cpu}`));
  const byKey = new Map();
  for (const node of graph.nodes.values()) byKey.set(node.key, node);
  for (const key of installedKeys) {
    const node = byKey.get(key);
    if (!node) problems.push(`${key}: installed but not in the lock`);
    else if (!matches(node))
      problems.push(
        `${key}: installed on ${os}/${cpu} despite os/cpu constraint`,
      );
  }
  for (const node of byKey.values())
    if (matches(node) && !installedKeys.has(node.key))
      problems.push(
        `${node.key}: platform-compatible lock entry not installed`,
      );
  return problems;
}

const sortedDifference = (a, b) => [...a].filter((x) => !b.has(x)).sort();

/** Package/edge/root/reachability/platform differences between two graphs. */
export function compareGraphs(baseline, candidate) {
  const inventory = (graph) => {
    const packages = new Map();
    const edges = new Set();
    const roots = new Set();
    for (const node of graph.nodes.values()) packages.set(node.key, node);
    for (const [from, list] of graph.edges)
      for (const edge of list)
        if (edge.target !== null)
          edges.add(
            `${graph.nodes.get(from).key} -> ${graph.nodes.get(edge.target).key}`,
          );
    for (const root of graph.roots)
      roots.add(
        `${root.kind}:${root.alias} -> ${root.target ? graph.nodes.get(root.target).key : "?"}`,
      );
    const { production } = reachability(graph);
    const prod = new Set([...production].map((id) => graph.nodes.get(id).key));
    return { packages, edges, roots, prod };
  };
  const a = inventory(baseline);
  const b = inventory(candidate);
  const keysA = new Set(a.packages.keys());
  const keysB = new Set(b.packages.keys());
  const differences = {
    packagesOnlyInBaseline: sortedDifference(keysA, keysB),
    packagesOnlyInCandidate: sortedDifference(keysB, keysA),
    integrityMismatches: [],
    platformMismatches: [],
    edgesOnlyInBaseline: sortedDifference(a.edges, b.edges),
    edgesOnlyInCandidate: sortedDifference(b.edges, a.edges),
    rootsOnlyInBaseline: sortedDifference(a.roots, b.roots),
    rootsOnlyInCandidate: sortedDifference(b.roots, a.roots),
    productionOnlyInBaseline: sortedDifference(a.prod, b.prod),
    productionOnlyInCandidate: sortedDifference(b.prod, a.prod),
    libcDroppedInCandidate: [],
  };
  for (const [key, node] of a.packages) {
    const other = b.packages.get(key);
    if (!other) continue;
    if (node.integrity !== other.integrity)
      differences.integrityMismatches.push(key);
    if (
      node.os.join() !== other.os.join() ||
      node.cpu.join() !== other.cpu.join()
    )
      differences.platformMismatches.push(key);
    if (node.libc.join() !== other.libc.join())
      differences.libcDroppedInCandidate.push(
        `${key} (${node.libc.join("|")} → ${other.libc.join("|") || "none"})`,
      );
  }
  const problems = [];
  for (const [name, list] of Object.entries(differences))
    if (list.length && name !== "libcDroppedInCandidate")
      problems.push(
        `${name}: ${list.length} (${list.slice(0, 5).join("; ")}${list.length > 5 ? "; …" : ""})`,
      );
  return {
    problems,
    differences,
    counts: {
      baseline: {
        packages: keysA.size,
        nodes: baseline.nodes.size,
        edges: a.edges.size,
        roots: a.roots.size,
        production: a.prod.size,
      },
      candidate: {
        packages: keysB.size,
        nodes: candidate.nodes.size,
        edges: b.edges.size,
        roots: b.roots.size,
        production: b.prod.size,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// CLI: compare the repository pnpm lock with a candidate bun.lock directory.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SCOPE_DIRECTORIES = Object.freeze({
  app: ".",
  release: "tools/release",
});

/** Loads the authoritative pnpm graph and manifest for a scope. */
export function loadPnpmScope(scope, repositoryRoot = root) {
  const directory = join(repositoryRoot, SCOPE_DIRECTORIES[scope]);
  const lock = parseRestrictedYaml(
    readFileSync(join(directory, "pnpm-lock.yaml"), "utf8"),
  );
  const workspace = parseRestrictedYaml(
    readFileSync(join(directory, "pnpm-workspace.yaml"), "utf8"),
  );
  const manifest = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  return {
    directory,
    lock,
    workspace,
    manifest,
    graph: pnpmGraph(lock, { scope }),
  };
}

/** Loads a candidate bun.lock graph; refuses a directory without bun.lock. */
export function loadBunScope(scope, bunDirectory) {
  const lockPath = join(bunDirectory, "bun.lock");
  if (!existsSync(lockPath)) throw new Error(`${lockPath} does not exist`);
  const lock = parseBunLockText(readFileSync(lockPath, "utf8"));
  const manifest = JSON.parse(
    readFileSync(join(bunDirectory, "package.json"), "utf8"),
  );
  return { lock, manifest, graph: bunGraph(lock, { scope }) };
}

const sameJson = (a, b) =>
  JSON.stringify(Object.entries(a ?? {}).sort()) ===
  JSON.stringify(Object.entries(b ?? {}).sort());

/** Full candidate report for one scope; `problems` empty means parity. */
export function scopeReport(
  scope,
  bunDirectory,
  { packageName = "braces", repositoryRoot = root } = {},
) {
  const pnpm = loadPnpmScope(scope, repositoryRoot);
  const bun = loadBunScope(scope, bunDirectory);
  const problems = [];
  const prefix = (label, list) => list.map((entry) => `${label}: ${entry}`);
  const workspaceOverrides = pnpm.workspace.overrides ?? {};
  if (!sameJson(workspaceOverrides, pnpm.lock.overrides))
    problems.push("pnpm: lock overrides differ from pnpm-workspace.yaml");
  if (!sameJson(workspaceOverrides, bun.graph.overrides))
    problems.push("bun: bun.lock overrides differ from pnpm-workspace.yaml");
  if (!sameJson(workspaceOverrides, bun.manifest.overrides))
    problems.push(
      "bun: candidate package.json overrides differ from pnpm-workspace.yaml",
    );
  for (const kind of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ])
    if (!sameJson(pnpm.manifest[kind], bun.manifest[kind]))
      problems.push(
        `bun: candidate package.json ${kind} differ from the repository manifest`,
      );
  if (
    !Array.isArray(bun.manifest.trustedDependencies) ||
    bun.manifest.trustedDependencies.length
  )
    problems.push(
      "bun: candidate package.json must declare trustedDependencies: []",
    );
  problems.push(...prefix("pnpm graph", graphProblems(pnpm.graph)));
  problems.push(...prefix("bun graph", graphProblems(bun.graph)));
  const pnpmOverrides = overrideProblems(pnpm.graph, workspaceOverrides);
  const bunOverrides = overrideProblems(bun.graph, workspaceOverrides);
  problems.push(...prefix("pnpm override", pnpmOverrides.problems));
  problems.push(...prefix("bun override", bunOverrides.problems));
  const declared = declaredRangeProblems(bun.graph, workspaceOverrides);
  problems.push(...prefix("bun declared range", declared.problems));
  problems.push(
    ...prefix("pnpm root", rootPinProblems(pnpm.graph, pnpm.manifest)),
  );
  problems.push(
    ...prefix("bun root", rootPinProblems(bun.graph, bun.manifest)),
  );
  const comparison = compareGraphs(pnpm.graph, bun.graph);
  problems.push(...prefix("graph parity", comparison.problems));
  const isPackage = (node) => node.name === packageName;
  const pnpmPaths = allSimplePaths(pnpm.graph, isPackage);
  const bunPaths = allSimplePaths(bun.graph, isPackage);
  const pnpmPathSet = new Set(pnpmPaths.map((entry) => entry.path));
  const bunPathSet = new Set(bunPaths.map((entry) => entry.path));
  if (
    sortedDifference(pnpmPathSet, bunPathSet).length ||
    sortedDifference(bunPathSet, pnpmPathSet).length
  )
    problems.push(`graph parity: ${packageName} simple paths differ`);
  const auditTree = pnpmAuditTreePaths(pnpm.lock);
  const compressed = [...auditTree.entries()]
    .filter(([key]) => key.startsWith(`${packageName}@`))
    .map(([key, paths]) => ({ key, paths }));
  return {
    scope,
    problems,
    overrides: {
      pnpm: {
        applied: pnpmOverrides.applied,
        inactive: pnpmOverrides.inactive,
      },
      bun: { applied: bunOverrides.applied, inactive: bunOverrides.inactive },
    },
    declaredRangeWarnings: declared.warnings,
    notes: [...pnpm.graph.notes, ...bun.graph.notes],
    comparison,
    paths: {
      package: packageName,
      pnpmAllSimple: pnpmPaths,
      bunAllSimple: bunPaths,
      pnpmAuditTree: compressed,
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const match = /^--([a-z-]+)=(.+)$/.exec(arg);
      return match ? [match[1], match[2]] : [arg, ""];
    }),
  );
  if (
    !["app", "release"].includes(args.scope) ||
    !args["bun-dir"] ||
    Object.keys(args).some(
      (key) => !["scope", "bun-dir", "package"].includes(key),
    )
  ) {
    console.error(
      "Usage: lockfile-graph.mjs --scope=app|release --bun-dir=<dir> [--package=<name>]",
    );
    process.exit(2);
  }
  try {
    const report = scopeReport(args.scope, resolve(args["bun-dir"]), {
      packageName: args.package ?? "braces",
    });
    console.log(JSON.stringify(report, null, 2));
    for (const problem of report.problems) console.error(problem);
    process.exitCode = report.problems.length ? 1 : 0;
  } catch (error) {
    console.error(
      `Graph check failed closed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
