// Pure helpers for scripts/ci/validate-workflows.mjs (CI-01/CI-02/CI-11/S1/
// S2/S6/S10/S14/R1/R6/R10). Dependency-free: a deliberately small YAML subset
// reader (fails closed on anything it does not understand; actionlint parses
// real YAML) plus repository-specific workflow policy.

/**
 * GHSA ids that dependency review may allow right now: unexpired entries of
 * the root-owned scripts/ci/dependency-exceptions.json (`expiresAt` ISO).
 */
export function activeExceptionGhsas(document, now) {
  return [
    ...new Set(
      (Array.isArray(document?.exceptions) ? document.exceptions : [])
        .filter((entry) => Date.parse(entry?.expiresAt) > now)
        .map((entry) => entry.ghsa)
        .filter((ghsa) => /^GHSA(-[a-z0-9]{4}){3}$/.test(ghsa ?? "")),
    ),
  ].sort();
}

// ---------------------------------------------------------------------------
// YAML subset: block maps/sequences, plain/quoted scalars, one-line flow
// sequences, `|`/`>` block scalars and comments. Anchors, aliases, tags,
// flow maps and multi-document streams are rejected.
// ---------------------------------------------------------------------------

const KEY =
  /^("(?:[^"\\]|\\.)+"|'(?:[^']|'')+'|[A-Za-z0-9_$][A-Za-z0-9_.\-/ ]*?)\s*:(?:\s+(.*))?$/;

function stripComment(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\" && quote === '"') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "#" && (index === 0 || /\s/.test(text[index - 1])))
      return text.slice(0, index).trimEnd();
  }
  return text.trimEnd();
}

function unquote(key) {
  if (key.startsWith('"')) return JSON.parse(key);
  if (key.startsWith("'")) return key.slice(1, -1).replaceAll("''", "'");
  return key;
}

