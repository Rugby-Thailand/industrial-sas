// Dependency-free SemVer 2.0 versions and node-semver ranges (strict mode,
// no `includePrerelease`) for the T03 dependency checks: registry
// `vulnerable_versions`, override selectors and declared dependency ranges.
// Unsupported syntax throws: callers treat an unparsable range as a failed
// check, never as "not vulnerable".

const VERSION =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Parses an exact version; throws on anything else. */
export function parseVersion(text) {
  const match = VERSION.exec(String(text).trim());
  if (!match) throw new Error(`Invalid version: ${text}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

export function isExactVersion(text) {
  return typeof text === "string" && VERSION.test(text.trim());
}

function compareIdentifiers(a, b) {
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) return Number(a) - Number(b);
  if (numericA) return -1;
  if (numericB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative, zero or positive, by SemVer precedence (build metadata ignored). */
export function compareVersions(left, right) {
  const a = typeof left === "string" ? parseVersion(left) : left;
  const b = typeof right === "string" ? parseVersion(right) : right;
  for (const key of ["major", "minor", "patch"])
    if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.prerelease.length || !b.prerelease.length)
    return b.prerelease.length - a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    const order = compareIdentifiers(a.prerelease[i], b.prerelease[i]);
    if (order !== 0) return order;
  }
  return 0;
}

const PARTIAL =
  /^v?(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*])(?:-([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?)?)?$/;

function parsePartial(text) {
  const match = PARTIAL.exec(text);
  if (!match) throw new Error(`Unsupported range component: ${text}`);
  const part = (value) =>
    value === undefined || /^[xX*]$/.test(value) ? null : Number(value);
  const major = part(match[1]);
  const minor = major === null ? null : part(match[2]);
  const patch = minor === null ? null : part(match[3]);
  if (match[4] && patch === null)
    throw new Error(`Unsupported range component: ${text}`);
  return {
    major,
    minor,
    patch,
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

const exact = (major, minor, patch, prerelease = []) => ({
  major,
  minor,
  patch,
  prerelease,
});
const lowest = (p) =>
  exact(p.major ?? 0, p.minor ?? 0, p.patch ?? 0, p.prerelease);
const comparator = (operator, version) => ({ operator, version });

/** Desugars one primitive/partial/tilde/caret token into comparators. */
function desugar(token) {
  const match = /^(\^|~>?|>=|<=|>|<|=)?(.*)$/.exec(token);
  const operator = match[1] ?? "";
  const partial = parsePartial(match[2]);
  const { major, minor, patch } = partial;
  if (major === null) {
    if (operator === "<" || operator === ">")
      return [comparator("<", exact(0, 0, 0, ["0"]))];
    return [];
  }
  if (operator === "^") {
    const lower = comparator(">=", lowest(partial));
    if (major > 0 || minor === null)
      return [lower, comparator("<", exact(major + 1, 0, 0, ["0"]))];
    if (minor > 0 || patch === null)
      return [lower, comparator("<", exact(0, minor + 1, 0, ["0"]))];
    return [lower, comparator("<", exact(0, 0, patch + 1, ["0"]))];
  }
  if (operator === "~" || operator === "~>") {
    const lower = comparator(">=", lowest(partial));
    if (minor === null)
      return [lower, comparator("<", exact(major + 1, 0, 0, ["0"]))];
    return [lower, comparator("<", exact(major, minor + 1, 0, ["0"]))];
  }
  if (minor !== null && patch !== null)
    return [comparator(operator || "=", lowest(partial))];
  // An x-range: `1`, `1.2`, `>=1.2`, `<1`, `>1.x` ...
  const nextUp =
    minor === null
      ? exact(major + 1, 0, 0, ["0"])
      : exact(major, minor + 1, 0, ["0"]);
  switch (operator) {
    case "":
    case "=":
      return [comparator(">=", lowest(partial)), comparator("<", nextUp)];
    case ">=":
      return [comparator(">=", lowest(partial))];
    case "<":
      return [comparator("<", exact(major, minor ?? 0, 0, ["0"]))];
    case ">":
      return [comparator(">=", nextUp)];
    case "<=":
      return [comparator("<", nextUp)];
    default:
      throw new Error(`Unsupported range operator: ${operator}`);
  }
}

function hyphen(lowText, highText) {
  const low = parsePartial(lowText);
  const high = parsePartial(highText);
  const set = low.major === null ? [] : [comparator(">=", lowest(low))];
  if (high.major === null) return set;
  if (high.patch !== null) set.push(comparator("<=", lowest(high)));
  else if (high.minor !== null)
    set.push(comparator("<", exact(high.major, high.minor + 1, 0, ["0"])));
  else set.push(comparator("<", exact(high.major + 1, 0, 0, ["0"])));
  return set;
}

/** Parses a range into comparator sets (OR of ANDs). Throws when unsupported. */
export function parseRange(text) {
  if (typeof text !== "string") throw new Error("Range must be a string");
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "*" || /^[xX]$/.test(trimmed)) return [[]];
  return trimmed.split("||").map((part) => {
    const set = part.trim().replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, "$1");
    if (set === "") return [];
    const hyphenMatch = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphenMatch) return hyphen(hyphenMatch[1], hyphenMatch[2]);
    return set.split(/\s+/).flatMap(desugar);
  });
}

function test(comparatorEntry, version) {
  const order = compareVersions(version, comparatorEntry.version);
  switch (comparatorEntry.operator) {
    case "=":
      return order === 0;
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    default:
      throw new Error(`Unknown operator ${comparatorEntry.operator}`);
  }
}

/** True when `version` satisfies `range` (node-semver default semantics). */
export function satisfies(version, range) {
  const parsed = parseVersion(version);
  return parseRange(range).some((set) => {
    if (!set.every((entry) => test(entry, parsed))) return false;
    if (!parsed.prerelease.length) return true;
    // A prerelease only matches a set naming the same [major, minor, patch]
    // with a prerelease tag, as node-semver does without includePrerelease.
    return set.some(
      ({ version: bound }) =>
        bound.prerelease.length > 0 &&
        bound.major === parsed.major &&
        bound.minor === parsed.minor &&
        bound.patch === parsed.patch,
    );
  });
}
