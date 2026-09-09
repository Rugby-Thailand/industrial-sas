# Development setup

This worktree runs a Next.js app against an isolated local Convex database, using the existing Clerk development instance for identity. It must not replace the original application's cloud backend or webhook.

## Existing configured worktree

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Use Node.js 24 and pnpm 10.33.2. Open http://localhost:3100, sign in, select the intended organization and warehouse, then open Buildings and storage locations or Finished goods. Local Convex uses port 3320; its HTTP actions use 3321.

`pnpm dev` starts the Convex development process and Next.js with Webpack. It rejects a `CONVEX_DEPLOYMENT` that is not prefixed `local:` or `anonymous:`. Ctrl+C or either child exiting shuts down both children. `PORT=3101 pnpm dev` changes the web port only; update the app URL/configuration when using another origin.

Development Webpack ignores generated `artifacts/`, `.cache/`, and `docs/plans/` files while retaining source hot reload. This prevents screenshots and recording frames from triggering repeated client rebuilds. See the [refresh investigation](plans/finished-goods-flow-2026-09-05/dev-refresh-investigation.md).

The local database persists across server restarts. This worktree's initial data copied planner layouts, identities, workspace membership, and authorization records; it did not import original orders or stock placements. Credentials, local database files, and the import archive are ignored by Git.

## Fresh checkout

1. Copy `.env.example` to `.env.local`. Supply the Clerk development publishable key, server secret, and issuer domain through your approved local credential source. Do not commit them.
2. Start a separate local Convex deployment, letting the CLI configure the local deployment and public backend URLs:

   ```sh
   CONVEX_AGENT_MODE=anonymous pnpm exec convex dev --local-cloud-port 3320 --local-site-port 3321
   ```

3. Verify `.env.local` identifies this local deployment and its public Convex URL uses port 3320. Set `CLERK_JWT_ISSUER_DOMAIN` on that local Convex deployment with `pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN <issuer-domain>`. The Next.js environment alone does not configure backend authentication.
4. Enable Clerk's Convex integration and organizations. Preserve `applicationID: "convex"` in `convex/auth.config.ts`.
5. Provision the intended local organization, warehouse, mirrored identity/membership, and role assignment through the existing trusted development setup. A fresh database does not automatically grant warehouse access to a new sign-in. Do not bypass authorization to make an empty environment appear ready.
6. Stop the one-time Convex setup process before running `pnpm dev`, so only one process owns the local backend ports.

The signed Clerk webhook endpoint is `/webhooks/clerk` on the Convex HTTP service. For ongoing local identity or organization changes, configure a separate development webhook through a local tunnel and set `CLERK_WEBHOOK_SIGNING_SECRET` on the local deployment. Keep the original app's webhook unchanged. Existing copied accounts can work without a new webhook, but new membership changes need mirroring before workspace access can resolve.

## Authorization

Both planner and finished-goods queries require `masterData.storageLayout.read`; mutations require `masterData.storageLayout.manage`. These are the extracted application's existing permissions, resolved from active organization/warehouse role assignments. Read-only users can inspect products, pallets, and layouts; mutation controls are hidden or disabled. Backend checks remain authoritative, including direct URLs and manually issued requests.

Local recovery drafts are scoped to the signed-in Clerk user, warehouse, and record. Saved products, measurements, reservations, and verification live on the backend. Changing accounts does not recover another user's local form draft, and only the operator who verified a destination can confirm that pallet stored.

## Commands

| Command                             | Purpose                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm dev`                          | Start the isolated backend and web app on port 3100                                 |
| `PORT=3101 pnpm dev`                | Use an alternate web port                                                           |
| `pnpm dev:web`                      | Web app only, fixed port 3100; backend must already run                             |
| `pnpm dev:backend`                  | Convex only; verify local environment first                                         |
| `pnpm codegen`                      | Refresh Convex generated API types for the configured deployment                    |
| `pnpm typecheck`                    | TypeScript validation                                                               |
| `pnpm lint`                         | ESLint with no warnings                                                             |
| `pnpm test`                         | All Vitest projects: unit, accessibility, property, runtime, integration, isolation |
| `pnpm test:unit` / `pnpm test:a11y` | Focused UI/model or accessibility suites                                            |
| `pnpm check`                        | Typecheck, lint, and tests                                                          |
| `pnpm build`                        | Production Next.js build                                                            |
| `pnpm start`                        | Serve that build on port 3100; backend remains separately required                  |

`dev:backend` and `codegen` call Convex directly and do not include the combined runner's deployment-prefix guard. Inspect the local environment before using those commands. There is no deployment step in this development workflow.

## Useful checks

- No workspace: verify the selected Clerk organization, mirrored membership, local warehouse, and active role assignment. Sign-in alone is not authorization.
- No recommendation: activate a valid building and location, configure usable geometry/supports, and inspect the specific no-fit reasons. Existing reservations count as occupied space.
- Refresh after reserving: reopen the pallet detail; the hold persists. Refresh after verification retains confirmation eligibility only for the same operator.
- Camera unavailable: use the explicitly labeled manual destination-code method. Camera access starts only on the scanner's Start camera action; real physical camera/QR hardware was not verified in this development run.
- A capacity-read limit error is a deliberate refusal to use incomplete occupancy data. Do not weaken it by truncating results.

See the [current user flow](plans/finished-goods-flow-2026-09-05/flow.md), [implementation notes](plans/finished-goods-flow-2026-09-05/implementation-notes.md), and [QA matrix](plans/finished-goods-flow-2026-09-05/qa-matrix.md) for behavior and evidence.