function parseScalar(text, fail) {
  if (text.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) fail("unterminated string");
    return JSON.parse(text);
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) fail("unterminated string");
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text.startsWith("[")) {
    if (!text.endsWith("]") || /[[\]{}]/.test(text.slice(1, -1)))
      fail("unsupported flow sequence");
    const inner = text.slice(1, -1).trim();
    return inner === ""
      ? []
      : inner.split(",").map((item) => parseScalar(item.trim(), fail));
  }
  if (text === "{}") return {};
  if (/^[{&*!%@`]/.test(text) || text === "---")
    fail(`unsupported YAML construct: ${text.slice(0, 20)}`);
  return text;
}

export function parseYamlSubset(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  let at = 0;
  const fail = (message) => {
    throw new Error(`YAML line ${at + 1}: ${message}`);
  };
  if (lines.some((line) => /^\s*\t/.test(line))) fail("tab indentation");
  const indentOf = (line) => /^ */.exec(line)[0].length;
  const skippable = (line) => {
    const trimmed = line.trim();
    return trimmed === "" || trimmed.startsWith("#");
  };
  const peek = () => {
    while (at < lines.length && skippable(lines[at])) at += 1;
    return at < lines.length ? lines[at] : null;
  };
  const contentOf = (line) => stripComment(line.slice(indentOf(line)));
  const isItem = (content) => content === "-" || content.startsWith("- ");

  function blockScalar(indicator, parentIndent) {
    const body = [];
    while (
      at < lines.length &&
      (lines[at].trim() === "" || indentOf(lines[at]) > parentIndent)
    ) {
      body.push(lines[at]);
      at += 1;
    }
    while (body.length > 0 && body.at(-1).trim() === "") body.pop();
    const margin = Math.min(
      ...body.filter((line) => line.trim()).map(indentOf),
    );
    const text = body.map((line) => line.slice(margin));
    const joined = indicator.startsWith(">")
      ? text.join(" ").replace(/ {2,}/g, " ")
      : text.join("\n");
    return indicator.endsWith("-") ? joined : `${joined}\n`;
  }

  function value(rest, keyIndent) {
    if (/^[|>][-+]?$/.test(rest)) return blockScalar(rest, keyIndent);
    if (rest !== "") return parseScalar(rest, fail);
    const line = peek();
    if (line === null) return null;
    const indent = indentOf(line);
    if (indent === keyIndent && isItem(contentOf(line)))
      return sequence(indent);
    if (indent <= keyIndent) return null;
    return node(indent);
  }

  function mapping(indent) {
    const result = {};
    for (;;) {
      const line = peek();
      if (line === null || indentOf(line) < indent) break;
      if (indentOf(line) > indent) fail("unexpected indentation");
      const content = contentOf(line);
      if (isItem(content)) break;
      const match = KEY.exec(content);
      if (!match) fail(`expected a key: ${content.slice(0, 40)}`);
      const key = unquote(match[1]);
      if (Object.hasOwn(result, key)) fail(`duplicate key ${key}`);
      at += 1;
      result[key] = value(match[2] ?? "", indent);
    }
    return result;
  }

  function sequence(indent) {
    const result = [];
    for (;;) {
      const line = peek();
      if (line === null || indentOf(line) < indent) break;
      if (indentOf(line) > indent) fail("unexpected indentation");
      const content = contentOf(line);
      if (!isItem(content)) break;
      const after = content.slice(1);
      const pad = /^ */.exec(after)[0].length;
      const item = after.slice(pad);
      if (item === "") {
        at += 1;
        result.push(node(indent + 1));
      } else if (KEY.test(item)) {
        const column = indent + 1 + pad;
        lines[at] = " ".repeat(column) + line.slice(column);
        result.push(mapping(column));
      } else {
        at += 1;
        result.push(parseScalar(item, fail));
      }
    }
    return result;
  }

  function node(minIndent) {
    const line = peek();
    if (line === null || indentOf(line) < minIndent) return null;
    const indent = indentOf(line);
    const content = contentOf(line);
    if (isItem(content)) return sequence(indent);
    if (KEY.test(content)) return mapping(indent);
    at += 1;
    return parseScalar(content, fail);
  }

  const first = peek();
  if (first === null) fail("empty document");
  if (indentOf(first) !== 0) fail("document must start at column 0");
  const document = node(0);
  if (peek() !== null) fail("unexpected content");
  return document;
}

// ---------------------------------------------------------------------------
// Action references and pins (S2). Selected-actions allowlist on the
// repository: GitHub-owned actions, pnpm/action-setup, github/codeql-action.
// ---------------------------------------------------------------------------

const USES = /^\s*(?:-\s+)?uses:\s*(["']?)([^\s"'#]+)\1\s*(?:#\s*(.*))?$/;
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^v\d+\.\d+\.\d+$/;

export function actionReferences(text) {
  const references = [];
  text.split("\n").forEach((line, index) => {
    const match = USES.exec(line);
    if (!match) return;
    const [, , ref, comment = ""] = match;
    const base = { line: index + 1, ref, comment: comment.trim() };
    if (ref.startsWith("./")) return references.push({ ...base, local: true });
    const parsed = /^([\w.-]+)\/([\w.-]+)((?:\/[\w.-]+)*)@(.+)$/.exec(ref);
    references.push({
      ...base,
      local: false,
      owner: parsed?.[1],
      repository: parsed ? `${parsed[1]}/${parsed[2]}` : undefined,
      sha: parsed?.[4],
      version: comment.trim().split(/\s+/)[0],
    });
  });
  return references;
}

export function isAllowedAction(repository) {
  const [owner] = repository.split("/");
  return (
    owner === "actions" ||
    repository === "github/codeql-action" ||
    repository === "pnpm/action-setup"
  );
}

export function pinProblems(file, text) {
  const problems = [];
  for (const reference of actionReferences(text)) {
    const at = `${file}:${reference.line}`;
    if (reference.local) {
      if (!reference.ref.startsWith("./.github/actions/"))
        problems.push(`${at}: local actions must live in .github/actions/`);
      continue;
    }
    if (!reference.repository) {
      problems.push(`${at}: unsupported action reference ${reference.ref}`);
      continue;
    }
    if (!isAllowedAction(reference.repository))
      problems.push(
        `${at}: ${reference.repository} is outside the selected-actions allowlist`,
      );
    if (!SHA.test(reference.sha ?? ""))
      problems.push(
        `${at}: ${reference.ref} is not pinned to a full commit SHA`,
      );
    if (!VERSION.test(reference.version ?? ""))
      problems.push(
        `${at}: ${reference.ref} needs an exact "# vX.Y.Z" comment`,
      );
  }
  return problems;
}

/** Commit for `refs/tags/<version>` in `git ls-remote` output (peeled first). */
export function tagCommit(lsRemoteOutput, version) {
  const refs = new Map();
  for (const line of lsRemoteOutput.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (sha && ref) refs.set(ref, sha);
  }
  return (
    refs.get(`refs/tags/${version}^{}`) ??
    refs.get(`refs/tags/${version}`) ??
    null
  );
}

// ---------------------------------------------------------------------------
// actionlint: exact release, checksum-verified per platform. Its 1.7.12 schema
// predates the documented `concurrency.queue` key, so actionlint runs on a
// normalized copy where only valid `queue:` lines inside a `concurrency:`
// mapping are blanked (line numbers preserved). Every other message counts.
// ---------------------------------------------------------------------------

export const ACTIONLINT = Object.freeze({
  version: "1.7.12",
  sha256: Object.freeze({
    "linux-x64":
      "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
    "linux-arm64":
      "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
    "darwin-x64":
      "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
    "darwin-arm64":
      "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
  }),
});

/**
 * Strictly validates GitHub's `concurrency.queue` extension and returns text
 * with exactly those lines blanked for actionlint. `queue` must be `max` or
 * `single`, sit directly in a block `concurrency:` mapping, and `max` must not
 * be combined with `cancel-in-progress: true` (GitHub rejects that).
 */
export function normalizeConcurrencyQueue(file, text) {
  const source = text.split("\n");
  const output = [...source];
  const problems = [];
  const indentOf = (line) => /^ */.exec(line)[0].length;
  source.forEach((line, index) => {
    const match = /^( *)queue:\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!match) return;
    const at = `${file}:${index + 1}`;
    const indent = match[1].length;
    let parent = index - 1;
    while (
      parent >= 0 &&
      (source[parent].trim() === "" ||
        source[parent].trim().startsWith("#") ||
        indentOf(source[parent]) >= indent)
    )
      parent -= 1;
    if (parent < 0 || !/^ *concurrency:\s*(?:#.*)?$/.test(source[parent])) {
      problems.push(`${at}: queue is only valid inside a concurrency mapping`);
      return;
    }
    if (!["max", "single"].includes(match[2])) {
      problems.push(`${at}: queue must be max or single`);
      return;
    }
    let end = index + 1;
    while (
      end < source.length &&
      (source[end].trim() === "" || indentOf(source[end]) >= indent)
    )
      end += 1;
    const siblings = source.slice(parent + 1, end);
    if (
      match[2] === "max" &&
      siblings.some((sibling) =>
        /^ *cancel-in-progress:\s*true\s*(?:#.*)?$/.test(sibling),
      )
    ) {
      problems.push(
        `${at}: queue max cannot be combined with cancel-in-progress true`,
      );
      return;
    }
    output[index] = "";
  });
  return { text: output.join("\n"), problems };
}

export function actionlintAsset(platform, arch) {
  const os = { linux: "linux", darwin: "darwin" }[platform];
  const cpu = { x64: "amd64", arm64: "arm64" }[arch];
  const sha256 = ACTIONLINT.sha256[`${platform}-${arch}`];
  if (!os || !cpu || !sha256)
    throw new Error(`No pinned actionlint build for ${platform}/${arch}`);
  const name = `actionlint_${ACTIONLINT.version}_${os}_${cpu}.tar.gz`;
  return {
    name,
    sha256,
    url: `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT.version}/${name}`,
  };
}

// ---------------------------------------------------------------------------
// Repository workflow policy.
// ---------------------------------------------------------------------------

export const RELEASE = Object.freeze({
  staging: {
    environment: "staging",
    group: "industrial-sas-staging-release",
    permissions: { contents: "read", "id-token": "write" },
    secrets: ["CLERK_SECRET_KEY", "CONVEX_DEPLOY_KEY", "VERCEL_TOKEN"],
    uploads: [
      "release-output/manifest.json",
      "release-output/smoke-staging.json",
    ],
  },
  release: {
    environment: "production-release",
    group: "industrial-sas-production-release",
    permissions: { contents: "read" },
    secrets: ["CONVEX_BACKUP_ADMIN_KEY", "VERCEL_TOKEN"],
    uploads: [
      "release-output/backup-metadata.json",
      "release-output/manifest.json",
      "release-output/smoke-candidate.json",
      "release-output/smoke-live.json",
    ],
  },
});

// Jobs allowed to hold write-scoped token permissions, and which ones.
const WRITE_PERMISSIONS = Object.freeze({
  "quality.yml:staging": ["id-token"],
  "codeql.yml:analyze": ["security-events"],
});
// Jobs allowed to reference secrets, and only from a step-level `env`.
const SECRET_JOBS = Object.freeze({
  "quality.yml:staging": RELEASE.staging.secrets,
  "quality.yml:release": RELEASE.release.secrets,
  "production-backup.yml:backup": ["CONVEX_BACKUP_ADMIN_KEY"],
});
const ENVIRONMENT_JOBS = Object.freeze({
  "quality.yml:staging": "staging",
  "quality.yml:release": "production-release",
  "production-backup.yml:backup": "production-release",
});
const FORBIDDEN_TRIGGERS = ["pull_request_target", "workflow_run"];
const MAX_RETENTION_DAYS = 30;

const asList = (value) =>
  Array.isArray(value) ? value : value == null ? [] : [value];
const stepsOf = (job) => (Array.isArray(job?.steps) ? job.steps : []);
const usesOf = (step) => String(step?.uses ?? "").split("@")[0];
const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();
const secretNames = (value) =>
  [...JSON.stringify(value ?? null).matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map(
    (match) => match[1],
  );
const lines = (value) =>
  String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function generalProblems(name, workflow) {
  const problems = [];
  const at = (where) => `${name}${where ? `:${where}` : ""}`;
  const permissions = workflow.permissions;
  if (!permissions || typeof permissions !== "object")
    problems.push(`${at()}: workflow-level permissions are required`);
  else
    for (const [scope, level] of Object.entries(permissions))
      if (level !== "read" && level !== "none")
        problems.push(`${at()}: workflow permission ${scope}: ${level}`);
  const triggers =
    typeof workflow.on === "string"
      ? [workflow.on]
      : Array.isArray(workflow.on)
        ? workflow.on
        : Object.keys(workflow.on ?? {});
  for (const trigger of FORBIDDEN_TRIGGERS)
    if (triggers.includes(trigger))
      problems.push(`${at()}: trigger ${trigger} is not allowed`);

  if (JSON.stringify(workflow).includes("PLAYWRIGHT_DIAGNOSTIC_RETRIES"))
    problems.push(`${at()}: required browser runs keep zero retries`);
  for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
    const key = `${name}:${id}`;
    if (!/^\d+$/.test(String(job?.["timeout-minutes"] ?? "")))
      problems.push(`${at(id)}: timeout-minutes is required`);
    if (job?.["continue-on-error"] !== undefined)
      problems.push(`${at(id)}: continue-on-error hides failures`);
    if (job?.permissions === "write-all" || job?.permissions === "read-all")
      problems.push(`${at(id)}: blanket permissions are not allowed`);
    for (const [scope, level] of Object.entries(
      typeof job?.permissions === "object" ? job.permissions : {},
    )) {
      if (level === "write" && !WRITE_PERMISSIONS[key]?.includes(scope))
        problems.push(`${at(id)}: ${scope}: write is not allowlisted`);
    }
    const environment =
      typeof job?.environment === "object"
        ? job.environment?.name
        : job?.environment;
    if (environment !== undefined && ENVIRONMENT_JOBS[key] !== environment)
      problems.push(`${at(id)}: environment ${environment} is not allowlisted`);

    // Secrets: never at job level or in `with:`; only allowlisted step env.
    const jobWithoutSteps = Object.fromEntries(
      Object.entries(job ?? {}).filter(([field]) => field !== "steps"),
    );
    if (secretNames(jobWithoutSteps).length > 0)
      problems.push(`${at(id)}: secrets outside a step env`);
    stepsOf(job).forEach((step, index) => {
      const { env, ...rest } = step ?? {};
      if (secretNames(rest).length > 0)
        problems.push(`${at(id)}: step ${index + 1} uses secrets outside env`);
      for (const secret of secretNames(env))
        if (!SECRET_JOBS[key]?.includes(secret))
          problems.push(`${at(id)}: secret ${secret} is not allowlisted`);
      if (step?.["continue-on-error"] !== undefined)
        problems.push(`${at(id)}: step ${index + 1} continue-on-error`);
      if (/--ignore-unfixable|--ignore-workspace/.test(String(step?.run ?? "")))
        problems.push(`${at(id)}: step ${index + 1} uses a forbidden flag`);
      const uses = usesOf(step);
      if (uses === "actions/checkout") {
        if (step.with?.["persist-credentials"] !== "false")
          problems.push(
            `${at(id)}: checkout must set persist-credentials: false`,
          );
      }
      if (uses === "actions/upload-artifact") {
        const days = Number(step.with?.["retention-days"]);
        if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS)
          problems.push(
            `${at(id)}: upload ${step.with?.name ?? index + 1} needs retention-days 1–${MAX_RETENTION_DAYS}`,
          );
      }
      if (uses === "./.github/actions/setup-node-pnpm") {
        const cache = step.with?.cache ?? "true";
        if (cache !== "true" && cache !== "false")
          problems.push(`${at(id)}: setup cache must be "true" or "false"`);
      }
    });
  }
  return problems;
}

// Exact trusted release conditions (whitespace-normalized). `!cancelled()`
// is required: on main the PR-only dependency review is skipped, and without
// an explicit status function GitHub's implicit success() over the ancestor
// chain would skip both jobs even after `check` succeeded. The explicit
// result predicates then refuse any failed, skipped or cancelled upstream.
const TRUSTED_MAIN =
  "github.repository == 'Rugby-Thailand/industrial-sas' && github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')";
export const RELEASE_CONDITIONS = Object.freeze({
  staging: `\${{ !cancelled() && needs.check.result == 'success' && ${TRUSTED_MAIN} }}`,
  release: `\${{ !cancelled() && needs.check.result == 'success' && needs.staging.result == 'success' && needs.staging.outputs.outcome == 'STAGING_PASSED' && ${TRUSTED_MAIN} }}`,
});
const normalizeSpace = (value) => String(value ?? "").replace(/\s+/g, " ");

function releaseJobProblems(id, job, spec) {
  const problems = [];
  const at = `quality.yml:${id}`;
  if (normalizeSpace(job?.if).trim() !== RELEASE_CONDITIONS[id])
    problems.push(`${at}: if must be exactly ${RELEASE_CONDITIONS[id]}`);
  if (!asList(job?.needs).includes("check"))
    problems.push(`${at}: must need check`);
  const environment =
    typeof job?.environment === "object"
      ? job.environment?.name
      : job?.environment;
  if (environment !== spec.environment)
    problems.push(`${at}: environment must be ${spec.environment}`);
  const concurrency = job?.concurrency ?? {};
  if (
    concurrency.group !== spec.group ||
    concurrency["cancel-in-progress"] !== "false" ||
    concurrency.queue !== "max"
  )
    problems.push(
      `${at}: concurrency must be group ${spec.group}, cancel-in-progress false, queue max`,
    );
  if (
    typeof job?.permissions !== "object" ||
    !sameSet(Object.keys(job.permissions), Object.keys(spec.permissions)) ||
    Object.entries(spec.permissions).some(
      ([scope, level]) => job.permissions[scope] !== level,
    )
  )
    problems.push(
      `${at}: permissions must be exactly ${JSON.stringify(spec.permissions)}`,
    );

  const steps = stepsOf(job);
  const checkout = steps.find((step) => usesOf(step) === "actions/checkout");
  if (checkout?.with?.ref !== "${{ github.sha }}")
    problems.push(`${at}: checkout must use ref \${{ github.sha }}`);
  for (const step of steps) {
    const uses = usesOf(step);
    if (uses === "actions/cache" || uses.startsWith("actions/cache/"))
      problems.push(`${at}: release jobs must not use GitHub caches`);
    if (
      uses === "./.github/actions/setup-node-pnpm" &&
      step.with?.cache !== "false"
    )
      problems.push(`${at}: setup must pass cache: "false"`);
  }
  if (
    !steps.some(
      (step) => step.run === "pnpm -C tools/release install --frozen-lockfile",
    )
  )
    problems.push(`${at}: must install the locked release tools`);
  const target = id === "staging" ? "staging" : "production";
  const runner = steps.filter((step) =>
    String(step.run ?? "").includes("scripts/release/run.mjs"),
  );
  if (
    runner.length !== 1 ||
    runner[0].run !== `node scripts/release/run.mjs --target=${target}`
  ) {
    problems.push(`${at}: exactly one run.mjs --target=${target} step`);
  } else {
    const env = runner[0].env ?? {};
    if (env.RELEASE_ENVIRONMENT !== target)
      problems.push(`${at}: runner env RELEASE_ENVIRONMENT must be ${target}`);
    const secrets = secretNames(env);
    if (!sameSet(secrets, spec.secrets))
      problems.push(
        `${at}: runner secrets must be exactly ${spec.secrets.join(", ")}`,
      );
    if (env.GITHUB_TOKEN !== "${{ github.token }}")
      problems.push(`${at}: runner needs the read-only GITHUB_TOKEN`);
  }
  for (const step of steps) {
    if (step === runner[0] || step.env === undefined) continue;
    if (secretNames(step.env).length > 0)
      problems.push(`${at}: secrets only in the runner step`);
  }
  for (const step of steps.filter(
    (candidate) => usesOf(candidate) === "actions/upload-artifact",
  )) {
    const paths = lines(step.with?.path);
    if (paths.some((path) => !spec.uploads.includes(path)))
      problems.push(`${at}: uploads only ${spec.uploads.join(", ")}`);
  }
  return problems;
}

// Mandatory validate-job commands (CI-03/06/07/09/10/11, T11, S12).
export const VALIDATE_COMMANDS = Object.freeze([
  "node scripts/ci/validate-workflows.mjs --verify-pins",
  "pnpm format:check",
  "pnpm typecheck",
  "pnpm lint",
  "pnpm audit:prod",
  "node scripts/ci/audit-dependencies.mjs --scope=app",
  "node scripts/ci/audit-dependencies.mjs --scope=release",
  "pnpm ci:test-discovery",
  "pnpm ci:clean-tree",
]);

// Parsed-YAML equality that ignores mapping key order.
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const isUpload = (step) => usesOf(step) === "actions/upload-artifact";
const isBuild = (step) =>
  /\b(?:next|pnpm(?: run)?) build\b/.test(String(step?.run ?? ""));

// Vitest shards (T11): every project in contiguous native shards. Each shard
// is gated by its own exit status and uploads only its own native JUnit file.
export const TEST_SHARDS = 3;
const SHARD_JUNIT = `test-results/vitest-junit/shard-\${{ matrix.shard }}-${TEST_SHARDS}.xml`;
export const VITEST_SHARD_COMMAND = [
  "pnpm exec vitest run",
  `--shard=\${{ matrix.shard }}/${TEST_SHARDS}`,
  "--reporter=default",
  "--reporter=github-actions",
  "--reporter=junit",
  `--outputFile.junit=${SHARD_JUNIT}`,
].join(" ");
const SHARD_UPLOAD = Object.freeze({
  name: "vitest-junit-${{ matrix.shard }}",
  overwrite: "true",
  path: SHARD_JUNIT,
  "retention-days": "7",
  "if-no-files-found": "error",
});

function testShardProblems(job) {
  const problems = [];
  const at = "quality.yml:test";
  const strategy = job?.strategy ?? {};
  const shards = Array.from({ length: TEST_SHARDS }, (_, index) =>
    String(index + 1),
  );
  if (
    strategy["fail-fast"] !== "false" ||
    !same(strategy.matrix, { shard: shards })
  )
    problems.push(
      `${at}: matrix must be exactly shard [${shards.join(", ")}] with fail-fast false`,
    );
  const runs = stepsOf(job).filter((step) => step.run !== undefined);
  if (
    runs.length !== 1 ||
    runs[0].run !== VITEST_SHARD_COMMAND ||
    runs[0].if !== undefined ||
    runs[0].env !== undefined
  )
    problems.push(`${at}: the only run step must be ${VITEST_SHARD_COMMAND}`);
  const uploads = stepsOf(job).filter(isUpload);
  if (
    uploads.length !== 1 ||
    uploads[0].if !== "${{ !cancelled() }}" ||
    !same(uploads[0].with, SHARD_UPLOAD)
  )
    problems.push(
      `${at}: upload only this shard's JUnit unless cancelled, with ${JSON.stringify(SHARD_UPLOAD)}`,
    );
  return problems;
}

