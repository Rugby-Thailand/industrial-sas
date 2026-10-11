import {
  networkDiagnosticCode,
  networkHttpOutcome,
} from "../../../scripts/release/lib/smoke-diagnostics.mjs";

/**
 * Pure network classifier for the release page fixture. It turns a Playwright
 * response or failed request into one fixed diagnostic code naming an origin
 * class, outcome and resource class. Codes describe categories observed while
 * a test ran; they are not proof that a request caused the failure.
 *
 * Inputs are read once to classify and never retained: URLs, paths, queries,
 * headers, bodies, methods, status text and provider error text never leave.
 */

export type NetworkOriginClass = "APP" | "CLERK" | "CONVEX" | "OTHER";

/** Reviewed entries from scripts/release/targets.json; never caller input. */
export interface ReviewedTargets {
  readonly targets: Readonly<
    Record<
      string,
      {
        readonly appUrl?: unknown;
        readonly candidateUrl?: unknown;
        readonly clerkFrontendHost?: unknown;
        readonly convexDeployment?: unknown;
      }
    >
  >;
}

export type ReviewedOrigins = ReadonlyMap<string, NetworkOriginClass>;

/** Only the getters the classifier may read from a response. */
export interface ObservedResponse {
  url(): string;
  status(): number;
  request(): { resourceType(): string };
}

/** Only the getters the classifier may read from a failed request. */
export interface ObservedFailedRequest {
  url(): string;
  resourceType(): string;
  failure(): { errorText: string } | null;
}

// Playwright resource types; anything else is OTHER.
const RESOURCES: ReadonlyMap<string, string> = new Map([
  ["document", "DOCUMENT"],
  ["stylesheet", "STYLESHEET"],
  ["image", "IMAGE"],
  ["media", "MEDIA"],
  ["font", "FONT"],
  ["script", "SCRIPT"],
  ["xhr", "XHR"],
  ["fetch", "FETCH"],
  ["eventsource", "EVENTSOURCE"],
  ["websocket", "WEBSOCKET"],
  ["manifest", "MANIFEST"],
]);

// Exact Chromium `errorText` values; any other text is FAILED_OTHER.
const FAILURES: ReadonlyMap<string, string> = new Map([
  ["net::ERR_ABORTED", "FAILED_CANCELLED"],
  ["net::ERR_NAME_NOT_RESOLVED", "FAILED_DNS"],
  ["net::ERR_NAME_RESOLUTION_FAILED", "FAILED_DNS"],
  ["net::ERR_CONNECTION_REFUSED", "FAILED_CONNECTION"],
  ["net::ERR_CONNECTION_RESET", "FAILED_CONNECTION"],
  ["net::ERR_CONNECTION_CLOSED", "FAILED_CONNECTION"],
  ["net::ERR_CONNECTION_ABORTED", "FAILED_CONNECTION"],
  ["net::ERR_CONNECTION_FAILED", "FAILED_CONNECTION"],
  ["net::ERR_ADDRESS_UNREACHABLE", "FAILED_CONNECTION"],
  ["net::ERR_INTERNET_DISCONNECTED", "FAILED_CONNECTION"],
  ["net::ERR_NETWORK_CHANGED", "FAILED_CONNECTION"],
  ["net::ERR_EMPTY_RESPONSE", "FAILED_CONNECTION"],
  ["net::ERR_SSL_PROTOCOL_ERROR", "FAILED_TLS"],
  ["net::ERR_SSL_VERSION_OR_CIPHER_MISMATCH", "FAILED_TLS"],
  ["net::ERR_CERT_AUTHORITY_INVALID", "FAILED_TLS"],
  ["net::ERR_CERT_COMMON_NAME_INVALID", "FAILED_TLS"],
  ["net::ERR_CERT_DATE_INVALID", "FAILED_TLS"],
  ["net::ERR_CERT_INVALID", "FAILED_TLS"],
  ["net::ERR_TIMED_OUT", "FAILED_TIMEOUT"],
  ["net::ERR_CONNECTION_TIMED_OUT", "FAILED_TIMEOUT"],
]);

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const CONVEX_DEPLOYMENT = /^[a-z]+-[a-z]+-[0-9]+$/;

