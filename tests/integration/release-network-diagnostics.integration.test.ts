import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_NETWORK_DIAGNOSTICS,
  networkErrorsMessage,
  smokeFailureDiagnostics,
} from "../../scripts/release/lib/smoke-diagnostics.mjs";
import reviewedTargets from "../../scripts/release/targets.json";
import {
  classifyOrigin,
  requestFailureDiagnostic,
  responseDiagnostic,
  reviewedNetworkOrigins,
} from "../e2e/support/release-network-diagnostics";

type Listener = (payload: unknown) => void;
type PageFixture = (
  fixtures: { page: unknown; context: unknown; baseURL?: string },
  use: (page: unknown) => Promise<void>,
  testInfo: unknown,
) => Promise<void>;

// Capture the real `page` fixture body passed to Playwright's `base.extend`.
const captured = vi.hoisted(() => ({
  fixtures: undefined as Record<string, unknown> | undefined,
  extended: { releaseFixtures: true },
}));
const protection = vi.hoisted(() => ({
  assertHealthy: vi.fn(),
  dispose: vi.fn(async () => {}),
}));
const scope = vi.hoisted(() => ({
  scopeProtectionBypass: vi.fn(async () => protection),
}));

vi.mock("@playwright/test", () => ({
  test: {
    extend: (fixtures: Record<string, unknown>) => {
      captured.fixtures = fixtures;
      return captured.extended;
    },
  },
  expect: {},
}));
vi.mock("../e2e/support/protection", () => scope);

import { test as releaseTest } from "../e2e/support/release-fixtures";

const STAGE = reviewedTargets.targets.staging.appUrl;
const CLERK_ORIGIN = `https://${reviewedTargets.targets.staging.clerkFrontendHost}`;
const SENTINEL = "nonfunctional-sensitive-sentinel";
const EXISTING_CODE = "SENSITIVE_SMOKE_NETWORK_ERRORS";
// Bounded fixed vocabulary only: names provider, status and resource class.
const CLERK_403_FETCH_CODE =
  /^SENSITIVE_SMOKE_NETWORK_(?=[A-Z0-9_]*CLERK)(?=[A-Z0-9_]*HTTP_?403)(?=[A-Z0-9_]*FETCH)[A-Z0-9_]{1,40}$/;

/** Minimal Playwright-like event emitter for a page or browser context. */
function fakeEmitter() {
  const listeners = new Map<string, Set<Listener>>();
  const on = (event: string, listener: Listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(listener);
    return emitter;
  };
  const off = (event: string, listener: Listener) => {
    listeners.get(event)?.delete(listener);
    return emitter;
  };
  const emitter = {
    on,
    off,
    addListener: on,
    removeListener: off,
    emit(event: string, payload: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])])
        listener(payload);
    },
    listenerCount: (event?: string) =>
      event === undefined
        ? [...listeners.values()].reduce((sum, set) => sum + set.size, 0)
        : (listeners.get(event)?.size ?? 0),
  };
  return emitter;
}

afterEach(() => {
  vi.clearAllMocks();
});

const NETWORK_EVENTS = ["pageerror", "console", "response", "requestfailed"];
// The only getters the classifier may read.
const ALLOWED_READS = new Set([
  "url",
  "status",
  "request",
  "request.resourceType",
  "resourceType",
  "failure",
]);
const CONVEX_DEPLOYMENT = reviewedTargets.targets.staging.convexDeployment;

/**
 * Network payload whose every property read is recorded. Forbidden getters
 * (headers, bodies, methods, status text) return the sentinel if ever read.
 */