// Browser suites (T4/T5): one matrix leg per suite, both required through
// the job result. The smoke leg owns the workflow's only production build:
// credential-free, Next.js cache restored and saved, clean tree afterwards.
// The workspace leg runs the Vite harness without a build.
const SMOKE_LEG = "${{ matrix.suite == 'smoke' }}";
const legAfter = (suite, step) =>
  `\${{ !cancelled() && matrix.suite == '${suite}' && steps.${step}.outcome == 'success' }}`;
const NEXT_CACHE_KEY =
  "${{ runner.os }}-${{ runner.arch }}-next-${{ hashFiles('pnpm-lock.yaml', '.nvmrc') }}-";
const runOf = (step) => String(step?.run ?? "");
const BROWSER_STEPS = Object.freeze([
  [
    "setup",
    (step) => usesOf(step) === "./.github/actions/setup-node-pnpm",
    { id: "setup", with: undefined },
  ],
  [
    "Next.js cache",
    (step) => /^actions\/cache(?:\/|$)/.test(usesOf(step)),
    {
      uses: "actions/cache",
      if: SMOKE_LEG,
      with: {
        path: ".next/cache",
        key: `${NEXT_CACHE_KEY}\${{ github.sha }}`,
        "restore-keys": `${NEXT_CACHE_KEY}\n`,
      },
    },
  ],
  [
    "production build",
    isBuild,
    { run: "pnpm build", if: SMOKE_LEG, env: undefined },
  ],
  [
    "clean tree",
    (step) => runOf(step).includes("ci:clean-tree"),
    {
      run: "pnpm ci:clean-tree",
      if: "${{ !cancelled() && matrix.suite == 'smoke' && steps.setup.outcome == 'success' }}",
    },
  ],
  [
    "Chromium install",
    (step) => runOf(step).includes("playwright install"),
    {
      id: "browsers",
      run: "pnpm exec playwright install --with-deps chromium",
      if: undefined,
    },
  ],
  [
    "smoke suite",
    (step) => /\btest:e2e(?![:\w])/.test(runOf(step)),
    {
      run: "pnpm test:e2e",
      if: legAfter("smoke", "browsers"),
      env: { PLAYWRIGHT_REQUIRE_BUILD: "1" },
    },
  ],
  [
    "workspace suite",
    (step) => runOf(step).includes("test:e2e:workspace"),
    {
      run: "pnpm test:e2e:workspace",
      if: legAfter("workspace", "browsers"),
      env: undefined,
    },
  ],
  [
    "JUnit upload",
    (step) => isUpload(step) && step.if !== "${{ failure() }}",
    {
      if: "${{ !cancelled() }}",
      with: {
        name: "browser-junit-${{ matrix.suite }}-${{ github.run_attempt }}",
        path: "test-results/${{ matrix.suite }}-junit.xml",
        "retention-days": "7",
        "if-no-files-found": "error",
      },
    },
  ],
  [
    "diagnostics upload",
    (step) => isUpload(step) && step.if === "${{ failure() }}",
    {
      with: {
        name: "browser-diagnostics-${{ matrix.suite }}-${{ github.run_attempt }}",
        path: "test-results/${{ matrix.suite }}/\nplaywright-report/${{ matrix.suite }}/\n",
        "retention-days": "5",
        "if-no-files-found": "ignore",
      },
    },
  ],
]);

