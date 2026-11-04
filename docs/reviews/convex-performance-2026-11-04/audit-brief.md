# Independent Convex performance audit — brief

You are one of two independent auditors (the other is a different model family; you will not see each other's work). Audit the **Convex backend and database performance** of this repository and score it.

## Scope and rules

- Code under audit: the directory given in the task message (a Next.js + Convex app; `convex/` is the backend, `src/` the client). Read `AGENTS.md` first.
- Read-only. Do not modify files, do not run `convex dev`/`deploy`/`run`/`import`, and do not call any deployment.
- Verify every claim against the source and cite `path:line`. Label each piece of evidence **measured** (from the profile below) or **inferred** (from code reading). Never invent numbers.
- Focus: index usage, bounded queries, pagination, subscription (reactive) scope, redundant reads, transaction contention (OCC), expensive actions. Fixes must preserve behavior, authorization, tenant isolation and data integrity.

## Measured evidence

The profile file named in the task message was collected from the real local Convex backend binary (same engine as cloud) on a large-tenant fixture (~1,300 pallets/units, 126 products, 421 zones, 127 buildings, ~2,200–3,000 job-ticket scans, 153 employees with 45 attendance days each, standard local seeds for everything else).

- Every number is the backend's own per-execution `usageStats` from its function-log stream (the feed the Convex dashboard aggregates): `databaseReadDocuments`, `databaseReadBytes`, write docs/bytes/index rows, execution time, return bytes.
- Queries run as the seeded org-admin user via admin "acting-as" identities with a unique ignored claim per call, so every sample is a cache miss. 7 samples after a warm-up; p50 reported. Progressive/scanning queries are re-issued with their `scanCursor` until settled (as the client does) and the chain is summed; `Requests` is the chain length.
- Two backends run identical data: `candidate` and `base`, sampled in alternating order. In this baseline both run the same code, so the two exec columns form an A/A noise check. The machine is shared with other heavy workloads (load average 12–200), so **document and byte counts are the reliable signal; latency is indicative**.
- The "reactive fan-out" section opens every listed screen query on one WebSocket session, makes one write and counts the queries the backend re-executed. The baseline fan-out was captured under extreme machine load, so its two identical backends disagree; treat it as indicative only.
- Known fixture caveats: `hr/payslips:*` return `POLICY_NOT_ACTIVE` (policy not activated in the seed); `hr/roster:roster` returns `LIMIT_EXCEEDED` (153 employees > `MAX_ROSTER_EMPLOYEES = 50`); `scanning:resolvePackageCode` returns NOT_OK for the chosen code.

## Scoring rubric (performance only, 1–10)

- **9–10:** user-facing queries and mutations read roughly O(result) documents through selective indexes; no screen-load function reads more than a small multiple of what it returns or grows with tenant history; subscriptions depend only on what they display, so unrelated writes do not re-run them; no hot shared-document write contention; heavy work is bounded or precomputed; claims backed by measurement.
- **7–8:** most paths are tight; a few heavy paths remain but are bounded and justified.
- **5–6:** several hot paths read hundreds to thousands of documents per call, in proportion to tenant size or history, or re-run broadly on unrelated writes.
- **≤4:** unbounded scans or limit failures on core flows.

## Output (Markdown, nothing else)

```
## Score: X/10
- 3–6 bullets justifying the score with evidence.

## Findings (ranked by impact, max 10)
### N. Title
- Location: path:line (and callers)
- Evidence: measured numbers and/or inferred reasoning (label which)
- Cost mechanism: reads per call, growth with data, reactive re-runs, contention
- Fix: concrete change that preserves behavior/authorization; note indexes/backfills/migrations
- Expected impact and risk

## Already good (brief)

## What would raise the score to 9+
```
