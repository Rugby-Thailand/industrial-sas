# Clerk CI staging setup — 2026-10-09

This evidence records setup and rehearsal of development resources only. No
production Clerk settings, production Convex deployment or existing
user/organization records were changed.

## Verified development instance

- Clerk frontend/issuer host: `creative-doberman-56.clerk.accounts.dev`.
- Instance ID: `ins_3Hx3Wa0m4xgQsBZ7Kyod5wNP1AC`.
- Backend `instance.get()` verified `environmentType: development`.
- Credentials were asserted to be Clerk `sk_test_`/`pk_test_` credentials with the
  expected frontend host before API use. Their values are not recorded here.
- Organizations are enabled; organization slugs are disabled. CI creates
  organizations without a slug and verifies exact names, IDs and ownership
  metadata. Ambiguous or partial-name recovery results are refused.
- The creator role is `org:admin`, with five members
  permitted per organization in the current development configuration.
- The existing `convex` JWT template has `aud: convex` and an `org_id` claim.
  No JWT template or instance settings were changed.

## Dedicated webhook

- Svix application: `app_3Hx8zk0GRjVf9T9GmyhjVJD8lrH`, region `eu`.
- New endpoint: `ep_3KSqwUfTVQF6k0r25iyMFigATRg`.
- Endpoint UID: `industrial-sas-ci-staging-clerk`.
- Destination: `https://befitting-stoat-208.convex.site/webhooks/clerk`.
- The endpoint was enabled only after the reviewed staging app/backend revision
  `1b0e68d1bdd4f2f867fbe3401e7d6cee600452a3` deployed successfully. No
  production or pre-existing endpoint was modified.
- Subscribed event types: `organization.created`, `organization.updated`,
  `organization.deleted`, `organizationMembership.created`,
  `organizationMembership.updated`, `organizationMembership.deleted`,
  `user.created`, `user.updated`, and `user.deleted`.
- The pre-existing disabled endpoint targeting
  `https://next-gull-223.convex.site/webhooks/clerk` was read back after provisioning
  and its full configuration was unchanged. No unrelated endpoint was modified.

The signing secret was sent directly through subprocess stdin to the explicitly
selected Convex deployment `trustera:industrial-sas:preview/ci-staging`
(`befitting-stoat-208`). Private readbacks matched the supplied values for both
`CLERK_WEBHOOK_SIGNING_SECRET` and
`CLERK_JWT_ISSUER_DOMAIN=https://creative-doberman-56.clerk.accounts.dev`.
Neither secret values nor Clerk/Svix access URLs were printed or written to
tracked files.

## Readiness and remaining verification

The issuer, signing credential and dedicated enabled webhook are configured; the
reviewed staging application/backend is deployed at the stable staging alias.
A live rehearsal caught the existing disabled-slug setting. The fixture was
adapted to that setting with 38 focused checks passing, including bounded
ownership reconciliation. Failed provisioning attempts cleaned up their owned
synthetic users. The complete authenticated browser rehearsal is recorded
separately in the platform evidence after execution.

The selected development instance is shared with local development: the endpoint
subscribes to matching development events, including events outside the CI
identity namespace. Cleanup may delete only the exact per-run owned resources;
it does not delete or reset unrelated users or organizations. CI testing setup
uses explicit keys and `dotenv:false` so ambient environment files cannot alter
the trusted inputs.

Keep local seed/login loopback restrictions intact. Development keys and this
webhook secret must never be assigned to Production. Clerk instance credentials
for trusted CI belong in a restricted GitHub staging environment and in the
verified Vercel staging/preview scope where required. The webhook signing secret
is already installed in Convex; CI needs it only if a specific provisioning or
delivery-verification step requires that credential.

## References

- [Clerk backend Instance object](https://clerk.com/docs/reference/backend/types/backend-instance)
- [Clerk environments](https://clerk.com/docs/guides/development/managing-environments)
- [Clerk webhook overview](https://clerk.com/docs/guides/development/webhooks/overview)
- [Svix consumer app portal](https://docs.svix.com/app-portal)
- Installed SDKs used for scoped setup: `@clerk/backend` 3.16.4 and `svix` 1.99.1.