function browserProblems(jobs) {
  const problems = [];
  const at = "quality.yml:browser";
  const strategy = jobs.browser?.strategy ?? {};
  if (
    strategy["fail-fast"] !== "false" ||
    !same(strategy.matrix, { suite: ["smoke", "workspace"] })
  )
    problems.push(
      `${at}: matrix must be exactly suite [smoke, workspace] with fail-fast false`,
    );
  const steps = stepsOf(jobs.browser);
  let previous = -1;
  for (const [label, matches, want] of BROWSER_STEPS) {
    const found = steps.filter((step) => step && matches(step));
    if (found.length !== 1) {
      problems.push(`${at}: needs exactly one ${label} step`);
      continue;
    }
    const step = found[0];
    if (
      Object.entries(want).some(([key, expected]) =>
        key === "uses" ? usesOf(step) !== expected : !same(step[key], expected),
      )
    )
      problems.push(`${at}: ${label} step must match ${JSON.stringify(want)}`);
    const index = steps.indexOf(step);
    if (index < previous) problems.push(`${at}: ${label} step is out of order`);
    previous = Math.max(previous, index);
  }
  steps.forEach((step, index) => {
    if (
      usesOf(step) !== "actions/checkout" &&
      !BROWSER_STEPS.some(([, matches]) => step && matches(step))
    )
      problems.push(`${at}: unexpected step ${index + 1}`);
  });
  return problems;
}

