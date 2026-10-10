// Release manifest and run summary (BD-10). Public identifiers only: commit,
// run, deployment IDs/URLs, Convex deployment name and outcome. No env values,
// tokens, request bodies or business data.

const RECOVERY = {
  none: "No application or backend deployment started. Fix the cause and re-run the workflow on main.",
  "backend-possible":
    "A remote build started. Treat Convex as possibly updated: inspect the " +
    "deployment build log and the Convex deployment history, then reconcile " +
    "(runbook: build failed or timed out).",
  backend:
    "The remote build completed and may have updated Convex. Production-domain " +
    "promotion was not requested by this run; verify current serving identity " +
    "and prefer a compatible forward fix (runbook: candidate failure).",
  "frontend-possible":
    "Production-domain assignment was requested and may have completed. Verify " +
    "the current serving deployment before recovery; prefer a compatible " +
    "forward fix or instant rollback only when backend-compatible.",
  frontend:
    "The new frontend serves production. Decide between instant rollback to " +
    "the previous deployment (only if backend-compatible) and a forward fix " +
    "(runbook: live failure).",
};

export function buildManifest(result, input) {
  return {
    schema: 1,
    outcome: result.code,
    ok: result.ok,
    mutation: result.mutation,
    reason: result.reason,
    target: input.targetName,
    repository: input.repository,
    sha: input.sha,
    runId: input.runId,
    runUrl: input.runUrl,
    vercel: {
      teamId: input.target.vercelTeamId,
      projectId: input.target.vercelProjectId,
      previousDeploymentId: result.state.previousDeploymentId,
      deploymentId: result.state.deploymentId,
      deploymentUrl: result.state.deploymentUrl,
      candidateUrl: result.state.candidateUrl ?? null,
    },
    convexDeployment: input.target.convexDeployment,
    backup: result.state.checks.backup ?? null,
    smoke: Object.fromEntries(
      Object.entries(result.state.checks)
        .filter(([key]) => key.startsWith("smoke-"))
        .map(([key, value]) => [
          key,
          {
            passed: value?.passed ?? 0,
            failed: value?.failed ?? 0,
            skipped: value?.skipped ?? 0,
            notConfigured: value?.notConfigured ?? [],
          },
        ]),
    ),
    recovery: result.ok ? null : RECOVERY[result.mutation],
    events: result.events,
  };
}

export function summaryMarkdown(manifest) {
  const rows = [
    ["Outcome", `${manifest.ok ? "✅" : "❌"} \`${manifest.outcome}\``],
    ["Target", manifest.target],
    ["Commit", `\`${manifest.sha}\``],
    ["Remote mutation", manifest.mutation],
    ["Previous deployment", manifest.vercel.previousDeploymentId ?? "—"],
    ["New deployment", manifest.vercel.deploymentId ?? "—"],
    ["Convex deployment", manifest.convexDeployment],
  ];
  const lines = [
    `### Release: ${manifest.target}`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([key, value]) => `| ${key} | ${value} |`),
    "",
    `**Reason:** ${manifest.reason}`,
  ];
  for (const [phase, smoke] of Object.entries(manifest.smoke)) {
    lines.push(
      "",
      `**${phase}:** ${smoke.passed} passed, ${smoke.failed} failed, ${smoke.skipped} skipped` +
        (smoke.notConfigured.length
          ? ` — not configured (not counted as passed): ${smoke.notConfigured.join(", ")}`
          : ""),
    );
  }
  if (manifest.recovery) lines.push("", `**Next step:** ${manifest.recovery}`);
  return `${lines.join("\n")}\n`;
}
