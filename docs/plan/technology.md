# Technology

## Stack

| Concern  | Choice                                |
| -------- | ------------------------------------- |
| Web      | Next.js App Router, React, TypeScript |
| Data     | Convex                                |
| Identity | Clerk                                 |
| UI       | Tailwind, shadcn, Radix, ReUI         |
| Language | next-intl                             |
| Files    | Private `FileStoragePort`             |
| Tests    | Vitest, fast-check, Playwright, axe   |

## Module seams

```text
src/app/             routes and composition
src/features/        feature UI and flows
src/components/ui/   shared UI
src/lib/             browser and application utilities
convex/model/        pure business rules
convex/lib/          auth, tenant, audit, ports
convex/<domain>/     thin queries, mutations, actions
docs/adr/            architecture decisions
```

## Rules

- Route files compose; they do not own domain rules.
- Feature folders own one workflow.
- `convex/model/**` stays pure and deterministic.
- Public Convex functions validate, authorize, then call domain code.
- External services sit behind ports.
- Shared code is extracted after two real uses.
- Dependencies are pinned and reviewed.

## Trust

- Browser input is untrusted.
- Identity is verified server-side.
- Tenant context comes from verified membership.
- Authorization runs before data access.
- Secrets stay server-side.
- Logs exclude secrets and tenant payloads.

## Client

- Thai-first, English-complete.
- Mobile-first scan paths.
- Server acknowledgement defines connectivity.
- Accessible keyboard, focus, labels, and contrast.
- Large views paginate or virtualize.

Database rules live in [Database](./database.md). Architecture changes require an [ADR](../adr/README.md).
