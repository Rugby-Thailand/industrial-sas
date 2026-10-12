# Operations audit — initial evidence

Date: October 13, 2026. Auditor: independent GPT-6.1-Sol operations review.

**Final-diff review pending.** Kiro was still writing during this audit. These findings concern the initial `boundedRecordPage` implementation and its `listJobScans` integration; unfinished callers and other operations surfaces have not been assessed as final defects.

Reviewed worktree: `/Users/macbook/Development/industrial-sas-filter-operations`. Baseline: `11c8c2cc`. No product files were edited. The helper was untracked when inspected, so a tracked-only `git diff` did not include it.

## Concrete compatibility finding

The initial helper returns partial matches in `scanning.items`, copies `scanCursor` into `continueCursor`, and retains those matches in cursor `ids`. A client without scan-continuation handling can display the partial rows, press Next with `continueCursor`, and receive the same accumulated rows again on the next displayed page.

Initial source locations: `convex/finishedGoods/boundedRecordPage.ts:38` claims compatibility with clients without scan-continuation support; lines 173–174 reload retained accepted IDs; lines 214–228 return those IDs and expose the scan cursor as the ordinary continuation cursor. `convex/finishedGoods/jobScans.ts` delegates `listJobScans` to this helper. Line numbers may change as Kiro finishes.

Reproduction with 150 records, matches every 20 records, and page size 20:

1. First request returns `status: "scanning"`, `items: ["0", "20", "40", "60", "80"]` and `isDone: false`.
2. A legacy client sends that `continueCursor` as its next ordinary page cursor.
3. The second request returns `status: "ready"`, `items: ["0", "20", "40", "60", "80", "100", "120", "140"]` and `isDone: true`.

The first five displayed rows repeat. A caller that correctly treats scan continuation as progression within the same page can avoid this, so final assessment must include the completed UI and any backend/frontend rollout compatibility strategy. This is a concrete protocol compatibility concern, not an authorization bypass.

## Malformed-state hardening

The initial helper encodes plain JSON and checks `scope` by equality. It validates array lengths and string lengths but does not reject duplicate retained IDs. A caller can copy a genuine scope and rewrite the state to `ids: []`, `tail: ["140", "140"]`, `exhausted: true`; the probe returned `ready`, duplicated rows, and `isDone: true` without another native read.

This demonstrates caller-controlled navigation corruption. It does **not** demonstrate a tenant or warehouse leak. Existing catalogue pagination also uses scoped JSON with live ID revalidation; the aggregate-summary HMAC helper requires a provisioned key and is not an automatic drop-in requirement for these lists. Straightforward acceptance checks include rejecting duplicate IDs, invalid IDs, malformed ranges, and invalid state transitions. Do not describe these unsigned cursors as authenticated.

## Authorization and traversal observations

No tenant or warehouse scope leak was found in the initial `listJobScans` integration. Native reads use tenant-scoped warehouse indexes. Retained documents are re-read through `tenantDb.get`, then checked against the requested warehouse, mapped filter, and current text. Parent labels are also tenant-read and warehouse-checked before display.

An additional in-memory traversal probe passed **240 cases**, with page sizes 1/20/50/100, filtered and unfiltered reads, and datasets from 50 to 1,245 records. It performed **27,356 helper requests**, including **4,404 recursively simulated `SplitRequired` transitions**, and compared all completed pages against the expected ordered matching IDs. It found no natural duplicate or lost row in those simulated cases.

These are **in-memory probes of the actual helper source**, loaded through TypeScript transpilation with synthetic `get`, `read`, and `hydrate` functions. They are **not actual Convex handler/database measurements**, native database split tests, production observations, or latency/scaling benchmarks. They verify helper control flow under the stated mock contract only. Bun was unavailable in the shell, so the probes used Node 24.19.0 and the installed TypeScript compiler. No files were written by the probes.

## Reproduction command

Run from `/Users/macbook/Development/industrial-sas-filter-operations` against the initial helper. This command transpiles source in memory and prints both the legacy-continuation and duplicate-state results.

```sh
node <<'NODE'
const fs = require('node:fs');
const ts = require('typescript');
const load = (file, dependencies = {}) => {
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', out)(
    key => dependencies[key] ?? require(key),
    exports,
  );
  return exports;
};
const cat = load('convex/lib/cataloguePagination.ts');
const { boundedRecordPage } = load(
  'convex/finishedGoods/boundedRecordPage.ts',
  { '../lib/cataloguePagination': cat },
);
(async () => {
  const ctx = {
    tenant: { organization: { _id: 'o' }, actor: { _id: 'a' } },
  };
  const rows = Array.from({ length: 150 }, (_, i) => ({
    _id: String(i), orgId: 'o', match: i % 20 === 0,
  }));
  let reads = 0;
  const opts = {
    scope: ['test'],
    pageSize: 20,
    filtering: true,
    get: async id => rows.find(row => row._id === id) ?? null,
    accept: row => row.match,
    hydrate: async records => records.map(row => row._id),
    read: async (range, limit) => {
      reads++;
      const start = Number(range.raw ?? 0);
      const page = rows.slice(start, start + limit);
      return {
        page,
        isDone: start + limit >= rows.length,
        continueCursor: String(start + page.length),
      };
    },
  };
  const first = await boundedRecordPage(ctx, opts);
  const second = await boundedRecordPage(ctx, {
    ...opts, cursor: first.continueCursor,
  });
  const state = JSON.parse(first.continueCursor);
  const forged = await boundedRecordPage(ctx, {
    ...opts,
    cursor: JSON.stringify({
      ...state, ids: [], tail: ['140', '140'], exhausted: true,
    }),
  });
  console.log(JSON.stringify({ first, second, reads, forged }));
})();
NODE
```

## Acceptance checks for the completed implementation

- Legacy-client traversal must avoid repeated displayed rows, or the rollout must explicitly address the changed scan-continuation protocol.
- Completed callers must continue `scanning` within the same logical page, retain truthful progress, handle reset/failure without silent loops, and prevent obsolete criteria responses from displaying.
- Reject malformed/duplicate retained IDs; test criteria, actor, warehouse, and page-size changes, plus deleted rows and mapped-status changes during continuation.
- Test complete ordered traversal at native chunk boundaries, sparse late matches, zero matches, equal timestamps, and datasets beyond the former 10,000-record cap.
- Exercise actual native `SplitRequired` recovery and nested splits through the handler/database harness, with at most one native pagination call per request.
- Verify text matching normalization and every searchable displayed field, visible-row mutation selection, and export preservation.
- Final operations review must cover workflow movement history, stack/destination behavior, finished-goods catalogue, and AI usage as well as the completed saved-scans callers.
