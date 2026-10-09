import { readFileSync } from "node:fs";

import type {
  APIRequestContext,
  APIResponse,
  BrowserContext,
  CDPSession,
  Page,
} from "@playwright/test";

export const OIDC_HEADER = "x-vercel-trusted-oidc-idp-token";
const PROTECTION_HEADERS = new Set([
  OIDC_HEADER,
  "x-vercel-protection-bypass",
  "x-vercel-set-bypass-cookie",
]);

export interface OriginProtection {
  readonly origin: string;
  readonly readToken: () => string;
}

type Environment = Readonly<Record<string, string | undefined>>;
type RequestOptions = NonNullable<Parameters<APIRequestContext["fetch"]>[1]>;

/** Removes protection credentials even when a caller used different casing. */
export function withoutProtectionHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !PROTECTION_HEADERS.has(name.toLowerCase()),
    ),
  );
}

/** Lazy reads allow the parent to rotate its private file while a suite runs. */
export function readStagingToken(env: Environment = process.env): string {
  let token: string;
  try {
    token = env.STAGING_VERCEL_OIDC_TOKEN_FILE?.trim()
      ? readFileSync(env.STAGING_VERCEL_OIDC_TOKEN_FILE.trim(), "utf8").trim()
      : (env.STAGING_VERCEL_OIDC_TOKEN ?? "").trim();
  } catch {
    throw new Error("STAGING_PROTECTION_TOKEN_UNAVAILABLE");
  }
  if (!token || /[\s\r\n]/.test(token))
    throw new Error("STAGING_PROTECTION_TOKEN_UNAVAILABLE");
  // This is freshness validation, not JWT verification: Vercel verifies the
  // issuer, audience, signature and reviewed workflow claims. The parent
  // refreshes every 45 seconds; refuse a token with <=30 seconds remaining.
  try {
    const pieces = token.split(".");
    if (pieces.length !== 3) throw new Error("invalid token");
    const { exp } = JSON.parse(Buffer.from(pieces[1]!, "base64url").toString());
    if (!Number.isSafeInteger(exp) || exp <= Date.now() / 1_000 + 30)
      throw new Error("stale token");
  } catch {
    throw new Error("STAGING_PROTECTION_TOKEN_UNAVAILABLE");
  }
  return token;
}

/** A reviewed stage origin is the only destination that can receive OIDC. */
export function stagingProtection(
  env: Environment = process.env,
): OriginProtection | undefined {
  if (env.SMOKE_TARGET !== "staging") return undefined;
  const reviewed = JSON.parse(
    readFileSync("scripts/release/targets.json", "utf8"),
  ).targets.staging.appUrl as string;
  let origin: string;
  try {
    const base = new URL(env.SMOKE_BASE_URL ?? "");
    if (
      base.username ||
      base.password ||
      base.origin !== new URL(reviewed).origin
    )
      throw new Error("wrong origin");
    origin = base.origin;
  } catch {
    throw new Error("STAGING_PROTECTION_ORIGIN_INVALID");
  }
  return { origin, readToken: () => readStagingToken(env) };
}

/**
 * Playwright routes run only for the first request in a redirect chain, and
 * their header overrides persist across every hop. Chromium's CDP Fetch
 * overrides affect only the current request; each redirect pauses again.
 * Install after the fixture's blank page exists and before any navigation.
 * Credentialed suites use one page; unexpected popups fail closed.
 */
export async function installProtectedOrigin(
  context: BrowserContext,
  protection: OriginProtection | undefined,
) {
  const pages = context.pages();
  if (!pages.length || context.browser()?.browserType().name() !== "chromium")
    throw new Error("SMOKE_PROTECTION_REQUIRES_CHROMIUM_PAGE");
  const sessions: CDPSession[] = [];
  const removeListeners: (() => void)[] = [];
  let failed = false;
  const unexpectedPage = (page: Page) => {
    failed = true;
    void page.close().catch(() => {});
  };
  context.on("page", unexpectedPage);
  try {
    for (const page of pages) {
      const session = await context.newCDPSession(page);
      sessions.push(session);
      const canceled = new Set<string>();
      const loadingFailed = (event: {
        requestId: string;
        canceled?: boolean;
      }) => {
        if (event.canceled !== true) return;
        canceled.add(event.requestId);
        // A per-page smoke session is short, but keep the event history bounded.
        if (canceled.size > 2_048)
          canceled.delete(canceled.values().next().value!);
      };
      session.on("Network.loadingFailed", loadingFailed);
      removeListeners.push(() =>
        session.off("Network.loadingFailed", loadingFailed),
      );
      await session.send("Network.enable");
      const handleRequest = async (event: {
        requestId: string;
        networkId?: string;
        request: { url: string; headers: Record<string, string> };
      }) => {
        let continuing = false;
        try {
          const headers = withoutProtectionHeaders(event.request.headers);
          if (
            protection &&
            new URL(event.request.url).origin === protection.origin
          )
            headers[OIDC_HEADER] = protection.readToken();
          continuing = true;
          await session.send("Fetch.continueRequest", {
            requestId: event.requestId,
            headers: Object.entries(headers).map(([name, value]) => ({
              name,
              value: String(value),
            })),
          });
        } catch (error) {
          // Chromium removes a paused interception when navigation/AbortController
          // cancels its matching network request. Permit only that proved case,
          // never token/header failures, unknown protocol errors or closed sessions.
          if (
            continuing &&
            event.networkId !== undefined &&
            canceled.has(event.networkId) &&
            error instanceof Error &&
            /^(?:cdpSession\.send: )?Protocol error \(Fetch\.continueRequest\): Invalid InterceptionId\.$/.test(
              error.message,
            )
          ) {
            canceled.delete(event.networkId);
            return;
          }
          // Never log protocol errors: request details can contain credentials.
          failed = true;
          await session
            .send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            })
            .catch(() => {});
        }
      };
      session.on("Fetch.requestPaused", handleRequest);
      removeListeners.push(() =>
        session.off("Fetch.requestPaused", handleRequest),
      );
      await session.send("Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
      });
    }
  } catch {
    context.off("page", unexpectedPage);
    for (const remove of removeListeners) remove();
    await Promise.all(
      sessions.map((session) => session.detach().catch(() => {})),
    );
    throw new Error("SMOKE_PROTECTION_SETUP_FAILED");
  }
  return {
    assertHealthy() {
      if (failed) throw new Error("SMOKE_PROTECTION_REQUEST_FAILED");
    },
    async dispose() {
      context.off("page", unexpectedPage);
      for (const remove of removeListeners) remove();
      await Promise.all(
        sessions.map(async (session) => {
          await session.send("Fetch.disable").catch(() => {});
          await session.send("Network.disable").catch(() => {});
          await session.detach().catch(() => {});
        }),
      );
    },
  };
}

