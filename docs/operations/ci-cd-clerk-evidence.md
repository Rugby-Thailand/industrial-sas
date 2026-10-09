# Clerk CI staging setup — 2026-10-09

This evidence records setup of development resources only. No production Clerk
settings, production Convex deployment, existing user/organization records, or
application code were changed.

## Verified development instance

- Clerk frontend/issuer host: `creative-doberman-56.clerk.accounts.dev`.
- Instance ID: `ins_3Hx3Wa0m4xgQsBZ7Kyod5wNP1AC`.
- Backend `instance.get()` verified `environmentType: development`.
- Credentials were asserted to be Clerk `sk_test_`/`pk_test_` credentials with the
  expected frontend host before API use. Their values are not recorded here.
- Organizations are enabled. The creator role is `org:admin`, with five members
  permitted per organization in the current development configuration.
- The existing `convex` JWT template has `aud: convex` and an `org_id` claim.
  No JWT template or instance settings were changed.

## Dedicated webhook

- Svix application: `app_3Hx8zk0GRjVf9T9GmyhjVJD8lrH`, region `eu`.
- New endpoint: `ep_3KSqwUfTVQF6k0r25iyMFigATRg`.
- Endpoint UID: `industrial-sas-ci-staging-clerk`.
- Destination: `https://befitting-stoat-208.convex.site/webhooks/clerk`.
- The endpoint is **disabled** until the first reviewed staging backend deployment
  installs the webhook handler. No webhook examples or messages were sent.
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

The issuer and webhook credential are configured. The new endpoint is prepared,
but webhook delivery and authenticated browser smoke are **not yet verified**:
the staging backend has no application deployment in this setup step.

Before enabling this endpoint, deploy the reviewed application to staging and
verify its HTTP handler and issuer configuration. Enable only this endpoint and
exercise it using namespaced synthetic CI identities. Verify delivery, signature
validation, identity mirroring, organization membership, and a `convex` JWT
before declaring authenticated staging smoke ready. The selected development
instance is shared with local development: enabling this endpoint subscribes to
its matching development events, not only the CI identity namespace.

At this setup checkpoint, emerging checked-in E2E specifications exercised
signed-out routes and no authenticated smoke identity contract was present.
No users, organizations, invitations, or sign-in tokens were created by this
setup step. Dedicated synthetic identities should be created only for the
settled smoke fixture contract; real account inventories are unnecessary.

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