function observed(reads: string[], url: string, resourceType: string) {
  const forbidden = () => SENTINEL;
  const record = <T extends object>(prefix: string, target: T) =>
    new Proxy(target, {
      get(object, property, receiver) {
        if (typeof property === "string") reads.push(`${prefix}${property}`);
        return Reflect.get(object, property, receiver) as unknown;
      },
    });
  const request = record("request.", {
    url: () => url,
    resourceType: () => resourceType,
    method: forbidden,
    headers: forbidden,
    allHeaders: forbidden,
    postData: forbidden,
  });
  return {
    response: (status: number) =>
      record("", {
        url: () => url,
        status: () => status,
        statusText: forbidden,
        headers: forbidden,
        allHeaders: forbidden,
        headerValue: forbidden,
        body: forbidden,
        text: forbidden,
        json: forbidden,
        request: () => request,
      }),
    failed: (errorText: string | null) =>
      record("", {
        url: () => url,
        resourceType: () => resourceType,
        failure: () => (errorText === null ? null : { errorText }),
        method: forbidden,
        headers: forbidden,
        allHeaders: forbidden,
        postData: forbidden,
        response: forbidden,
      }),
  };
}

const failedToLoad = (url: string) => ({
  type: () => "error",
  text: () =>
    `Failed to load resource: the server responded with a status of 403 () ${url}`,
});

/** Runs the real page fixture once with a fresh fake page and context. */
async function runPage(
  body: (page: ReturnType<typeof fakeEmitter>) => void | Promise<void>,
  baseURL: string | null = STAGE,
) {
  const pageFixture = captured.fixtures?.page as PageFixture;
  const page = fakeEmitter();
  const context = fakeEmitter();
  let rejected: unknown;
  try {
    await pageFixture(
      { page, context, ...(baseURL ? { baseURL } : {}) },
      async () => body(page),
      {},
    );
  } catch (error) {
    rejected = error;
  }
  const listeners = NETWORK_EVENTS.reduce(
    (sum, event) => sum + page.listenerCount(event),
    0,
  );
  return { rejected, page, listeners };
}

/** Fixed diagnostics of a rejection; never prints the raw message. */
function rejectedDiagnostics(rejected: unknown) {
  expect(rejected instanceof Error).toBe(true);
  const message = (rejected as Error).message;
  expect(message.includes(SENTINEL)).toBe(false);
  expect(message.includes("://")).toBe(false);
  return smokeFailureDiagnostics(`Error: ${message}`);
}

const code = (suffix: string) => `SENSITIVE_SMOKE_NETWORK_${suffix}`;