// Informational full-suite coverage (T12): one unsharded run of every Vitest
// project in the scheduled workflow; only it gets the instrumentation budget.
export const COVERAGE_COMMAND = [
  "pnpm exec vitest run",
  "--coverage",
  "--coverage.reportOnFailure",
  "--testTimeout=15000",
  "--reporter=default",
  "--reporter=github-actions",
  "--reporter=junit",
  "--outputFile.junit=test-results/vitest-junit.xml",
].join(" ");
const COVERAGE_UPLOAD = Object.freeze({
  name: "vitest-coverage-${{ github.run_attempt }}",
  path: "test-results/vitest-junit.xml\ncoverage/coverage-summary.json\ncoverage/lcov.info\n",
  "retention-days": "7",
  "if-no-files-found": "error",
});

function coverageProblems(job) {
  const runs = stepsOf(job).filter((step) => step.run !== undefined);
  const uploads = stepsOf(job).filter(isUpload);
  return job &&
    job.needs === undefined &&
    job.if === undefined &&
    runs.length === 1 &&
    runs[0].run === COVERAGE_COMMAND &&
    runs[0].if === undefined &&
    runs[0].env === undefined &&
    uploads.length === 1 &&
    uploads[0].if === "${{ !cancelled() }}" &&
    same(uploads[0].with, COVERAGE_UPLOAD)
    ? []
    : [
        `workspace-matrix.yml:coverage: run only ${COVERAGE_COMMAND} in parallel and upload ${JSON.stringify(COVERAGE_UPLOAD)} unless cancelled`,
      ];
}

