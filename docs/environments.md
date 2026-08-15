# Environment contracts

What each environment class is, what it must have, what it must not have, and how
that is checked. Derived from [`ADR-0012`](./adr/0012-delivery-release-and-quality-gates.md)
§2 and plan §10 Phase 1 ("Developer, preview, staging, and production environment
design").

**Implementation status: development wiring plus contract and validators.** The
Clerk/Convex provider path and a local Convex deployment exist, but no Clerk
development instance is connected yet. `pnpm dev:check` checks the complete
development product from the ignored `.env.local`; `pnpm verify:environment`
checks the cross-environment contract. **No preview, staging, or production
environment exists.**

## The four classes

| Class        | What it is                               | Who creates it             |
| ------------ | ---------------------------------------- | -------------------------- |
| `developer`  | One engineer's machine                   | The engineer               |
| `preview`    | One pull request's ephemeral deployment  | CI, per PR                 |
| `staging`    | The persistent pre-production deployment | Once, by an operator       |
| `production` | The tenant-facing deployment             | Once, behind release gates |

`ADR-0012` §2 requires **separate identity instances, Convex deployments,
file-storage apps, and telemetry projects** per class. That is not a preference:
a preview deployment pointed at production's Convex URL would let an unreviewed
branch read and write a tenant's stock.

## The variable contract

Each row says what a class requires, forbids, and merely recommends. The
authoritative copy is `VARIABLE_CONTRACTS` in
[`src/lib/environmentContract.ts`](../src/lib/environmentContract.ts); this table
is the readable form of it.

| Variable                            | Required in      | Forbidden in                 | Why                                                                            |
| ----------------------------------- | ---------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_CONVEX_URL`            | deployed classes | —                            | Without it a deployed environment serves setup gates to real users             |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | deployed classes | —                            | Without an identity provider every tenant-bound function denies                |
| `CLERK_SECRET_KEY`                  | deployed classes | —                            | Server-side Clerk access; secret                                               |
| `CLERK_WEBHOOK_SIGNING_SECRET`      | deployed classes | —                            | The webhook verifies its signature before any state change (`INV-0001-04`)     |
| `CLERK_JWT_ISSUER_DOMAIN`           | deployed classes | —                            | Convex validates Clerk tokens against this issuer                              |
| `NEXT_PUBLIC_APP_URL`               | deployed classes | —                            | Webhook callbacks and absolute links                                           |
| `CONVEX_DEPLOYMENT`                 | —                | preview, staging, production | Written by `convex dev`; in a build it is a laptop's deployment leaking        |
| `CONVEX_DEPLOY_KEY`                 | —                | developer                    | A deploy credential belongs to CI, not a laptop                                |
| `NEXT_PUBLIC_LOCAL_PREVIEW`         | —                | staging, production          | Synthetic rows must never reach an environment a person could mistake for real |
| `NEXT_PUBLIC_OBSERVABILITY_SINK`    | —                | —                            | Selects the `ObservabilityPort` adapter; unset means the no-op                 |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`     | —                | —                            | Where Clerk sends an unauthenticated visitor                                   |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`     | —                | —                            | Tenants are sales-provisioned (B-02), so usually absent by design              |
| `UPLOADTHING_TOKEN`                 | —                | —                            | File storage is unwired; each class needs its own app when it lands (D-20)     |

"Deployed classes" is `preview`, `staging`, and `production`.

### Values that must differ between classes

`CLASS_SCOPED_VARIABLES` names the variables whose _values_ must not be shared:
the Convex URL, both Clerk keys, the webhook secret, and the app URL.
`crossClassFindings` compares two environments and reports a shared value by
**variable name only** — it never prints what it found.

## Running the guard

```sh
pnpm verify:environment                     # contract vs .env.example; runs in CI
node scripts/verify-environment.mjs --class=developer   # also check this machine
node scripts/verify-environment.mjs --class=production  # check a deploy step's env
```

The no-argument form is part of `pnpm guards` and is credential-free by
construction: it reads the tracked template and the contract source, never a real
environment. The `--class` form is for a developer or a deployment step.

Two things it fails on that are easy to get wrong:

1. **A value in `.env.example`.** The template is tracked; a filled one is a
   committed secret (`INV-0012-05`). Even a "harmless" default fails.
2. **A `NEXT_PUBLIC_*` name in the template with no contract entry.** A public
   variable is inlined into the browser bundle, so whether it may be absent is a
   decision that needs a rule rather than a comment.

## What is not yet enforced

- **Nothing checks a deployment's actual configuration**, because there is no
  deployment. The `--class` form checks whatever machine runs it.
- **Cross-class comparison is a function, not a job.** `crossClassFindings` is
  implemented and tested; wiring it into a release step needs two real
  environments to compare.
- **Convex-side environment variables** (`CLERK_JWT_ISSUER_DOMAIN` must also be
  set on the Convex deployment, not only in Next.js) are named here and checked
  nowhere: reading them needs the Convex CLI and a deployment.

## External prerequisites

Every one of these is outside this repository and blocks the corresponding class:

| Prerequisite                                                      | Blocks                        | Gate               |
| ----------------------------------------------------------------- | ----------------------------- | ------------------ |
| A Clerk application per class, with its Convex integration active | preview, staging, production  | `RG-011`           |
| A Convex project and deployment per class                         | preview, staging, production  | `RG-002`           |
| A decision on the Convex region (US East / EU West)               | production                    | `RG-002`           |
| An UploadThing app with private ACLs per class                    | file features (unbuilt)       | `RG-014`           |
| A telemetry project and an approved subprocessor                  | non-`none` observability sink | `RG-014`           |
| Thai counsel sign-off                                             | production                    | `RG-006`, `RG-048` |

## Related

- [Development product setup](./development-setup.md)
- [ADR-0012 — Delivery, release, and quality gates](./adr/0012-delivery-release-and-quality-gates.md)
- [ADR-0001 — Multi-tenant SaaS and identity ownership](./adr/0001-multi-tenant-saas-and-identity-ownership.md)
- [Observability and SLIs](./manuals/observability-and-slis.md)
- [Release gate register](./release-gates.md)
