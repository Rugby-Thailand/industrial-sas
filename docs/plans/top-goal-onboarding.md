# Top Goal production onboarding plan

Status: plan only; no production records created. Proposed commands below are not implemented yet.

## Target

- Company/Clerk organization: `Top Goal`; requested slug: `top-goal`.
- Application: `https://app.thaipropertyai.com`.
- Clerk production and Convex production (`greedy-cardinal-537`).
- Default settings: Thai, Asia/Bangkok, THB, matching existing organization defaults.
- Source directory: `data/import-staging/warehouse-2026-09-21` relative to this repository.
- Required input: the initial administrator's existing production Clerk user ID, resolved from a confirmed email. Do not assume the privacy-contact email is the account owner.

## Proposed command interface

Implement a dedicated administrative CLI before running these commands:

```sh
pnpm company:onboard --environment production --name 'Top Goal' --slug top-goal --owner-email '<confirmed-owner-email>' --source data/import-staging/warehouse-2026-09-21 --dry-run
pnpm company:onboard --environment production --name 'Top Goal' --slug top-goal --owner-email '<confirmed-owner-email>' --source data/import-staging/warehouse-2026-09-21 --apply-account-only
```

The first command must be read-only. The second creates/reuses only the organization and authorized initial administrator membership. It must not import warehouse records. Resolve an existing Clerk user unambiguously; if none exists, require the administrator to sign up first. Do not create passwords or silently send invitations.

## Implementation and execution

1. Validate the selected Clerk instance and Convex deployment as production; never use local demo seed functions or enable local seeding in production. Keep credentials in environment variables and out of output/receipts.
2. Inspect existing organization slug/name and ownership. Reuse only a verified matching organization; ambiguous matches or conflicting ownership must stop. Persist Clerk organization/user IDs to make retries safe; on timeout, reconcile before retrying creation.
3. Create the organization with the confirmed existing user as initial administrator through Clerk's supported organization API. Follow the existing identity ownership design: allow signed Clerk webhook events to mirror identity and membership into Convex rather than hand-inserting identity records.
4. Verify organization and membership synchronization, application permissions, and tenant isolation. Record a receipt containing environment, organization IDs, owner user ID, and created/reused status. Do not equate Clerk membership with verified application privileges.
5. Verify that the administrator can select Top Goal and reach the application's setup flow. Record pending warehouse setup separately.

## Separate warehouse import phase

The staging package contains 823 baseline location codes, 69 proposed areas and 33 customer-name candidates. It is not a Convex import payload. All operational mappings remain blocked pending review.

- Confirm the operational before/after plan: the after plan has 846 distinct labels, 811 matching baseline codes, 12 missing baseline codes and 35 additional labels.
- Resolve physical buildings/floors, measured geometry, heights, rack indices and source conflicts. Do not infer five warehouses from the five prefixes.
- Implement a tenant-scoped, audited, retry-safe importer preserving source codes and reporting create/match/conflict/blocked outcomes before writes.
- Bind a reviewed copy of the mappings to Top Goal's actual organization and warehouse IDs; preserve the original source evidence.
- Keep customer candidates separate from tenant accounts. No customer master exists yet; sales figures are not inventory balances.
- Import no products, stock, pallets, ownership or occupancy without actual supporting records.

See [warehouse import plan](warehouse-data-import.md) and the staging README for detailed constraints. Do not run `convex import` against this package.

## Validation for the future CLI

Cover production-target mismatch, missing/ambiguous owner, existing organization conflict, retry after partial Clerk creation, webhook synchronization timeout, and account-only mode creating no warehouse or inventory records.
