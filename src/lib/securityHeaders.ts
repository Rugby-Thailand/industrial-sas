/**
 * The response headers every route serves, and the reasoning for each.
 *
 * A module rather than an inline literal in `next.config.ts` so the policy is
 * testable without booting Next: `next.config.ts` is loaded by Next's own
 * TypeScript pipeline, and a header set that can only be checked by starting a
 * server is a header set that gets checked once.
 *
 * ### Why the Content-Security-Policy is split in two
 *
 * A useful CSP for this application constrains where scripts may come from, and
 * that is exactly the directive Next.js cannot satisfy without per-request
 * nonces: the App Router inlines its bootstrap and streaming payloads, so
 * `script-src 'self'` alone blanks the page and `'unsafe-inline'` reduces the
 * directive to decoration. Nonce plumbing belongs in `src/proxy.ts` and has to
 * be introduced with the identity slice, because that is when the first
 * third-party script origin (Clerk) appears and the policy stops being
 * guessable.
 *
 * So the policy is split by what can be *enforced honestly today*:
 *
 * - **Enforced** — the directives that cannot break a page no matter what it
 *   loads, because they restrict things this application never does:
 *   `frame-ancestors`, `base-uri`, `object-src`, `form-action`. Every one of
 *   these is a real attack surface (clickjacking, base-tag injection, legacy
 *   plugin embedding, form exfiltration) and none of them is a guess about
 *   future script origins.
 * - **Report-Only** — the fuller policy including `script-src` and `connect-src`.
 *   It produces violation reports instead of breakages, so the day Convex and
 *   Clerk are configured the report tells us the exact origins to allow rather
 *   than us inventing them now and shipping a policy that is either wrong or
 *   permissive enough to be pointless.
 *
 * `X-Frame-Options: DENY` is sent alongside `frame-ancestors 'none'` rather than
 * instead of it. `frame-ancestors` supersedes it in every browser that supports
 * CSP Level 2, and the legacy header costs one line for the ones that do not.
 */

/** One header, as Next.js's `headers()` wants it. */
export interface ResponseHeader {
  readonly key: string;
  readonly value: string;
}

/**
 * Directives safe to enforce before any vendor origin is known.
 *
 * Each one forbids something this application has no code to do, so enforcing
 * them now cannot break a screen and does not have to be revisited when Clerk
 * and Convex arrive:
 *
 * - `frame-ancestors 'none'` — nothing may embed this application. A WMS session
 *   is a tenant's live stock; clickjacking a putaway confirmation is a real
 *   consequence, not a theoretical one.
 * - `base-uri 'self'` — an injected `<base>` tag can silently repoint every
 *   relative URL on the page, including the ones the App Router emits.
 * - `object-src 'none'` — no `<object>`/`<embed>` is used anywhere.
 * - `form-action 'self'` — every form in this application posts to a Convex
 *   mutation through `fetch`, never to a cross-origin action. Clerk's hosted
 *   flows navigate rather than submit cross-origin forms, so this stays true
 *   when identity lands; if it ever does not, the violation is a blocked
 *   submission on the sign-in route and nowhere else.
 */
const ENFORCED_CSP = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

/**
 * The policy we intend to enforce, reported against until it can be.
 *
 * `'unsafe-inline'` appears here deliberately and is the reason this is
 * Report-Only: it is what the App Router currently needs, and shipping it as an
 * enforced policy would be a `script-src` that permits the injection it claims
 * to stop. Reports tell us what a nonce-based policy would have to allow.
 *
 * `connect-src` names the two schemes Convex uses (`https:` for the HTTP API,
 * `wss:` for the reactive socket) rather than a deployment URL, because the URL
 * is per-environment and a policy that is wrong in preview is a policy someone
 * turns off.
 */
const REPORTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  ENFORCED_CSP,
].join("; ");

/**
 * Browser features this application never uses.
 *
 * Scanning is HID — a rugged scanner presents as a keyboard (`INV-0010-08`), not
 * as a camera — so `camera=()` costs nothing today. It is listed rather than
 * omitted precisely because that could change: enabling camera-based scanning
 * would fail here, visibly, instead of quietly widening the permission surface.
 */
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

/**
 * One day, this host only.
 *
 * Deliberately the *ramp* value rather than the destination, and deliberately
 * without `includeSubDomains` or `preload`. HSTS is the one header here that a
 * mistake in cannot be taken back by deploying a fix: the browser holds the pin
 * for `max-age` whatever the server says afterwards, and clearing it means
 * walking a user through browser internals.
 *
 * The two directives that were here and are not any more are the expensive ones,
 * and neither is a claim this repository is in a position to make:
 *
 * - **`includeSubDomains`** pins *every* subdomain of the deployment, including
 *   ones this application does not own or know about — a status page, a legacy
 *   internal tool, a vendor-hosted subdomain, anything on plain HTTP. Any one of
 *   those becomes unreachable for the full `max-age`. It is safe only once
 *   somebody has enumerated the zone and confirmed every host serves HTTPS.
 * - **`preload`** is a request to be baked into browsers' shipped preload lists.
 *   Removal is a months-long process on someone else's release schedule, and the
 *   token is what scanners treat as consent to submit. It requires a two-year
 *   `max-age` *and* `includeSubDomains`, so it cannot be correct before the
 *   previous point is settled.
 *
 * There is no deployment yet — no domain, no certificate, no identity provider —
 * so asserting either would be asserting something nobody has checked. One day
 * is long enough to be a real downgrade defence and short enough that a
 * misconfiguration ages out of every client within a day.
 *
 * The ladder, when there is a domain to walk it on: raise `max-age` to 86400 →
 * 604800 → 31536000, confirming at each step that nothing broke; then, only
 * after auditing the zone, add `includeSubDomains`; then, only if the deployment
 * genuinely wants to be on the preload list forever, add `preload` and raise
 * `max-age` to 63072000.
 *
 * Only meaningful over HTTPS — a browser ignores it on a plain-HTTP origin — but
 * it is gated on the production build anyway rather than relying on that. A
 * developer who terminates TLS in front of `localhost` for one afternoon would
 * otherwise pin their own machine's `localhost`, and unpinning it means editing
 * browser internals.
 */
const HSTS = "max-age=86400";

/**
 * The headers for every route.
 *
 * `isProduction` is a parameter rather than a read of `process.env` so the test
 * can assert both branches without mutating the environment.
 */
export function securityHeaders(isProduction: boolean): ResponseHeader[] {
  return [
    /* Stops a browser from re-interpreting a JSON payload or an upload as HTML. */
    { key: "X-Content-Type-Options", value: "nosniff" },
    /*
     * A path in this application can name a tenant's document. Sending a full
     * URL to a third-party origin as a referrer would leak that; sending only
     * the origin, and only over an equally secure connection, does not.
     */
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    /* Superseded by `frame-ancestors`; kept for pre-CSP-Level-2 browsers. */
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Content-Security-Policy", value: ENFORCED_CSP },
    {
      key: "Content-Security-Policy-Report-Only",
      value: REPORTED_CSP,
    },
    ...(isProduction
      ? [{ key: "Strict-Transport-Security", value: HSTS }]
      : []),
  ];
}

/** Exported for the test, so the assertions name the same strings the app sends. */
export const SECURITY_POLICY = {
  ENFORCED_CSP,
  REPORTED_CSP,
  PERMISSIONS_POLICY,
  HSTS,
} as const;