function qualityProblems(workflow, { allowedGhsas }) {
  const problems = [];
  const jobs = workflow.jobs ?? {};
  const on = workflow.on ?? {};
  if (
    !sameSet(Object.keys(on), ["push", "pull_request", "workflow_dispatch"]) ||
    !sameSet(asList(on.push?.branches), ["main"])
  )
    problems.push(
      "quality.yml: triggers must be push(main), pull_request, workflow_dispatch",
    );
  const group = String(workflow.concurrency?.group ?? "");
  if (
    !group.includes("github.event.pull_request.number") ||
    !group.includes("github.run_id") ||
    workflow.concurrency?.["cancel-in-progress"] !==
      "${{ github.event_name == 'pull_request' }}"
  )
    problems.push(
      "quality.yml: concurrency must group PRs by number (cancelling) and every other run by run_id",
    );

  const check = jobs.check;
  const gated = Object.keys(jobs).filter(
    (id) => !["check", "staging", "release"].includes(id),
  );
  if (!check) {
    problems.push("quality.yml: stable check job is missing");
  } else {
    if (check.if !== "${{ always() }}")
      problems.push("quality.yml:check: if must be ${{ always() }}");
    const needs = asList(check.needs);
    if (!sameSet(needs, gated))
      problems.push(
        `quality.yml:check: needs must be exactly ${gated.sort().join(", ")}`,
      );
    const step = stepsOf(check).find((candidate) =>
      String(candidate.run ?? "").includes("scripts/ci/aggregate.mjs"),
    );
    const required = String(step?.env?.REQUIRED_JOBS ?? "")
      .split(",")
      .filter(Boolean);
    const prOnly = String(step?.env?.PULL_REQUEST_ONLY ?? "")
      .split(",")
      .filter(Boolean);
    if (!step || step.env?.NEEDS_JSON !== "${{ toJSON(needs) }}")
      problems.push("quality.yml:check: aggregate.mjs must read toJSON(needs)");
    if (step?.env?.EVENT_NAME !== "${{ github.event_name }}")
      problems.push("quality.yml:check: aggregate.mjs needs EVENT_NAME");
    if (!sameSet(required, needs))
      problems.push("quality.yml:check: REQUIRED_JOBS must equal needs");
    for (const id of prOnly)
      if (jobs[id]?.if !== "${{ github.event_name == 'pull_request' }}")
        problems.push(
          `quality.yml:${id}: PR-only job must be gated on pull_request`,
        );
    for (const id of gated) {
      const condition = jobs[id]?.if;
      if (
        condition !== undefined &&
        !prOnly.includes(id) &&
        condition !== "${{ !cancelled() }}"
      )
        problems.push(`quality.yml:${id}: mandatory job has a skipping if`);
    }
  }

  for (const id of gated) {
    const job = jobs[id];
    if (job?.environment !== undefined || secretNames(job).length > 0)
      problems.push(`quality.yml:${id}: quality jobs must stay secret-free`);
    if (job?.permissions !== undefined)
      problems.push(
        `quality.yml:${id}: quality jobs keep workflow read permissions`,
      );
  }

  const validateRuns = stepsOf(jobs.validate).map((step) => step.run);
  for (const command of VALIDATE_COMMANDS)
    if (!validateRuns.includes(command))
      problems.push(`quality.yml:validate: must run ${command}`);

  problems.push(...testShardProblems(jobs.test), ...browserProblems(jobs));
  for (const id of gated)
    if (id !== "browser" && stepsOf(jobs[id]).some(isBuild))
      problems.push(
        `quality.yml:${id}: the smoke browser leg owns the only production build`,
      );

  const review = stepsOf(jobs["dependency-review"]).find(
    (step) => usesOf(step) === "actions/dependency-review-action",
  );
  if (!review) problems.push("quality.yml: dependency review step is missing");
  else {
    if (review.with?.["fail-on-severity"] !== "high")
      problems.push(
        "quality.yml:dependency-review: fail-on-severity must be high",
      );
    if (review.with?.["warn-only"] !== undefined)
      problems.push("quality.yml:dependency-review: warn-only is not allowed");
    const allowed = String(review.with?.["allow-ghsas"] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const ghsa of allowed)
      if (!allowedGhsas.includes(ghsa))
        problems.push(
          `quality.yml:dependency-review: ${ghsa} lacks an active entry in scripts/ci/dependency-exceptions.json`,
        );
  }

  for (const id of ["staging", "release"]) {
    if (!jobs[id]) problems.push(`quality.yml: ${id} job is missing`);
    else problems.push(...releaseJobProblems(id, jobs[id], RELEASE[id]));
  }
  const release = jobs.release;
  if (release) {
    if (!asList(release.needs).includes("staging"))
      problems.push("quality.yml:release: must need staging");
    if (/CONVEX_DEPLOY_KEY|CLERK_SECRET_KEY/.test(JSON.stringify(release)))
      problems.push(
        "quality.yml:release: production deploy credentials stay in Vercel",
      );
  }
  if (jobs.staging?.outputs?.outcome !== "${{ steps.release.outputs.outcome }}")
    problems.push("quality.yml:staging: must output the controller outcome");
  return problems;
}

