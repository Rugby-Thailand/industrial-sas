# ADR-0010 — Thai-first internationalization, accessibility, and business-time rules

- ID: `ADR-0010`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-05, D-06,
  D-07, D-24), §4 (B-10), §5 Q4, Q11, Q44, §10 Phase 4
- Covers plan ADR backlog (§11) items: 23
- Implementation status: **Not implemented.** `next-intl` 4.13.4 is installed and
  unwired. There are no message catalogues, no locale routing, and no accessibility
  suite beyond a placeholder axe test tier
  (**foundation only**: the `a11y` Vitest project exists and asserts nothing about
  the product).

## Context

Operators are Thai speakers working on handhelds with gloves, in variable lighting,
often at speed. Thai text raises concrete technical issues: taller line boxes,
no word spaces (so wrapping and truncation differ), collation that differs from
byte order, Buddhist Era dates on printed documents, and thermal-printer fonts that
may not carry Thai glyphs.

Time is equally concrete: a receiving shift that crosses midnight in Bangkok must
report against the business date the warehouse recognises, not a UTC date.

## Decision

### Language and content

1. **Thai is the default locale, English is the fallback** (D-06, B-10). Code
   identifiers, permission codes, enum values, and log messages stay English.
2. **`next-intl` with locale-segment routing** (`/[locale]/...`) is the i18n
   mechanism (§5 Q44, plan §8).
3. **Bilingual master data.** Item and location descriptions support Thai and
   English values as data (`itemDescriptions`), not as translation keys (B-10,
   §7.2).
4. **Thai collation for sorting** user-visible Thai text; byte ordering is not
   acceptable for pick/search lists (§5 Q44).
5. **Real Thai layout tests.** Layouts are tested with Thai strings, not
   placeholder Latin text, because Thai changes height and wrapping (§5 Q44).

### Time, dates, and numbers

6. **Timestamps are UTC**; business dates are stored as `YYYY-MM-DD` in the
   organization timezone, default `Asia/Bangkok` (D-05).
7. **Buddhist Era is display-only.** BE may appear on documents and printed output
   where requested; storage is always Gregorian ISO (D-06, B-10).
8. **THB with integer minor units**, single currency per organization (D-07,
   [ADR-0004](./0004-exact-quantities-and-uom.md)).
9. **One formatting layer.** Dates, numbers, and quantities are formatted through
   shared helpers so no screen invents its own rounding or calendar.

### Accessibility and warehouse ergonomics

10. **WCAG 2.2 AA is the target**, plus warehouse ergonomics: 48×48 px minimum
    touch targets, glove-compatible spacing, audio and haptic feedback, high
    contrast, and no state conveyed by colour alone (D-24).
11. **Keyboard and scanner operability.** Every handheld flow is operable from
    keyboard/HID input alone, since the scanner is a keyboard
    ([ADR-0008](./0008-adapter-ports-and-release-gates.md), D-04).
12. **Automated plus manual verification.** axe-core assertions run in CI; screen
    reader and physical glove/lighting checks are manual acceptance items
    (plan §12).

### Printing

13. **Thai glyph output on thermal labels is verified physically** before launch;
    a font that renders in the browser is not evidence for a printer (§5 Q44,
    `RG-004`).

## Invariants

### Code-owned guarantees

- `INV-0010-01` No user-facing string is hardcoded in a component; all text resolves
  through the message catalogue.
- `INV-0010-02` Thai and English catalogues have the same key set; a missing Thai
  key fails the build or lints as an error rather than silently falling back in
  production screens.
- `INV-0010-03` Timestamps are stored as UTC instants; business dates are stored as
  `YYYY-MM-DD` strings resolved with the organization timezone.
- `INV-0010-04` Buddhist Era never appears in stored data.
- `INV-0010-05` Locale is resolved from the URL segment and user preference,
  server-side, so the first render is already localized.
- `INV-0010-06` Interactive targets in handheld shells are at least 48×48 px.
- `INV-0010-07` No state is communicated by colour alone; every colour-coded state
  has a text or icon equivalent.
