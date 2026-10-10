// The caller holds one release lock from preflight through live verification.
// Main may advance before remote mutation; after a build starts this release
// finishes or reports recovery under that lock, rather than stranding its backend.
import { cutoverState } from "./vercel-config.mjs";
import { deploymentFacts, isDeploymentId } from "./vercel-api.mjs";
import { filterSmokeDiagnostics } from "./smoke-diagnostics.mjs";

export const OUTCOMES = Object.freeze({
  RELEASED: { ok: true, mutation: "frontend" },
  STAGING_PASSED: { ok: true, mutation: "frontend" },
  SUPERSEDED: { ok: true, mutation: "none" },
  NOT_READY: { ok: false, mutation: "none" },
  BACKUP_FAILED: { ok: false, mutation: "none" },
  BLOCKED_IN_FLIGHT: { ok: false, mutation: "none" },
  BLOCKED_UNRECONCILED: { ok: false, mutation: "none" },
  DEPLOY_COMMAND_FAILED: { ok: false, mutation: "backend-possible" },
  BUILD_FAILED: { ok: false, mutation: "backend-possible" },
  BUILD_TIMEOUT: { ok: false, mutation: "backend-possible" },
  VERIFY_FAILED: { ok: false, mutation: "backend" },
  CANDIDATE_FAILED: { ok: false, mutation: "backend" },
  CONFLICT: { ok: false, mutation: "backend" },
  PROMOTE_FAILED: { ok: false, mutation: "frontend-possible" },
  PROMOTE_TIMEOUT: { ok: false, mutation: "frontend-possible" },
  LIVE_FAILED: { ok: false, mutation: "frontend" },
  STAGING_FAILED: { ok: false, mutation: "frontend" },
});
const SHA = /^[0-9a-f]{40}$/;
const CANDIDATE_URL = "https://ci-candidate.thaipropertyai.com";
const TERMINAL_FAILURE = new Set(["ERROR", "CANCELED", "DELETED", "BLOCKED"]);
const IN_FLIGHT = new Set(["QUEUED", "INITIALIZING", "BUILDING"]);
const MUTATIONS = [
  "none",
  "backend-possible",
  "backend",
  "frontend-possible",
  "frontend",
];
class Stop extends Error {
  constructor(code, reason) {
    super(reason);
    this.code = code;
  }
}
function pollNow(deps) {
  return deps.clock.monotonicNow?.() ?? deps.clock.now();
}
function advanceMutation(state, mutation) {
  if (MUTATIONS.indexOf(mutation) > MUTATIONS.indexOf(state.mutation))
    state.mutation = mutation;
}

export async function runRelease(input, deps) {
  const limits = {
    buildTimeoutMs: 30 * 60_000,
    promoteTimeoutMs: 5 * 60_000,
    pollIntervalMs: 10_000,
    ...input.limits,
  };
  const events = [];
  const state = {
    target: input.targetName,
    sha: input.sha,
    runId: input.runId,
    previousDeploymentId: null,
    deploymentId: null,
    deploymentUrl: null,
    candidateUrl: null,
    phase: "preflight",
    mutation: "none",
    checks: /** @type {Record<string, unknown>} */ ({}),
  };
  const record = (step, detail = {}) => {
    const event = {
      at: new Date(deps.clock.now()).toISOString(),
      step,
      mutation: state.mutation,
      ...detail,
    };
    events.push(event);
    deps.onEvent?.(event, state);
  };
  const finish = (code, reason) => {
    // A final artifact callback must not erase the verified remote outcome.
    try {
      record("outcome", { code, reason });
    } catch {
      /* caller persists final result */
    }
    return {
      code,
      ok: OUTCOMES[code].ok,
      mutation: state.mutation,
      reason,
      state,
      events,
    };
  };
  try {
    if (
      !Object.values(limits).every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    ) {
      throw new Stop("NOT_READY", "Release polling bounds are invalid.");
    }
    await preflight(input, deps, state, record);
    state.phase = "backup";
    if (input.targetName === "production")
      await backup(input, deps, state, record);
    // Snapshot creation does not change app/backend code. A queued newer main
    // can supersede this run safely here, immediately before source deployment.
    state.phase = "preflight";
    await assertCurrentMain(input, deps, state);
    state.phase = "build";
    await deployAndWait(input, deps, state, record, limits);
    state.phase = "verify";
    verifyCandidate(input, state, record);
    if (input.targetName === "production") {
      state.phase = "candidate";
      await bindCandidate(input, deps, state, record, limits);
      await smoke(deps, state, record, "candidate", state.candidateUrl);
      state.phase = "promote";
      await promote(input, deps, state, record, limits);
      state.phase = "live";
      await smoke(deps, state, record, "live", input.target.appUrl);
      return finish("RELEASED", "Promoted and verified.");
    }
    state.phase = "staging";
    await waitForServing(input, deps, state, record, limits);
    await smoke(deps, state, record, "staging", input.target.appUrl);
    return finish("STAGING_PASSED", "Staging deployment verified.");
  } catch (error) {
    if (error instanceof Stop) return finish(error.code, error.message);
    const code =
      {
        preflight: "NOT_READY",
        backup: "BACKUP_FAILED",
        build: "BUILD_FAILED",
        verify: "VERIFY_FAILED",
        candidate: "CANDIDATE_FAILED",
        promote: "PROMOTE_FAILED",
        live: "LIVE_FAILED",
        staging: "STAGING_FAILED",
      }[state.phase] ?? "NOT_READY";
    // SDK, subprocess and injected errors are never copied to public artifacts.
    return finish(
      code,
      "Release operation failed; provider details were suppressed.",
    );
  }
}