function backupProblems(backup) {
  const job = backup?.jobs?.backup;
  if (!job) return ["production-backup.yml: backup job is missing"];
  const concurrency = job.concurrency ?? {};
  return concurrency.group === RELEASE.release.group &&
    concurrency["cancel-in-progress"] === "false" &&
    concurrency.queue === "max"
    ? []
    : [
        `production-backup.yml:backup: must share ${RELEASE.release.group} with cancel-in-progress false and queue max, or it can cancel a pending release`,
      ];
}

function auxiliaryProblems(name, workflow) {
  const problems = [];
  const jobs = Object.values(workflow.jobs ?? {});
  if (name === "codeql.yml") {
    const languages = asList(jobs[0]?.strategy?.matrix?.language);
    if (!sameSet(languages, ["javascript-typescript", "actions"]))
      problems.push("codeql.yml: analyze javascript-typescript and actions");
    const init = jobs
      .flatMap(stepsOf)
      .find((step) => usesOf(step) === "github/codeql-action/init");
    if (init?.with?.["build-mode"] !== "none")
      problems.push("codeql.yml: source-only build-mode none");
  }
  if (name === "workspace-matrix.yml") {
    const step = jobs
      .flatMap(stepsOf)
      .find((candidate) =>
        String(candidate.run ?? "").includes("test:e2e:workspace"),
      );
    if (step?.env?.WORKSPACE_FULL_MATRIX !== "1")
      problems.push(
        "workspace-matrix.yml: must run with WORKSPACE_FULL_MATRIX=1",
      );
    problems.push(...coverageProblems(workflow.jobs?.coverage));
  }
  if (name === "security-audit.yml") {
    const runs = jobs.flatMap(stepsOf).map((step) => String(step.run ?? ""));
    for (const command of [
      "pnpm audit:prod",
      "node scripts/ci/audit-dependencies.mjs --scope=app",
      "node scripts/ci/audit-dependencies.mjs --scope=release",
    ])
      if (!runs.includes(command))
        problems.push(`security-audit.yml: must run ${command}`);
  }
  return problems;
}

