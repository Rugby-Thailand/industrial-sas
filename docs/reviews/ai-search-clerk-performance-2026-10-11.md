# AI Search Clerk authentication performance — October 11, 2026

Browser token reuse removes a Clerk Backend API token-generation call from the
normal AI Search request. In five interleaved warm samples per path, route
authentication median fell from **308.83 ms to 2.44 ms**. Total HTTP median for
the benchmark fell from **374.70 ms to 130.80 ms**. These are local development
measurements with real Clerk and a loopback Convex backend. They measure a
token-flow change; they do not establish an Elysia-versus-Next framework speedup,
a Bun runtime speedup, or production AI latency.

Delivery status (T00): the implementation, benchmark scripts and tests named
below are an uncommitted pilot in the primary workspace. They are not on
`main`; T02 of the [delivery plan](../plans/bun-elysia-delivery-plan-2026-10-11.md)
transfers them by an explicit scoped patch.

## Implemented path

`useAiSearch` asks Clerk for the session token and Convex template JWT in parallel,
using the captured active organization and the SDK's existing cache. The Eden
client sends the session token in `Authorization` and the template JWT in
`x-convex-token`. A template JWT has no session ID, so it is not used as the
Clerk session bearer token. Requests still work when the session cookie is absent.

Clerk middleware authenticates the session. The route uses the Clerk Backend SDK
to verify the template JWT and compares its issuer, subject and organization to
the authenticated session. It requires the Convex audience and the request's
origin, follows Convex's v2 organization-claim precedence, and refuses malformed,
expired or mismatched tokens. A submitted invalid token never falls back to
generating another token. Cookie-only callers retain the prior token-generation
path for compatibility. Convex still performs its normal tenant, membership,
permission and durable quota checks.

Changing the Clerk user/organization invalidates pending results immediately,
including while token acquisition is pending. Closing the dialog also discards
pending acquisition before making the HTTP request.

The SDK caches JWKS. `CLERK_JWT_KEY` optionally supplies the PEM public key for
verification without an initial key-fetch request; the local measurements used
cached JWKS and did not add that environment value. A pinned public key requires
configuration updates when the issuer rotates its signing key. Cold token
refresh and initial key fetching still cost network time.

## Method and results

Run `scripts/ai-search-auth-benchmark.mjs` in the console of a signed-in local app.
Both paths use a valid Clerk session bearer token and the same request/body.
The baseline omits the Convex-token header, causing the route to generate it.
The candidate sends the cached template JWT. Six pairs run sequentially; the
first pair is a warmup excluded from medians. Tokens are never printed or saved.

The whitespace query passes HTTP validation and reaches the ordinary Convex
authorization/quota preflight. The action returns `QUERY_INVALID` before calling
OpenRouter, so no model requests run during the comparison. Normal preflight
audit/quota behavior still applies.

| Warm median (5 samples per path) | Server-generated token | Browser token reuse |
| -------------------------------- | ---------------------: | ------------------: |
| Browser token acquisition        |                0.50 ms |             0.50 ms |
| Route authentication             |              308.83 ms |             2.44 ms |
| Convex HTTP/action call          |               44.87 ms |           112.20 ms |
| Total browser HTTP duration      |              374.70 ms |           130.80 ms |

`auth` starts inside Elysia after Clerk proxy handling; total HTTP includes that
proxy and network overhead. Convex durations varied materially between paths,
so total medians must not be attributed entirely to the authentication change.
This is five local samples on a development server, without controlled CPU load
or a production concurrency test. Cold starts are excluded. Raw rows are in
[auth-comparison.json](assets/ai-search-clerk-2026-10-11/auth-comparison.json).

An earlier cookie-only client experiment returned one authentication denial
during refresh. The final client sends a current session bearer token alongside
the template JWT. A real request with browser cookies omitted returned the
expected authenticated Convex result, confirming that path works independently
of cookie freshness.

## End-to-end and correctness verification

- A real AI Search UI request sent both headers and returned HTTP 200 with
  `HR_SETTINGS_SECTION`; the dialog closed at the holidays destination.
  That request reported `auth=3.37 ms`, `convex=3393.64 ms` and HTTP duration
  `3444.50 ms`. This single sample includes OpenRouter and is not a before/after
  model-latency comparison.
- Six focused files passed **120 tests**, including actual RSA-signed JWT
  verification with the Clerk SDK. Coverage includes signature tampering,
  expiry, future activation, wrong/missing audience, issuer, origin, user or
  organization, malformed v2 claims, and missing active sessions.
- UI tests cover missing tokens, organization-bound acquisition, cancellation
  during acquisition and immediate Clerk organization changes.
- The production Next build passed with build type checking enabled. Scoped
  formatting, lint and diff checks accompany this change.

## Primary references

- [Clerk session token caching](https://clerk.com/docs/nextjs/reference/objects/session#gettoken).
- [Clerk template JWT verification](https://clerk.com/docs/reference/backend/verify-token).
- [Clerk request authentication and networkless verification](https://clerk.com/docs/reference/backend/authenticate-request#networkless-token-verification).

The next migration plan should retain these measurements as authentication
evidence and measure Bun/Node runtime changes separately with the same handler,
bundler, authentication and provider workload.