/**
 * A credential-free HTTPS origin. With `bare`, also refuse any path, query or
 * fragment (reviewed target entries must be origins, not URLs).
 */
function reviewedOrigin(value: unknown, bare = true): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!bare || url.href === `${url.origin}/`)
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

/** `scheme://host` only when the host is a plain lowercase DNS name. */
function hostOrigin(scheme: "https:" | "wss:", host: unknown) {
  if (typeof host !== "string" || !HOST.test(host)) return undefined;
  const origin = `${scheme}//${host}`;
  try {
    return new URL(origin).origin === origin ? origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Exact origins of the reviewed target served at `baseURL`. A base URL that
 * is not a reviewed app or candidate origin selects nothing, so every
 * request classifies as OTHER. There are no provider wildcards.
 */
export function reviewedNetworkOrigins(
  reviewed: ReviewedTargets,
  baseURL: string | undefined,
): ReviewedOrigins {
  const origins = new Map<string, NetworkOriginClass>();
  const base = reviewedOrigin(baseURL, false);
  if (!base) return origins;
  for (const target of Object.values(reviewed.targets)) {
    const app = [target.appUrl, target.candidateUrl]
      .map((value) => reviewedOrigin(value))
      .filter((origin) => origin !== undefined);
    if (!app.includes(base)) continue;
    for (const origin of app) origins.set(origin, "APP");
    const clerk = hostOrigin("https:", target.clerkFrontendHost);
    if (clerk) origins.set(clerk, "CLERK");
    const deployment = target.convexDeployment;
    if (typeof deployment === "string" && CONVEX_DEPLOYMENT.test(deployment))
      for (const origin of [
        hostOrigin("https:", `${deployment}.convex.cloud`),
        hostOrigin("wss:", `${deployment}.convex.cloud`),
        hostOrigin("https:", `${deployment}.convex.site`),
      ])
        if (origin) origins.set(origin, "CONVEX");
  }
  return origins;
}

/**
 * Exact origin match over HTTPS/WSS only. Malformed, credential-bearing,
 * opaque (data:, blob:) or unreviewed URLs are OTHER.
 */
export function classifyOrigin(
  origins: ReviewedOrigins,
  value: unknown,
): NetworkOriginClass {
  if (typeof value !== "string") return "OTHER";
  try {
    const url = new URL(value);
    if (url.username || url.password) return "OTHER";
    if (url.protocol !== "https:" && url.protocol !== "wss:") return "OTHER";
    return origins.get(url.origin) ?? "OTHER";
  } catch {
    return "OTHER";
  }
}

function resourceClass(value: unknown) {
  return (typeof value === "string" && RESOURCES.get(value)) || "OTHER";
}

/** Code for an HTTP error response; undefined for non-error statuses. */
export function responseDiagnostic(
  origins: ReviewedOrigins,
  response: ObservedResponse,
): string | undefined {
  try {
    const outcome = networkHttpOutcome(response.status());
    if (!outcome) return undefined;
    return networkDiagnosticCode(
      classifyOrigin(origins, response.url()),
      outcome,
      resourceClass(response.request().resourceType()),
    );
  } catch {
    return undefined;
  }
}

/** Code for a request that failed without an HTTP response. */
export function requestFailureDiagnostic(
  origins: ReviewedOrigins,
  request: ObservedFailedRequest,
): string | undefined {
  try {
    const errorText = request.failure()?.errorText;
    return networkDiagnosticCode(
      classifyOrigin(origins, request.url()),
      (typeof errorText === "string" && FAILURES.get(errorText)) ||
        "FAILED_OTHER",
      resourceClass(request.resourceType()),
    );
  } catch {
    return undefined;
  }
}
