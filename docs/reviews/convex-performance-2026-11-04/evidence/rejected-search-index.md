# Rejected: Convex search index for job-scan substring search

Tried in iteration 4 and reverted before commit. `listJobScans` text search must
keep its exact semantics: case-, width- and NFKC-insensitive **substring**
matching over seven fields plus the building name, newest first.

Design tried: a `searchText` field holding every suffix of every token, a
Convex `searchIndex` filtered by org/warehouse/mapped, hits re-verified with the
exact matcher and re-sorted by `createdAt`; the bounded scan stayed as fallback
for capped results, stale rows and building-name matches.

Real-engine parity (`scripts/performance/convex/search-parity.mjs`, same
dataset on candidate and `main`, every needle paged to completion): **23 of 537
needle/filter combinations returned fewer rows than the scan**, for example:

| Needle   | Filter | Search path | Scan (truth) |
| -------- | ------ | ----------: | -----------: |
| `FO6910` | ALL    |          62 |        2,100 |
| `O69102` | ALL    |          62 |          800 |
| `สำนัก`  | ALL    |           0 |          529 |
| `9102`   | MAPPED |           0 |          100 |

Direct probes of the index on the local backend explain both failure classes:

- **Last-term prefix expansion is bounded and silent.** `fo6910` returned 64
  documents and `fo691000` 50, far below the true counts and below the
  256-candidate cap used to detect truncation, so incompleteness is undetectable.
- **Thai text with ำ (SARA AM) is unsearchable after NFKC.** NFKC decomposes it
  into ํ + า; the index tokenizer then does not match: `จำกัด` and `สำนัก` → 0,
  while `บริษัท` (no ำ) → 531. NFKC is part of the existing matcher's semantics.

Because neither failure is observable at query time, the index cannot even serve
as a safe fast path. Search still scans history in bounded chunks (open finding).
