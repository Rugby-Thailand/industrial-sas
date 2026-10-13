# Final backend audit fixes

The independent audit used integration checkpoint `3d54d70d` in a detached local worktree. No production data or integration workspace was changed. Three regressions reproduced before changes:

- A successful zone archive retried after the building was archived returned `LAYOUT_NOT_EDITABLE` instead of its committed answer.
- A successful exact-position creation retried after a label-only parent edit returned `REQUEST_ARGUMENT_CONFLICT`: its leaf receipt included the current parent document rather than the original command intent.
- A valid one-floor layout with 321 non-overlapping rack areas and 100 valid slots each returned `ready:true` in convex-test while reading 32,431 documents. Production failure is inferred from the [official Convex transaction limits](https://docs.convex.dev/production/state/limits): 32,000 scanned documents, 4,096 index ranges, and 16,000 writes per transaction. Convex-test does not enforce those production limits.

## Implementation

Zone archival now resolves its existing full-argument receipt before mutable lifecycle and occupancy checks. The tenant authorization wrapper still runs first.

Exact-position creation records an additional full-command receipt keyed by the submitted arguments and resolves it before reading the mutable parent. Older per-row receipts remain unchanged: an unchanged legacy retry still works and gains the command receipt. Receipt verification uses the existing tenant-scoped master-data replay helper. A changed payload under the same command request refuses before writes.

Readiness and lifecycle support at most **1,800 active area records plus active leaf records together** in one building. This conservative cap reserves headroom for authorization, up to 50 floors and 100 reserved blocks per floor, per-area leaf index reads, and ownership reads when updating location status. It does not mean 1,800 slots. The assessment bounds aggregate area and leaf reads and reports blocking `LAYOUT_CAPACITY_LIMIT` when it cannot prove the entire layout fits that budget. Lifecycle mutations refuse an incomplete assessment before any building or address write. Leaf rows read by preflight are reused during lifecycle changes rather than queried again.

Lifecycle impact uses the same bounded assessment. `complete:false` identifies partial lower-bound counts, `capacityExceeded:true` identifies the unsupported aggregate case, and `canArchive:false` prevents a confirmation from promising the blocked action. Named-registration count completeness remains independently available. Larger buildings need a separate bounded readiness/lifecycle design before these whole-building operations can support them. This release deliberately refuses them safely. Top-floor removal does not use readiness and remains independent of this cap.

## Frontend integration

The follow-up frontend commit adds `layoutActions.error.LAYOUT_CAPACITY_LIMIT` in both locales and renders it for readiness issues and refused mutations. Archive and status confirmations honor `capacityExceeded`/`canArchive` and identify `complete:false` or incomplete named-registration counts as minimum counts. Existing foreground and navigation ownership remain unchanged.

English: “This building has more storage areas and positions than can be checked safely at once. Keep the current layout and contact an administrator to review or split the building before changing its status.”

Thai: “อาคารนี้มีพื้นที่และตำแหน่งจัดเก็บมากเกินกว่าจะตรวจสอบอย่างปลอดภัยในครั้งเดียว กรุณาเก็บผังปัจจุบันไว้ และติดต่อผู้ดูแลให้ตรวจสอบหรือแบ่งอาคารก่อนเปลี่ยนสถานะ”

## Validation

The storage action suite has 29 passing cases, including exact retry after later parent/lifecycle changes, changed command identity refusal, an unchanged legacy receipt replay, and caller-level aggregate boundary tests. At 1,800 area-plus-leaf records, activation succeeds within the documented document, index-range and write budgets; at 1,801, readiness, lifecycle impact, activation and archive report capacity limits without partial status writes. The large original 32,431-read reproduction was temporary; the committed boundary fixtures use 1,800/1,801 records and run in seconds.

The nine scoped action/layout/occupancy/catalogue/job-ticket/isolation/model suites pass (123 tests, including the final impact assertions). Scoped normal ESLint, TypeScript 6, and diff whitespace checks pass. These are local convex-test checks, not production writes or deployment verification.

Frontend validation: both changed caller suites pass (84 tests), including bilingual archive capacity refusal, disabled archive and status confirmations, lower-bound labels, the readiness issue, and actual server-refusal recovery text. TypeScript 6 and whitespace checks pass. Normal ESLint passes on the status toggle, DTO and both test files. Screens ESLint reports eight navigation-audit errors in the untouched `FloorForm`; the same eight reproduce against checkpoint `b13c980e`, so the integration inventory owner must reconcile those final foreground targets before merge. The one Impeccable detector pass reports no warnings. These are component-level DOM checks; no live browser screenshot or production write was performed.
