# Quality

## Merge bar

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm guards
```

## Proof

| Risk            | Proof                            |
| --------------- | -------------------------------- |
| Domain rule     | Unit and property tests          |
| Tenant leak     | Deny-path and cross-tenant tests |
| Retry duplicate | Idempotency tests                |
| Ledger drift    | Reconciliation tests             |
| User flow       | Browser tests                    |
| Accessibility   | axe plus manual device checks    |
| Scale           | Staging load tests               |
| Recovery        | Timed restore drill              |
| Hardware        | Target-device evidence           |

## Security bar

- Deny by default.
- Validate every boundary.
- Audit privileged actions.
- Scan dependencies and secrets.
- Keep tenant data out of logs and fixtures.
- Review exports, support access, and file links.

## Release bar

- All required gates closed.
- Zero P0 defects.
- At most two P1 defects in the final pilot week.
- Zero tenant leaks and ledger drift.
- Rollback and restore proved.
- Operations and legal owners sign off.

See [coverage](../specification-coverage.md), [gates](../release-gates.md), and [runbooks](../runbooks/README.md).