/**
 * Policy problems for `{ "<file>.yml": text }` workflows plus composite action
 * texts. `exceptions` is scripts/ci/dependency-exceptions.json; `now` in ms.
 */
export function workflowPolicyProblems({
  workflows,
  actions = {},
  exceptions,
  now,
}) {
  const problems = [];
  const parsed = {};
  for (const [name, text] of Object.entries({ ...workflows, ...actions })) {
    problems.push(...pinProblems(name, text));
    problems.push(...normalizeConcurrencyQueue(name, text).problems);
    try {
      parsed[name] = parseYamlSubset(text);
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
    }
  }
  for (const name of Object.keys(workflows)) {
    const workflow = parsed[name];
    if (!workflow) continue;
    problems.push(
      ...generalProblems(name, workflow),
      ...auxiliaryProblems(name, workflow),
    );
  }
  for (const name of Object.keys(actions)) {
    if (parsed[name] && secretNames(parsed[name]).length > 0)
      problems.push(`${name}: composite actions must not read secrets`);
  }
  if (parsed["quality.yml"])
    problems.push(
      ...qualityProblems(parsed["quality.yml"], {
        allowedGhsas: activeExceptionGhsas(exceptions, now),
      }),
    );
  else if (!("quality.yml" in workflows)) problems.push("quality.yml: missing");
  if (parsed["production-backup.yml"])
    problems.push(...backupProblems(parsed["production-backup.yml"]));
  return problems;
}
