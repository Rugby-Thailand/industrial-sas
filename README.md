# Industrial SSA

A mobile-first, multi-tenant B2B SaaS Warehouse Management System (WMS) for Thai
manufacturing companies.

The first release targets a single production-grade inbound vertical slice:

`PO → Receive → QC → Build pallet/lot → Print label → Putaway → Inventory ledger`

Scope, non-goals, assumptions, delivery phases, and the decisions that must be
accepted before domain implementation are recorded in
[PROJECT_PLAN.md](./PROJECT_PLAN.md).

## Current status

**Planning complete; implementation not started.**

This repository currently contains documentation only — the approved project
plan plus this baseline. No application code, packages, schema, infrastructure,
or cloud resources exist yet. Nothing described in the plan should be assumed to
be built.

## Approved stack

The plan approves the following technologies. They are approved, not yet
installed or configured.

| Area | Choice |
|---|---|
| Framework | Next.js (App Router), React, strict TypeScript |
| Backend / data | Convex (append-only inventory ledger with materialized balance projections) |
| Identity | Clerk (identity, MFA, sessions, organizations); Convex owns WMS authorization |
| UI | Tailwind CSS, shadcn/ui, ReUI MCP |
| Files | UploadThing (private ACLs, short-lived signed URLs) |
| Client form | Installable PWA with separate handheld and desktop shells |
| Package manager | pnpm |
| Testing | Vitest, `convex-test`, fast-check, Playwright, testing-library, axe |
| i18n | `next-intl` — Thai-first with English fallback |

Deferred by decision B-08: Three.js. The MVP uses a 2D SVG occupancy map
instead, and Three.js must not be added during initialization unless that
decision is explicitly reversed.

## Repository conventions

- Trunk-based development on `main` with short-lived feature branches.
- Secrets are never committed. `.env*` files are ignored; only `.env.example`
  templates are tracked.

## Next step

Complete the Phase 0 gate in [PROJECT_PLAN.md](./PROJECT_PLAN.md) §4 and §10,
then initialize the application per §9.