describe("release page fixture network diagnostics", () => {
  it("retains a bounded Clerk HTTP 403 fetch code when teardown fails on network errors", async () => {
    // Sanity: the mocks captured the actual fixture module, not a stub.
    expect(releaseTest).toBe(captured.extended);
    const pageFixture = captured.fixtures?.page as PageFixture | undefined;
    expect(typeof pageFixture).toBe("function");

    const page = fakeEmitter();
    const context = fakeEmitter();
    const url = `${CLERK_ORIGIN}/v1/client/${SENTINEL}?__clerk_api_version=${SENTINEL}&_clerk_session=${SENTINEL}`;
    const request = {
      url: () => url,
      method: () => "GET",
      resourceType: () => "fetch",
      isNavigationRequest: () => false,
      failure: () => null,
    };
    const response = {
      url: () => url,
      status: () => 403,
      statusText: () => "Forbidden",
      ok: () => false,
      headers: () => ({}),
      request: () => request,
    };
    const consoleMessage = {
      type: () => "error",
      text: () =>
        `Failed to load resource: the server responded with a status of 403 () ${url}`,
      location: () => ({ url, lineNumber: 0, columnNumber: 0 }),
    };

    let rejected: unknown;
    try {
      await pageFixture!(
        { page, context, baseURL: STAGE },
        async (usedPage) => {
          expect(usedPage).toBe(page);
          // Playwright emits network events on both the page and its context.
          for (const target of [page, context]) {
            target.emit("request", request);
            target.emit("response", response);
            target.emit("requestfinished", request);
          }
          page.emit("console", consoleMessage);
        },
        {},
      );
    } catch (error) {
      rejected = error;
    }

    // The fixture ran its real teardown against the mocked protection scope.
    expect(scope.scopeProtectionBypass).toHaveBeenCalledWith(context, STAGE);
    expect(protection.dispose).toHaveBeenCalledTimes(1);
    expect(page.listenerCount("console")).toBe(0);
    expect(page.listenerCount("pageerror")).toBe(0);

    // Failure verdict and existing fixed code are unchanged. Boolean checks
    // only, so no fixture or provider message is ever printed.
    expect(rejected instanceof Error).toBe(true);
    const message = (rejected as Error).message;
    expect(message.startsWith(EXISTING_CODE)).toBe(true);
    expect(message.includes(SENTINEL)).toBe(false);
    expect(message.includes(CLERK_ORIGIN)).toBe(false);

    const diagnostics = smokeFailureDiagnostics(`Error: ${message}`);
    expect(diagnostics.some((code) => code.includes(SENTINEL))).toBe(false);
    expect(diagnostics.length).toBeLessThanOrEqual(4);
    expect(diagnostics).toContain(EXISTING_CODE);
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.stringMatching(CLERK_403_FETCH_CODE)]),
    );
  });

  it.each([
    ["an expected Clerk 401", "response"],
    ["an expected Convex 403", "response"],
    ["a cancelled request", "requestfailed"],
    ["a DNS failure", "requestfailed"],
  ] as const)(
    "passes %s with no console error and removes its listeners",
    async (label, kind) => {
      const reads: string[] = [];
      const url = label.includes("Clerk")
        ? `${CLERK_ORIGIN}/v1/client?${SENTINEL}`
        : `https://${CONVEX_DEPLOYMENT}.convex.cloud/api/${SENTINEL}`;
      const payload = observed(reads, url, "fetch");
      const run = await runPage((page) => {
        if (kind === "response")
          page.emit(
            "response",
            payload.response(label.includes("401") ? 401 : 403),
          );
        else
          page.emit(
            "requestfailed",
            payload.failed(
              label.includes("DNS")
                ? "net::ERR_NAME_NOT_RESOLVED"
                : "net::ERR_ABORTED",
            ),
          );
      });
      expect(run.rejected).toBeUndefined();
      expect(protection.assertHealthy).toHaveBeenCalledTimes(1);
      expect(protection.dispose).toHaveBeenCalledTimes(1);
      expect(run.listeners).toBe(0);
      expect(reads.every((read) => ALLOWED_READS.has(read))).toBe(true);
    },
  );

  it("attaches exact observed network codes only to the existing network verdict", async () => {
    const reads: string[] = [];
    const convex = observed(
      reads,
      `wss://${CONVEX_DEPLOYMENT}.convex.cloud/api/sync?${SENTINEL}`,
      "websocket",
    );
    const app = observed(reads, `${STAGE}/th/${SENTINEL}`, "document");
    const clerk = observed(reads, `${CLERK_ORIGIN}/v1/${SENTINEL}`, "fetch");
    const run = await runPage((page) => {
      page.emit("requestfailed", convex.failed("net::ERR_TIMED_OUT"));
      page.emit("response", app.response(502));
      page.emit("response", app.response(200));
      page.emit("response", app.response(302));
      page.emit("response", clerk.response(403));
      page.emit("response", clerk.response(403));
      page.emit("console", failedToLoad(`${CLERK_ORIGIN}/v1/${SENTINEL}`));
    });
    const readsAtTeardown = reads.length;
    const expected = [
      code("CONVEX_FAILED_TIMEOUT_WEBSOCKET"),
      code("APP_HTTP_502_DOCUMENT"),
      code("CLERK_HTTP_403_FETCH"),
    ];
    expect(rejectedDiagnostics(run.rejected)).toEqual([
      EXISTING_CODE,
      ...expected,
    ]);
    expect(
      (run.rejected as Error).message === networkErrorsMessage(expected),
    ).toBe(true);
    expect(protection.assertHealthy).not.toHaveBeenCalled();
    expect(protection.dispose).toHaveBeenCalledTimes(1);
    expect(run.listeners).toBe(0);
    // Only URL/status/resource type/failure are read, and only while the
    // event is classified: nothing is retained and read again later.
    expect(reads.every((read) => ALLOWED_READS.has(read))).toBe(true);
    run.page.emit("response", clerk.response(500));
    expect(reads.length).toBe(readsAtTeardown);
  });

  it.each([
    ["an uncaught page error", "SENSITIVE_SMOKE_UNCAUGHT_ERRORS", true, false],
    ["a generic console error", "SENSITIVE_SMOKE_CONSOLE_ERRORS", false, false],
    [
      "uncaught and network errors",
      "SENSITIVE_SMOKE_UNCAUGHT_ERRORS",
      true,
      true,
    ],
  ] as const)(
    "keeps the bare existing code for %s",
    async (_label, expected, uncaught, network) => {
      const clerk = observed([], `${CLERK_ORIGIN}/v1/${SENTINEL}`, "fetch");
      const run = await runPage((page) => {
        page.emit("response", clerk.response(403));
        if (uncaught) page.emit("pageerror", new Error(SENTINEL));
        page.emit(
          "console",
          network
            ? failedToLoad(CLERK_ORIGIN)
            : { type: () => "error", text: () => SENTINEL },
        );
      });
      expect((run.rejected as Error).message === expected).toBe(true);
      expect(rejectedDiagnostics(run.rejected)).toEqual([expected]);
      expect(run.listeners).toBe(0);
    },
  );

  it("bounds accumulated codes per fixture and keeps no state across fixtures", async () => {
    const statuses = [400, 401, 403, 404, 422, 429, 500, 502, 503, 504];
    const overflowReads: string[] = [];
    const first = await runPage((page) => {
      for (const resourceType of ["fetch", "xhr"])
        for (const status of statuses)
          page.emit(
            "response",
            observed([], `${STAGE}/${SENTINEL}`, resourceType).response(status),
          );
      // The set is full: further events are not read or classified at all.
      const overflow = observed(overflowReads, CLERK_ORIGIN, "script");
      page.emit("response", overflow.response(500));
      page.emit("requestfailed", overflow.failed("net::ERR_TIMED_OUT"));
      page.emit("console", failedToLoad(STAGE));
    });
    expect(overflowReads).toEqual([]);
    const bounded = rejectedDiagnostics(first.rejected);
    expect(bounded).toEqual([
      EXISTING_CODE,
      ...statuses
        .slice(0, MAX_NETWORK_DIAGNOSTICS)
        .map((status) => code(`APP_HTTP_${status}_FETCH`)),
    ]);

    // A fresh fixture starts empty: no codes leak from the previous run.
    const second = await runPage((page) =>
      page.emit("console", failedToLoad(STAGE)),
    );
    expect((second.rejected as Error).message === EXISTING_CODE).toBe(true);
    expect(rejectedDiagnostics(second.rejected)).toEqual([EXISTING_CODE]);
    expect(first.listeners + second.listeners).toBe(0);
    expect(protection.dispose).toHaveBeenCalledTimes(2);
  });

  it("rethrows a body error untouched and still removes listeners", async () => {
    const bodyError = new Error(SENTINEL);
    const run = await runPage((page) => {
      page.emit(
        "response",
        observed([], `${CLERK_ORIGIN}/${SENTINEL}`, "fetch").response(403),
      );
      page.emit("console", failedToLoad(CLERK_ORIGIN));
      throw bodyError;
    });
    expect(run.rejected === bodyError).toBe(true);
    expect(bodyError.message === SENTINEL).toBe(true);
    expect(protection.assertHealthy).not.toHaveBeenCalled();
    expect(protection.dispose).toHaveBeenCalledTimes(1);
    expect(run.listeners).toBe(0);
  });

  it("removes listeners when the protection health check fails at teardown", async () => {
    protection.assertHealthy.mockImplementationOnce(() => {
      throw new Error("SMOKE_PROTECTION_REQUEST_FAILED");
    });
    const run = await runPage((page) =>
      page.emit(
        "response",
        observed([], `${CLERK_ORIGIN}/${SENTINEL}`, "fetch").response(401),
      ),
    );
    expect(rejectedDiagnostics(run.rejected)).toEqual([
      "SMOKE_PROTECTION_REQUEST_FAILED",
    ]);
    expect(protection.dispose).toHaveBeenCalledTimes(1);
    expect(run.listeners).toBe(0);
  });

  it("classifies against no origins without a reviewed base URL", async () => {
    const run = await runPage((page) => {
      page.emit(
        "response",
        observed([], `${CLERK_ORIGIN}/${SENTINEL}`, "fetch").response(403),
      );
      page.emit("console", failedToLoad(CLERK_ORIGIN));
    }, null);
    expect(scope.scopeProtectionBypass).not.toHaveBeenCalled();
    expect(rejectedDiagnostics(run.rejected)).toEqual([
      EXISTING_CODE,
      code("OTHER_HTTP_403_FETCH"),
    ]);
    expect(run.listeners).toBe(0);
  });
});