async function assertCurrentMain(input, deps, state) {
  const head = await deps.currentMainSha();
  if (!SHA.test(head ?? ""))
    throw new Stop("NOT_READY", "Current main commit could not be verified.");
  state.checks.mainHead = head;
  if (head !== input.sha)
    throw new Stop(
      "SUPERSEDED",
      "main advanced before deployment; its queued run releases instead.",
    );
}
function verifiedProject(project, target, code = "NOT_READY") {
  if (
    project?.id !== target.vercelProjectId ||
    project?.name !== target.vercelProjectName ||
    project?.accountId !== target.vercelTeamId
  ) {
    throw new Stop(
      code,
      "Vercel project and account identity do not match targets.json.",
    );
  }
  const serving = project?.targets?.production?.id ?? null;
  if (serving !== null && !isDeploymentId(serving))
    throw new Stop(code, "Serving deployment identity is malformed.");
  return serving;
}
async function inventory(input, deps, code = "NOT_READY") {
  const rows = await deps.api.listProductionDeployments(
    input.target.vercelProjectId,
  );
  if (!Array.isArray(rows))
    throw new Stop(
      code,
      "Production deployment inventory could not be verified.",
    );
  const facts = rows.map(deploymentFacts);
  if (
    facts.some(
      (d) =>
        !d ||
        d.projectId !== input.target.vercelProjectId ||
        d.target !== "production",
    ) ||
    new Set(facts.map((d) => d.id)).size !== facts.length
  ) {
    throw new Stop(
      code,
      "Production deployment inventory is malformed or belongs to another project.",
    );
  }
  return facts;
}
async function preflight(input, deps, state, record) {
  const targetValid =
    (input.targetName === "production" &&
      input.target?.skipDomain === true &&
      input.target?.candidateUrl === CANDIDATE_URL) ||
    (input.targetName === "staging" && input.target?.skipDomain === false);
  if (
    input.repository !== input.expectedRepository ||
    input.ref !== "refs/heads/main" ||
    !SHA.test(input.sha ?? "") ||
    !/^\d{1,20}$/.test(input.runId ?? "") ||
    !targetValid
  ) {
    throw new Stop(
      "NOT_READY",
      "Release repository, main ref, source SHA, run ID or target is invalid.",
    );
  }
  if (input.targetName === "production") {
    const cutover = cutoverState(input.committedVercelConfig);
    state.checks.cutover = { ready: cutover.ready };
    if (!cutover.ready)
      throw new Stop(
        "NOT_READY",
        "Production cutover must use the committed gated Vercel build and Git policy (release runbook).",
      );
  }
  await assertCurrentMain(input, deps, state);
  const project = await deps.api.getProject(input.target.vercelProjectId);
  const serving = verifiedProject(project, input.target);
  state.previousDeploymentId = serving;
  record("preflight", { previousDeploymentId: serving });
  const recent = await inventory(input, deps);
  const inFlight = recent.filter((d) => IN_FLIGHT.has(d.readyState));
  if (inFlight.length)
    throw new Stop(
      "BLOCKED_IN_FLIGHT",
      "Production builds are already running; wait or cancel and reconcile Convex before releasing.",
    );
  if (input.targetName !== "production") return;
  let servingFacts = recent.find((d) => d.id === serving);
  if (serving && !servingFacts) {
    servingFacts = deploymentFacts(await deps.api.getDeployment(serving));
    if (
      !servingFacts ||
      servingFacts.id !== serving ||
      servingFacts.projectId !== input.target.vercelProjectId ||
      servingFacts.target !== "production"
    ) {
      throw new Stop(
        "NOT_READY",
        "Serving deployment history and project provenance could not be verified.",
      );
    }
  }
  const servingCreatedAt = servingFacts?.createdAt ?? 0;
  const acknowledgements = input.acknowledgedDeploymentIds ?? [];
  if (
    !Array.isArray(acknowledgements) ||
    acknowledgements.some((id) => !isDeploymentId(id))
  )
    throw new Stop(
      "NOT_READY",
      "Acknowledged deployment identities are invalid.",
    );
  const acknowledged = new Set(acknowledgements);
  const unreconciled = recent.filter(
    (d) =>
      d.id !== serving &&
      d.createdAt > servingCreatedAt &&
      !acknowledged.has(d.id),
  );
  if (unreconciled.length)
    throw new Stop(
      "BLOCKED_UNRECONCILED",
      `Newer deployment(s) may have changed Convex without serving: ${unreconciled.map((d) => d.id).join(", ")}. Reconcile and acknowledge those deployment IDs.`,
    );
}

