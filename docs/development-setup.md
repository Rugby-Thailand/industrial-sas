# Development product setup

This runbook creates the usable development product. It does not configure or
deploy production. Development must use Clerk test credentials and either a local
or cloud **development** Convex deployment; never copy production keys here.

## What is already in the repository

- Clerk middleware is composed with locale routing.
- `ClerkProvider` wraps `ConvexProviderWithClerk` only when Clerk is configured.
- `convex/auth.config.ts` validates the normal Clerk session token with
  `applicationID: "convex"`; no custom JWT template is needed.
- Clerk v2 `o.id` is the active organization claim. The deprecated v1 `org_id`
  shape is accepted only as a migration fallback.
- `/[locale]/sign-in` mounts Clerk's sign-in component when configured and shows
  the setup checklist otherwise.

## 1. Create the Clerk development instance

In a Clerk **development** instance:

1. Enable Organizations and disable Personal Accounts. This product requires an
   active organization for every tenant-bound request.
2. Activate the Convex integration. Keep the default `aud=convex` mapping.
3. Use Clerk session-token version 2. Do not add an `org_id` custom claim; the
   application reads the built-in `o.id` claim.
4. Create a development organization and add the first development user to it.
5. Copy the test publishable key (`pk_test_...`), test secret key (`sk_test_...`),
   and Frontend API URL (`https://…clerk.accounts.dev`).

## 2. Fill the ignored local environment

Preserve the Convex values already written by `convex dev`, then add these values
to `.env.local`:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_REPLACE_ME
CLERK_SECRET_KEY=sk_test_REPLACE_ME
CLERK_JWT_ISSUER_DOMAIN=https://REPLACE_ME.clerk.accounts.dev
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/th/sign-in
NEXT_PUBLIC_LOCAL_PREVIEW=
CLERK_WEBHOOK_SIGNING_SECRET=whsec_REPLACE_AFTER_STEP_4
```

Do not add `CONVEX_DEPLOY_KEY` to a developer machine. Do not commit
`.env.local`. Check the local file without exposing values:

```sh
pnpm dev:check
```

## 3. Configure and sync the Convex development backend

Convex functions do not read `.env.local`, so set the issuer on the selected
development deployment and sync the auth config:

```sh
pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN \
  'https://REPLACE_ME.clerk.accounts.dev'
pnpm exec convex dev --once
```

Run `pnpm dev` to start Convex and Next.js together. `Ctrl+C` stops both.
Use `pnpm dev:web` or `pnpm dev:backend` only when debugging one side.

## 4. Configure the Clerk development webhook

The callback is the Convex HTTP origin plus `/webhooks/clerk`. For a local Convex
deployment, use a secure tunnel that preserves the raw request body; Clerk cannot
reach localhost directly. A shared cloud development deployment avoids that
tunnel.

Subscribe to only these event families:

- organization created, updated, and deleted;
- user created, updated, and deleted;
- organization membership created, updated, and deleted.

Copy the endpoint signing secret to both `.env.local` and the selected Convex
deployment:

```sh
pnpm exec convex env set CLERK_WEBHOOK_SIGNING_SECRET 'whsec_REPLACE_ME'
```

Send test events and require HTTP `204`. The mirror provisions safe tenant
defaults and code-owned permissions when the organization event arrives.

## 5. Development acceptance check

1. Run `pnpm dev:check`, then `pnpm guards`.
2. Start both development processes.
3. Open `http://localhost:3000/th/sign-in` and sign in with the development user.
4. Activate the development organization.
5. Confirm Convex auth is authenticated and the workspace resolves the mirrored
   organization without `ACTIVE_ORGANIZATION_MISSING` or `USER_UNKNOWN`.
6. Confirm `.env.local` contains no live (`pk_live_` / `sk_live_`) Clerk key and
   no `CONVEX_DEPLOY_KEY`.

Production setup is a separate operation with a separate Clerk production
instance, Convex production deployment, domain, webhook endpoint, secrets, and
release-gate evidence. Do not promote or reuse this development instance.
