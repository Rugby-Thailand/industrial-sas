# Test fixtures

Shared, checked-in test data for the suites in `tests/`.

Current checked-in fixtures:

- Synthetic two-tenant identity, membership, and warehouse data for tenant-context
  integration and isolation tests
- `tenant-storage-port.ts`: an in-memory `TenantStoragePort` that enforces nothing
  and records every call, so the document-access suites prove the accessor's own
  guards rather than the fake's

Planned contents, per `PROJECT_PLAN.md`:

- Supplier barcode corpus and GS1 parser fixtures
- Sample purchase order and receiving payloads
- UoM conversion tables used by property tests

Rules:

- Fixtures must be deterministic and free of real customer or supplier data.
- Never commit real credentials, tokens, or personal data (PDPA).