async function backup(input, deps, state, record) {
  record("backup-start");
  let result;
  try {
    result = typeof deps.backup === "function" ? await deps.backup() : null;
  } catch {
    result = null;
  }
  const metadata = result?.metadata;
  const fields = ["startTs", "completeTs", "expirationTs"];
  const valid =
    result?.ok === true &&
    metadata?.schema === 1 &&
    metadata.deploymentName === input.target.convexDeployment &&
    metadata.requestor === "snapshotExport" &&
    metadata.state === "completed" &&
    metadata.includeStorage === true &&
    fields.every(
      (field) =>
        typeof metadata[field] === "string" && /^\d+$/.test(metadata[field]),
    ) &&
    [metadata.requestedAtMs, metadata.verifiedAtMs].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) &&
    (metadata.sizeBytes === undefined ||
      (typeof metadata.sizeBytes === "string" &&
        /^\d+$/.test(metadata.sizeBytes)));
  if (!valid) {
    state.checks.backup = { ok: false };
    throw new Stop(
      "BACKUP_FAILED",
      "A fresh completed production backup was not verified; deployment was refused.",
    );
  }
  const safe = {
    schema: 1,
    deploymentName: metadata.deploymentName,
    requestor: "snapshotExport",
    state: "completed",
    includeStorage: true,
    requestedAtMs: metadata.requestedAtMs,
    verifiedAtMs: metadata.verifiedAtMs,
    startTs: metadata.startTs,
    completeTs: metadata.completeTs,
    expirationTs: metadata.expirationTs,
    ...(metadata.sizeBytes === undefined
      ? {}
      : { sizeBytes: metadata.sizeBytes }),
  };
  state.checks.backup = { ok: true, metadata: safe };
  record("backup-completed", {
    deploymentName: safe.deploymentName,
    completeTs: safe.completeTs,
    expirationTs: safe.expirationTs,
  });
}

