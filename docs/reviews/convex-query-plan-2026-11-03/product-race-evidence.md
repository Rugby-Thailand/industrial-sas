# Product requirement edit acceptance — 2026-11-03

Worktree base: `8cf8be98`. The production product/status index and existence
checks were already present on `main`; this task did not change that writer.

## Actual backend race

Run from the repository root:

```sh
node scripts/performance/product-requirement-race.mjs
```

The script downloads the SHA-256-verified backend used by the credential-free
codegen guard (`precompiled-2026-10-06-a3538c6`), creates its own loopback-only
backend and private local key, and copies the current Convex source into a
temporary project. Its environment contains only PATH, an isolated HOME, and CI.
It does not load the repository's environment files or deployment configuration.
The test fixture is copied into that temporary deployment only. The process and
all generated database/key files are removed in `finally`.

The fixture provisions a synthetic organization, actor, authorization grants,
and a separate DRY storage zone per round. Product creation, pallet creation,
measurement, requirement editing and reservation use the actual public Convex
mutations. An administrator-supplied synthetic identity exercises the tenant and
authorization wrappers; this is not an external identity-provider acceptance test.

Each round submits `saveProduct` changing DRY to COLD and `reserve` concurrently
through two independent HTTP clients. Separate clients avoid the SDK's
same-client mutation queue. Invocation order alternates. Both mutations are
awaited before inspecting committed database state.

Observed on 2026-11-03:

```json
{
  "status": "passed",
  "rounds": 24,
  "wins": { "edit": 13, "reserve": 11 },
  "incompatibleCommittedPairs": 0
}
```

Exactly one mutation committed in every round. When the edit won, reservation
returned `STORAGE_CONDITION_MISMATCH`, the product was COLD and the pallet stayed
AWAITING_PLACEMENT. When reservation won, editing returned `LOCATION_OCCUPIED`,
the product stayed DRY and the pallet was RESERVED. Both serialization orders
occurred. This is real local backend concurrency evidence; backend retry rates,
which conflict dependency caused retries, and production throughput were not
measured.

## Indexed-read and scope coverage

`tests/integration/finished-goods.integration.test.ts` retains the 10,001
unrelated-pallet regression and now runs it with transaction limits enabled,
seeding in batches of at most 200. The actual writer reads exactly two pallet
index ranges and zero pallet documents for the requested product. Existing
RESERVED/STORED tests cover occupied refusal, normalized equivalent text,
descriptive edits, and reopening condition edits after reservation cancellation.
The authorization test additionally calls the condition writer with a foreign
tenant warehouse, mismatched same-tenant warehouse, and foreign product ID.

The historical `Promise.all` convex-test race remains useful as a regression but
was not treated as proof of real backend OCC. The local backend run above closes
that separate acceptance item.
