// Release-only Vercel REST client. Never expose provider bodies or messages.
// Inventory must be exhausted: malformed responses, stuck cursors and page caps
// fail preflight rather than presenting empty or silently truncated history.
const API = "https://api.vercel.com";
const STATES = new Set([
  "QUEUED",
  "INITIALIZING",
  "BUILDING",
  "READY",
  "ERROR",
  "CANCELED",
  "DELETED",
  "BLOCKED",
]);
export const isDeploymentId = (id) =>
  typeof id === "string" && /^dpl_[A-Za-z0-9_-]+$/.test(id);

export class VercelApiError extends Error {
  constructor(method, path, status) {
    super(`Vercel API ${method} ${path} failed (${status})`);
    this.name = "VercelApiError";
    this.status = status;
  }
}

export function createVercelApi({
  token,
  teamId,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
  inventoryTimeoutMs = 120_000,
  maxInventoryPages = 100,
}) {
  if (typeof token !== "string" || !token.trim())
    throw new Error("VERCEL_TOKEN is not set");
  if (!/^team_[A-Za-z0-9]+$/.test(teamId ?? ""))
    throw new Error("Vercel team ID is not configured");
  if (
    ![timeoutMs, inventoryTimeoutMs, maxInventoryPages].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  ) {
    throw new Error("Vercel API bounds are invalid");
  }
  async function request(
    method,
    path,
    { query = {}, body, budgetMs = timeoutMs, allowEmpty = false } = {},
  ) {
    const url = new URL(path, API);
    url.searchParams.set("teamId", teamId);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          reject(new VercelApiError(method, url.pathname, "timeout"));
        },
        Math.min(timeoutMs, budgetMs),
      );
    });
    try {
      return await Promise.race([
        timeout,
        (async () => {
          const response = await fetchImpl(url, {
            method,
            redirect: "error",
            signal: controller.signal,
            headers: {
              authorization: `Bearer ${token}`,
              ...(body === undefined
                ? {}
                : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          // Failed bodies can contain credentials; do not consume them.
          if (!response.ok)
            throw new VercelApiError(method, url.pathname, response.status);
          const text = await response.text();
          if (!text && allowEmpty)
            return { status: response.status, body: null };
          let payload;
          try {
            payload = JSON.parse(text);
          } catch {
            throw new VercelApiError(method, url.pathname, "invalid response");
          }
          if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload)
          ) {
            throw new VercelApiError(method, url.pathname, "invalid response");
          }
          return { status: response.status, body: payload };
        })(),
      ]);
    } catch (error) {
      if (error instanceof VercelApiError) throw error;
      throw new VercelApiError(
        method,
        url.pathname,
        "network or response failure",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    async getProject(projectId) {
      return (
        await request("GET", `/v9/projects/${encodeURIComponent(projectId)}`)
      ).body;
    },
    async getDeployment(idOrHost) {
      return (
        await request("GET", `/v13/deployments/${encodeURIComponent(idOrHost)}`)
      ).body;
    },
    async listProductionDeployments(projectId, { limit = 100, since } = {}) {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (since !== undefined && (!Number.isSafeInteger(since) || since < 0))
      ) {
        throw new VercelApiError(
          "GET",
          "/v6/deployments",
          "invalid inventory bounds",
        );
      }
      const deadline = performance.now() + inventoryTimeoutMs;
      const found = new Map();
      let until;
      for (let page = 0; page < maxInventoryPages; page++) {
        const remaining = deadline - performance.now();
        if (remaining <= 0)
          throw new VercelApiError(
            "GET",
            "/v6/deployments",
            "inventory timeout",
          );
        const { body } = await request("GET", "/v6/deployments", {
          query: { projectId, target: "production", limit, since, until },
          budgetMs: remaining,
        });
        if (
          !Array.isArray(body.deployments) ||
          !body.pagination ||
          !Number.isSafeInteger(body.pagination.count) ||
          body.pagination.count !== body.deployments.length ||
          !Object.hasOwn(body.pagination, "next")
        ) {
          throw new VercelApiError(
            "GET",
            "/v6/deployments",
            "invalid inventory response",
          );
        }
        for (const row of body.deployments) {
          const facts = deploymentFacts(row);
          if (
            !facts ||
            facts.projectId !== projectId ||
            facts.target !== "production"
          ) {
            throw new VercelApiError(
              "GET",
              "/v6/deployments",
              "invalid inventory deployment",
            );
          }
          if (
            found.has(facts.id) &&
            JSON.stringify(found.get(facts.id)) !== JSON.stringify(facts)
          ) {
            throw new VercelApiError(
              "GET",
              "/v6/deployments",
              "inconsistent inventory deployment",
            );
          }
          found.set(facts.id, facts);
        }
        const next = body.pagination.next;
        if (next === null) return [...found.values()];
        if (
          !Number.isSafeInteger(next) ||
          next <= 0 ||
          body.deployments.length === 0 ||
          (until !== undefined && next >= until)
        ) {
          throw new VercelApiError(
            "GET",
            "/v6/deployments",
            "invalid inventory cursor",
          );
        }
        until = next;
      }
      throw new VercelApiError(
        "GET",
        "/v6/deployments",
        "inventory page limit",
      );
    },
    // https://vercel.com/docs/rest-api/aliases/assign-an-alias
    async assignAlias(deploymentId, host) {
      return (
        await request(
          "POST",
          `/v2/deployments/${encodeURIComponent(deploymentId)}/aliases`,
          { body: { alias: host }, allowEmpty: true },
        )
      ).status;
    },
    async getAlias(host, projectId) {
      return (
        await request("GET", `/v4/aliases/${encodeURIComponent(host)}`, {
          query: { projectId },
        })
      ).body;
    },
    async promote(projectId, deploymentId) {
      return (
        await request(
          "POST",
          `/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}`,
          { body: {}, allowEmpty: true },
        )
      ).status;
    },
    async rollback(projectId, deploymentId) {
      return (
        await request(
          "POST",
          `/v9/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(deploymentId)}`,
          { body: {}, allowEmpty: true },
        )
      ).status;
    },
  });
}

/** Strictly normalize only the public deployment fields used by the release. */
export function deploymentFacts(deployment) {
  if (
    !deployment ||
    typeof deployment !== "object" ||
    Array.isArray(deployment)
  )
    return null;
  const id = deployment.id ?? deployment.uid;
  const readyState = deployment.readyState ?? deployment.state;
  const createdAt = deployment.createdAt ?? deployment.created;
  if (
    !isDeploymentId(id) ||
    !STATES.has(readyState) ||
    !Number.isSafeInteger(createdAt) ||
    createdAt <= 0
  )
    return null;
  return {
    id,
    url: typeof deployment.url === "string" ? deployment.url : undefined,
    projectId: deployment.projectId,
    target: deployment.target ?? null,
    readyState,
    createdAt,
    meta: Object.fromEntries(
      ["releaseSha", "githubCommitSha", "releaseRunId"]
        .filter((key) => deployment.meta && Object.hasOwn(deployment.meta, key))
        .map((key) => [
          key,
          typeof deployment.meta[key] === "string" &&
          (key === "releaseRunId"
            ? /^\d{1,20}$/.test(deployment.meta[key])
            : /^[0-9a-f]{40}$/.test(deployment.meta[key]))
            ? deployment.meta[key]
            : null,
        ]),
    ),
  };
}