async function deployAndWait(input, deps, state, record, limits) {
  state.checks.deployStarted = true;
  advanceMutation(
    state,
    input.target.skipDomain ? "backend-possible" : "frontend-possible",
  );
  record("deploy-start");
  let url;
  try {
    url = await deps.deploy({ sha: input.sha, runId: input.runId });
  } catch {
    throw new Stop(
      "DEPLOY_COMMAND_FAILED",
      "Deploy command failed; its remote effects require reconciliation.",
    );
  }
  const host =
    typeof url === "string"
      ? url
          .trim()
          .replace(/^https:\/\//, "")
          .replace(/\/$/, "")
      : "";
  if (!/^[a-z0-9-]+\.vercel\.app$/.test(host))
    throw new Stop(
      "DEPLOY_COMMAND_FAILED",
      "Deploy command did not return a valid Vercel deployment URL.",
    );
  let current = deploymentFacts(await deps.api.getDeployment(host));
  if (!current || current.url !== host)
    throw new Stop(
      "BUILD_FAILED",
      "Created deployment could not be verified by its returned URL.",
    );
  state.deploymentId = current.id;
  state.deploymentUrl = host;
  record("deploy-created", { deploymentId: current.id, url: host });
  const deadline = pollNow(deps) + limits.buildTimeoutMs;
  while (current.readyState !== "READY") {
    if (TERMINAL_FAILURE.has(current.readyState))
      throw new Stop(
        "BUILD_FAILED",
        "Deployment ended in a terminal failure; reconcile possible backend changes.",
      );
    if (pollNow(deps) >= deadline)
      throw new Stop(
        "BUILD_TIMEOUT",
        "Deployment is unfinished at the deadline; it may push Convex later. Reconcile before the next release.",
      );
    await deps.clock.sleep(
      Math.min(limits.pollIntervalMs, deadline - pollNow(deps)),
    );
    const next = deploymentFacts(
      await deps.api.getDeployment(state.deploymentId),
    );
    if (
      !next ||
      next.id !== state.deploymentId ||
      next.url !== host ||
      next.createdAt !== current.createdAt
    )
      throw new Stop(
        "BUILD_FAILED",
        "Deployment polling returned malformed or changed identity.",
      );
    current = next;
  }
  advanceMutation(state, "backend");
  state.candidate = current;
  record("deploy-ready", { deploymentId: current.id });
}
function verifyCandidate(input, state, record) {
  const candidate = state.candidate;
  if (
    candidate.target !== "production" ||
    candidate.projectId !== input.target.vercelProjectId ||
    candidate.meta.releaseSha !== input.sha ||
    candidate.meta.releaseRunId !== input.runId ||
    (candidate.meta.githubCommitSha !== undefined &&
      candidate.meta.githubCommitSha !== input.sha)
  ) {
    throw new Stop(
      "VERIFY_FAILED",
      "Candidate project, target, source SHA or run provenance does not match.",
    );
  }
  record("verified", { deploymentId: candidate.id });
  // Do not retain arbitrary provider meta, which can contain sensitive values.
  state.candidate = {
    ...candidate,
    meta: { releaseSha: input.sha, releaseRunId: input.runId },
  };
}
async function bindCandidate(input, deps, state, record, limits) {
  const host = new URL(input.target.candidateUrl).hostname;
  await deps.api.assignAlias(state.deploymentId, host);
  const deadline = pollNow(deps) + limits.promoteTimeoutMs;
  for (;;) {
    const alias = await deps.api.getAlias(host, input.target.vercelProjectId);
    if (
      alias?.alias !== host ||
      alias?.projectId !== input.target.vercelProjectId ||
      alias.redirect ||
      !isDeploymentId(alias?.deploymentId) ||
      (alias.deployment?.id !== undefined &&
        alias.deployment.id !== alias.deploymentId)
    ) {
      throw new Stop(
        "CANDIDATE_FAILED",
        "Candidate alias identity, project or redirect could not be verified.",
      );
    }
    if (alias.deploymentId === state.deploymentId) {
      state.candidateUrl = input.target.candidateUrl;
      record("candidate-bound", {
        deploymentId: state.deploymentId,
        baseUrl: state.candidateUrl,
      });
      return;
    }
    if (pollNow(deps) >= deadline)
      throw new Stop(
        "CANDIDATE_FAILED",
        "Candidate alias did not point to the exact deployment before the deadline.",
      );
    await deps.clock.sleep(
      Math.min(limits.pollIntervalMs, deadline - pollNow(deps)),
    );
  }
}
function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
async function smoke(deps, state, record, phase, baseUrl) {
  record(`smoke-${phase}-start`, { baseUrl });
  const result = await deps.smoke({
    phase,
    baseUrl,
    expectedSha: state.sha,
    deploymentId: state.deploymentId,
  });
  const safe = {
    passed: count(result?.passed) ?? 0,
    diagnostics: filterSmokeDiagnostics(result?.diagnostics),
    failed: count(result?.failed) ?? 0,
    skipped: count(result?.skipped ?? 0) ?? 0,
    skippedRequired: count(result?.skippedRequired ?? 0) ?? 0,
    notConfigured: Array.isArray(result?.notConfigured)
      ? result.notConfigured
          .slice(0, 100)
          .map(() => "optional check not configured")
      : [],
  };
  state.checks[`smoke-${phase}`] = safe;
  const passed =
    result?.ok === true &&
    count(result.passed) > 0 &&
    count(result.failed) === 0 &&
    count(result.skipped ?? 0) !== null &&
    count(result.skippedRequired ?? 0) === 0;
  record(`smoke-${phase}`, safe);
  if (!passed)
    throw new Stop(
      {
        candidate: "CANDIDATE_FAILED",
        live: "LIVE_FAILED",
        staging: "STAGING_FAILED",
      }[phase],
      `${phase} smoke did not pass all required checks.`,
    );
}
async function promote(input, deps, state, record, limits) {
  const project = await deps.api.getProject(input.target.vercelProjectId);
  if (
    verifiedProject(project, input.target, "CONFLICT") !==
    state.previousDeploymentId
  )
    throw new Stop(
      "CONFLICT",
      "Serving deployment changed during the release; reconcile before promotion.",
    );
  // A manual/native build can exist outside the workflow lock. Refuse promotion
  // if it appeared while this candidate was building or being tested.
  const recent = await inventory(input, deps, "CONFLICT");
  if (
    recent.some(
      (d) =>
        d.id !== state.deploymentId &&
        (IN_FLIGHT.has(d.readyState) ||
          d.createdAt >= state.candidate.createdAt),
    )
  )
    throw new Stop(
      "CONFLICT",
      "Another production deployment appeared during this release; reconcile backend ordering.",
    );
  // Never abandon this backend just because a newer main run queued behind us.
  state.checks.promoteRequested = true;
  advanceMutation(state, "frontend-possible");
  record("promote-request", { deploymentId: state.deploymentId });
  await deps.api.promote(input.target.vercelProjectId, state.deploymentId);
  await waitForServing(input, deps, state, record, limits, "PROMOTE_TIMEOUT");
}
async function waitForServing(
  input,
  deps,
  state,
  record,
  limits,
  timeoutCode = "BUILD_TIMEOUT",
) {
  const deadline = pollNow(deps) + limits.promoteTimeoutMs;
  for (;;) {
    const project = await deps.api.getProject(input.target.vercelProjectId);
    if (
      verifiedProject(
        project,
        input.target,
        input.targetName === "production" ? "PROMOTE_FAILED" : "STAGING_FAILED",
      ) === state.deploymentId
    ) {
      advanceMutation(state, "frontend");
      record("serving", { deploymentId: state.deploymentId });
      return;
    }
    if (pollNow(deps) >= deadline)
      throw new Stop(
        timeoutCode,
        "Deployment is not verified as serving production domains before the deadline.",
      );
    await deps.clock.sleep(
      Math.min(limits.pollIntervalMs, deadline - pollNow(deps)),
    );
  }
}

/** Pinned Vercel CLI uploads source and performs one remote production build. */
export function vercelDeployArgs({ sha, runId, skipDomain }) {
  return [
    "deploy",
    "--prod",
    ...(skipDomain ? ["--skip-domain"] : []),
    "--yes",
    "--no-wait",
    "--meta",
    `releaseSha=${sha}`,
    "--meta",
    `releaseRunId=${runId}`,
    "--build-env",
    `RELEASE_SHA=${sha}`,
    "--build-env",
    `RELEASE_RUN_ID=${runId}`,
  ];
}