- `INV-0010-08` Every handheld flow is completable using keyboard/HID input only.
- `INV-0010-09` axe-core assertions pass with no violations for every shipped screen
  (`a11y` test tier).
- `INV-0010-10` Quantity, date, and money formatting goes through shared formatters.

### Operational assumptions

- `OPS-0010-01` Thai translations are reviewed by a Thai warehouse-domain speaker,
  not machine translated (plan §10 Phase 4, `RG-042`).
- `OPS-0010-02` The pilot printer and label stock render Thai glyphs correctly
  (`RG-004`).
- `OPS-0010-03` Which documents require BE display is confirmed with the tenant
  (B-10, `RG-043`).
- `OPS-0010-04` Operators' devices use the expected system locale and font support
  (D-03).
- `OPS-0010-05` Training materials exist in Thai (plan §10 Phase 4).

## Consequences

- Thai-first means the English UI is the fallback path and can drift; both
  catalogues need the same review discipline.
- Thai text expands vertically, so fixed-height handheld components will break;
  layouts must be tested with real strings from the start.
- Business-date logic appears in every report and dashboard query; centralising it
  early avoids off-by-one-day defects at shift boundaries.
- 48 px targets and glove spacing reduce information density on handhelds, which
  reinforces the one-task-per-screen pattern (§5 Q10).
- Physical print verification is a hardware gate that cannot be satisfied in CI.

## Rejected alternatives

| Alternative                                | Why rejected                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| English-first UI with Thai added later     | Operators are Thai speakers; retrofitting Thai changes layout, content, and migration work (B-10). |
| Single-language master data                | Suppliers and internal teams need both; a single field forces a lossy choice (B-10).               |
| Storing Buddhist Era dates                 | Breaks arithmetic, sorting, exports, and integrations (D-06).                                      |
| Storing local timestamps instead of UTC    | Ambiguous across DST-free but multi-site tenants and impossible to compare (D-05).                 |
| Deriving business date from UTC date       | Misassigns cross-midnight shift work to the wrong day (D-05).                                      |
| Latin placeholder text in layout tests     | Hides Thai line-height and wrapping defects (§5 Q44).                                              |
| Colour-only status indicators              | Fails WCAG 2.2 AA and is unreadable in warehouse lighting (D-24).                                  |
| Browser font rendering as printer evidence | Thermal printers have their own font sets; only a physical print proves output (§5 Q44).           |
| Multi-currency support in MVP              | No pilot need; deferred (D-07, §2.3).                                                              |

## Verification

Planned, not present.

- `a11y` tier (axe-core): zero violations per screen; touch-target and contrast
  assertions where testable.
- Unit tests: business-date resolution across the Bangkok midnight boundary; BE
  formatting is display-only; Thai collation ordering; catalogue key parity.
- E2E: Thai and English layouts, keyboard-only completion, synthetic HID scan
  events (plan §12).
- Manual acceptance: screen-reader pass, glove and lighting checks, physical Thai
  label print and rescan.

## Release gates

- `RG-004` Physical ZPL label printed in Thai and English and rescanned.
- `RG-029` Printed labels remain scannable and Thai text correct after handling.
- `RG-042` WCAG 2.2 AA and warehouse ergonomics audit completed and remediated.
- `RG-043` Thai/English content completion and BE display requirements confirmed.
- `RG-044` Thai operator and supervisor training materials delivered.
- Register: [release gates](../release-gates.md).

## References

- Plan §3.2 (D-02, D-03, D-05, D-06, D-07, D-24), §4 (B-10), §5 Q4, Q10, Q11, Q44,
  §8, §10 Phase 4, §12.
- [ADR-0004 — Exact quantities and UOM](./0004-exact-quantities-and-uom.md)
- [ADR-0007 — Inbound slice scope](./0007-inbound-slice-scope.md)
- [Domain glossary](../domain-glossary.md)
