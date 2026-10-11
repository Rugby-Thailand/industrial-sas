# Parallel performance audit — October 10, 2026

User priority: improve speed; preserve UX whenever the two conflict.
The user subsequently selected **general loading and navigation** as the primary
workflow. The consolidated plan puts those improvements first.

Four independent Kiro CLI processes reviewed separate parts of the current
working tree using `claude-opus-5.5` with high effort. Model availability was
checked before launching. Each process was restricted to source/document/test
inspection and writing its own report; no application edits, deployments,
seeding, dependency installs, or benchmark/test-suite runs were assigned.

The starting HEAD was `b232565f322c7f1fd7279b2184435949eea4436d`. The review also
includes extensive pending HR/search and other user work; HEAD alone does not
reproduce the audited application. Freeze the intended working-tree state before
collecting comparison measurements. Source references describe this audit's
working tree and can move as implementation continues.

| Reviewer | Scope                                                                              | Report                                                           |
| -------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Kiro 1   | Initial load, shared shell, providers, localization, bundle and navigation         | [Loading and shell](01-loading-shell.md)                         |
| Kiro 2   | Storage scenes, frontend interactions, catalogues, scanning and printing           | [Interactions and scanning](02-interactions-storage-scanning.md) |
| Kiro 3   | Warehouse/storage/finished-goods Convex reads, subscriptions, summaries and writes | [Backend warehouse](03-backend-warehouse.md)                     |
| Kiro 4   | HR, global search, permissions, AI fallback and exports                            | [HR and search](04-hr-search.md)                                 |
| Codex    | Measurement readiness, UX gates and consolidation                                  | [Measurement and UX](05-measurement-and-ux.md)                   |

The consolidated [performance implementation plan](../../plans/performance-improvement-2026-10-10.md)
selects and sequences these findings. The individual reports retain narrower
alternatives and evidence; their priority labels are local to their own scopes.
The consolidated plan governs cross-feature ordering.

All four Kiro processes completed successfully. Codex reconciled overlapping
recommendations and checked source claims before finalizing the plan. Historical
bundle estimates overlap and must not be added together. Code-derived query
capacity estimates are risks to measure, not observed production failures.
Connection warming, prefetch tuning, decoder replacement and retained views remain
conditional on latency, correctness and UX checks. The plan does not adopt
persistent landing hints, request-ID changes or unverified browser rate limits.

No new production or authenticated-browser performance baseline was collected
for this audit. Existing build outputs and historical artifacts are supporting
evidence only; source structure alone does not prove latency or transferred-byte
savings. Application changes and runtime verification belong to implementation.

The Kiro invocation for each scoped prompt was:

```sh
'/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat' chat \
  --model claude-opus-5.5 --effort high --trust-all-tools --no-interactive \
  '<scoped read-only audit prompt>'
```

Transient process logs: `/tmp/industrial-sas-performance-<report-name>.log`.
The durable deliverables are the reports and consolidated plan in this repo.
