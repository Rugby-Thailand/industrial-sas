# ReUI authoring selection

Status: selected through the authenticated ReUI MCP on 2026-08-03. The account
exposes ReUI's free catalog; premium application blocks are not visible and no
premium identifiers are assumed.

ReUI is an authoring dependency only. Vendored source is imported locally from
the repository. No ReUI token, runtime dependency, browser request, server
request, environment variable, or deployment credential is permitted.

## Selected components

| WMS surface        | ReUI source                                                                    | Intended use                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Responsive shell   | `c-sheet-4`, `autocomplete`                                                    | Mobile navigation drawer and tenant/warehouse switcher; pair with the local shadcn sidebar on desktop.                              |
| Dashboard          | `c-card-15`, `c-chart-2`, `c-chart-13`                                         | KPI trends, receiving/putaway comparison, and throughput trend. Every chart requires a textual or tabular equivalent.               |
| Inventory          | `c-filters-8`, `c-filters-9`, `c-data-grid-20`                                 | Async server-backed filters, Thai/English filter labels, pagination, and column visibility. Tenant enforcement remains server-side. |
| PO and receiving   | `c-autocomplete-12`, `c-number-field-6`, `c-date-selector-2`, `c-data-grid-22` | Supplier/SKU selection, quantities, expected date, and editable PO lines.                                                           |
| Receiving workflow | `c-stepper-10`, `c-stepper-13`                                                 | Receive, count, QC, putaway, and completion; vertical on handhelds and horizontal where space permits.                              |
| Handheld scanning  | `c-stepper-6`, `c-alert-3`, `c-alert-6`, `c-alert-8`, `c-number-field-5`       | Compact task progress, actionable/success/error feedback, and quantity confirmation.                                                |

All interactive controls must have at least a 48 by 48 CSS-pixel target. Scanner
feedback combines visible text and a live region with optional audio and haptic
hooks; color or sound is never the only signal.

## Vend commands

Run only when the corresponding surface is implemented, review the generated
source, and commit the local files and transitive shadcn dependencies. These
commands require no ReUI license key.

```sh
npx shadcn@latest add @reui/c-sheet-4 @reui/autocomplete
npx shadcn@latest add @reui/c-card-15 @reui/c-chart-2 @reui/c-chart-13
npx shadcn@latest add @reui/c-filters-8 @reui/c-filters-9 @reui/c-data-grid-20
npx shadcn@latest add @reui/c-autocomplete-12 @reui/c-number-field-6 @reui/c-date-selector-2 @reui/c-data-grid-22
npx shadcn@latest add @reui/c-stepper-10 @reui/c-stepper-13
npx shadcn@latest add @reui/c-stepper-6 @reui/c-alert-3 @reui/c-alert-6 @reui/c-alert-8 @reui/c-number-field-5
```

## Integration notes

- The data grid receives a TanStack table instance and uses stable row IDs,
  bounded server pagination, a real table element, and horizontal overflow on
  small screens.
- Filters use generated filter objects; all query interpretation and tenant
  scoping occurs in bounded server functions.
- Stepper items and content use matching one-based step values. Later steps are
  unavailable until their prerequisites pass, and transitions announce loading
  and validation state.
- Date Selector returns its component value type rather than a raw `Date`.
  Business-date conversion stays in the pure domain module.
- Thai and English copy includes pagination labels, filter operators, empty
  states, errors, and accessible names. Buddhist Era conversion is display-only.

Premium app-shell and dashboard block IDs are an external catalog entitlement,
not a release gate. The free components above are sufficient for the MVP and are
the only ReUI sources approved for the initial implementation.