export async function installStagingProtection(
  context: BrowserContext,
  env: Environment = process.env,
) {
  return installProtectedOrigin(context, stagingProtection(env));
}

/**
 * APIRequestContext is separate from browser routing. Follow redirects one at
 * a time with a fresh token read, and never forward protection headers to the
 * redirected origin. Credentialed contexts must not set global extra headers.
 */
export async function protectedRequest(
  request: APIRequestContext,
  url: string,
  protection: OriginProtection | undefined,
  options: RequestOptions = {},
): Promise<APIResponse> {
  const limit = options.maxRedirects ?? 5;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 20)
    throw new Error("SMOKE_REDIRECT_LIMIT_INVALID");
  let destination = new URL(url);
  let current = { ...options };
  let sourceOrigin = destination.origin;
  for (let count = 0; ; count += 1) {
    const headers = withoutProtectionHeaders(current.headers ?? {});
    if (destination.origin !== sourceOrigin) {
      for (const name of Object.keys(headers))
        if (["authorization", "cookie"].includes(name.toLowerCase()))
          delete headers[name];
    }
    current = { ...current, headers: { ...headers } };
    if (protection && destination.origin === protection.origin)
      headers[OIDC_HEADER] = protection.readToken();
    const response = await request.fetch(destination.href, {
      ...current,
      headers,
      maxRedirects: 0,
      maxRetries: 0,
    });
    const location = response.headers().location;
    if (
      ![301, 302, 303, 307, 308].includes(response.status()) ||
      !location ||
      limit === 0
    )
      return response;
    if (count >= limit) {
      await response.dispose();
      throw new Error("SMOKE_REDIRECT_LIMIT_EXCEEDED");
    }
    const next = new URL(location, destination);
    if (
      !["http:", "https:"].includes(next.protocol) ||
      next.username ||
      next.password
    ) {
      await response.dispose();
      throw new Error("SMOKE_REDIRECT_URL_INVALID");
    }
    const method = (current.method ?? "GET").toUpperCase();
    // Browser smoke only sends read requests to protected applications. Do not
    // permit an unexpected redirect to disclose a write payload elsewhere.
    if (
      next.origin !== destination.origin &&
      !["GET", "HEAD"].includes(method)
    ) {
      await response.dispose();
      throw new Error("SMOKE_WRITE_REDIRECT_REFUSED");
    }
    if (
      (response.status() === 303 && method !== "HEAD") ||
      ([301, 302].includes(response.status()) && method === "POST")
    ) {
      current = { ...current, method: "GET" };
      delete current.data;
      delete current.form;
      delete current.multipart;
    }
    sourceOrigin = destination.origin;
    destination = next;
    await response.dispose();
  }
}

export async function stagingProtectedRequest(
  request: APIRequestContext,
  url: string,
  options: RequestOptions = {},
  env: Environment = process.env,
) {
  return protectedRequest(
    request,
    new URL(url, env.SMOKE_BASE_URL).href,
    stagingProtection(env),
    options,
  );
}

/** Preserve Playwright's API fixture interface without global token headers. */
export function protectRequestContext(
  request: APIRequestContext,
  env: Environment = process.env,
): APIRequestContext {
  const methods = new Map([
    ["get", "GET"],
    ["head", "HEAD"],
    ["post", "POST"],
    ["put", "PUT"],
    ["patch", "PATCH"],
    ["delete", "DELETE"],
  ]);
  return new Proxy(request, {
    get(target, property) {
      if (
        property === "fetch" ||
        (typeof property === "string" && methods.has(property))
      )
        return (url: string, options: RequestOptions = {}) =>
          stagingProtectedRequest(
            target,
            url,
            property === "fetch"
              ? options
              : { ...options, method: methods.get(String(property))! },
            env,
          );
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