describe("release network classifier", () => {
  const staging = reviewedNetworkOrigins(reviewedTargets, STAGE);
  const production = reviewedNetworkOrigins(
    reviewedTargets,
    reviewedTargets.targets.production.candidateUrl,
  );
  const prod = reviewedTargets.targets.production;

  it("derives exact origin classes from the reviewed target at the base URL", () => {
    expect(Object.fromEntries(staging)).toEqual({
      [STAGE]: "APP",
      [CLERK_ORIGIN]: "CLERK",
      [`https://${CONVEX_DEPLOYMENT}.convex.cloud`]: "CONVEX",
      [`wss://${CONVEX_DEPLOYMENT}.convex.cloud`]: "CONVEX",
      [`https://${CONVEX_DEPLOYMENT}.convex.site`]: "CONVEX",
    });
    expect(Object.fromEntries(production)).toEqual({
      [prod.appUrl]: "APP",
      [prod.candidateUrl]: "APP",
      [`https://${prod.clerkFrontendHost}`]: "CLERK",
      [`https://${prod.convexDeployment}.convex.cloud`]: "CONVEX",
      [`wss://${prod.convexDeployment}.convex.cloud`]: "CONVEX",
      [`https://${prod.convexDeployment}.convex.site`]: "CONVEX",
    });
    expect(
      reviewedNetworkOrigins(reviewedTargets, `${STAGE}/th/x?y=1`),
    ).toEqual(staging);
    for (const base of [
      undefined,
      "https://unreviewed.vercel.app",
      "http://industrial-sas-staging.vercel.app",
      `https://user@${new URL(STAGE).host}`,
      `${STAGE}.other.invalid`,
      "not a url",
    ])
      expect(reviewedNetworkOrigins(reviewedTargets, base).size).toBe(0);
  });

  it("ignores malformed reviewed entries instead of widening a match", () => {
    const origins = reviewedNetworkOrigins(
      {
        targets: {
          bad: {
            appUrl: STAGE,
            candidateUrl: `${STAGE}/path`,
            clerkFrontendHost: "*.clerk.accounts.dev",
            convexDeployment: "*",
          },
          wildcard: {
            appUrl: "https://user@other.invalid",
            clerkFrontendHost: "clerk.other.invalid/path",
            convexDeployment: "other.invalid/x",
          },
        },
      },
      STAGE,
    );
    expect(Object.fromEntries(origins)).toEqual({ [STAGE]: "APP" });
  });

  it.each([
    [STAGE, "APP"],
    [`${STAGE}/th/${SENTINEL}?q=${SENTINEL}#${SENTINEL}`, "APP"],
    [`${CLERK_ORIGIN.toUpperCase()}/v1`, "CLERK"],
    [`wss://${CONVEX_DEPLOYMENT}.convex.cloud/api/sync`, "CONVEX"],
    [`https://${CONVEX_DEPLOYMENT}.convex.site/webhooks`, "CONVEX"],
    [CLERK_ORIGIN.replace("https:", "http:"), "OTHER"],
    [`${CLERK_ORIGIN}:444/v1`, "OTHER"],
    [`${CLERK_ORIGIN}.other.invalid/v1`, "OTHER"],
    ["https://other-instance-1.clerk.accounts.dev/v1", "OTHER"],
    [`https://${SENTINEL}:${SENTINEL}@${new URL(CLERK_ORIGIN).host}/`, "OTHER"],
    [`https://user@${new URL(STAGE).host}/`, "OTHER"],
    ["https://other-deployment-1.convex.cloud/api", "OTHER"],
    [`https://${CONVEX_DEPLOYMENT}.convex.cloud.other.invalid/`, "OTHER"],
    [`wss://${CONVEX_DEPLOYMENT}.convex.site/`, "OTHER"],
    [`ws://${CONVEX_DEPLOYMENT}.convex.cloud/`, "OTHER"],
    [`https://${prod.clerkFrontendHost}/v1`, "OTHER"],
    [prod.appUrl, "OTHER"],
    [`data:text/plain,${SENTINEL}`, "OTHER"],
    [`blob:${STAGE}/${SENTINEL}`, "OTHER"],
    ["not a url", "OTHER"],
    ["", "OTHER"],
    [undefined, "OTHER"],
  ] as const)("classifies %s as %s", (url, expected) => {
    expect(classifyOrigin(staging, url)).toBe(expected);
  });

  it("maps statuses, resources and failures to the fixed vocabulary only", () => {
    const response = (status: number, resourceType = "fetch") =>
      responseDiagnostic(
        staging,
        observed([], `${CLERK_ORIGIN}/${SENTINEL}`, resourceType).response(
          status,
        ),
      );
    expect(response(403)).toBe(code("CLERK_HTTP_403_FETCH"));
    expect(response(418)).toBe(code("CLERK_HTTP_4XX_FETCH"));
    expect(response(501)).toBe(code("CLERK_HTTP_5XX_FETCH"));
    for (const status of [200, 204, 302, 399, 600, 403.5, Number.NaN])
      expect(response(status)).toBeUndefined();
    for (const resourceType of [
      "document",
      "stylesheet",
      "image",
      "media",
      "font",
      "script",
      "xhr",
      "fetch",
      "eventsource",
      "websocket",
      "manifest",
    ])
      expect(response(500, resourceType)).toBe(
        code(`CLERK_HTTP_500_${resourceType.toUpperCase()}`),
      );
    for (const resourceType of ["texttrack", "other", "FETCH", SENTINEL, ""])
      expect(response(500, resourceType)).toBe(code("CLERK_HTTP_500_OTHER"));

    const failure = (errorText: string | null) =>
      requestFailureDiagnostic(
        staging,
        observed([], `${STAGE}/${SENTINEL}`, "script").failed(errorText),
      );
    for (const [errorText, category] of [
      ["net::ERR_ABORTED", "CANCELLED"],
      ["net::ERR_NAME_NOT_RESOLVED", "DNS"],
      ["net::ERR_CONNECTION_REFUSED", "CONNECTION"],
      ["net::ERR_CONNECTION_RESET", "CONNECTION"],
      ["net::ERR_CERT_AUTHORITY_INVALID", "TLS"],
      ["net::ERR_SSL_PROTOCOL_ERROR", "TLS"],
      ["net::ERR_TIMED_OUT", "TIMEOUT"],
      ["net::ERR_CONNECTION_TIMED_OUT", "TIMEOUT"],
      ["net::ERR_BLOCKED_BY_CLIENT", "OTHER"],
      ["NS_ERROR_FAILURE", "OTHER"],
      [`net::ERR_ABORTED ${SENTINEL}`, "OTHER"],
      [SENTINEL, "OTHER"],
      [null, "OTHER"],
    ] as const)
      expect(failure(errorText)).toBe(code(`APP_FAILED_${category}_SCRIPT`));

    // A throwing getter yields no code rather than a guessed one.
    const throwing = {
      url: () => STAGE,
      status: () => 500,
      request: () => {
        throw new Error(SENTINEL);
      },
    };
    expect(responseDiagnostic(staging, throwing)).toBeUndefined();
  });
});
