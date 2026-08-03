# Test fixtures

Shared, checked-in test data for the suites in `tests/`.

Nothing lives here yet. Planned contents, per `PROJECT_PLAN.md`:

- Supplier barcode corpus and GS1 parser fixtures
- Sample purchase order and receiving payloads
- UoM conversion tables used by property tests

Rules:

- Fixtures must be deterministic and free of real customer or supplier data.
- Never commit real credentials, tokens, or personal data (PDPA).
