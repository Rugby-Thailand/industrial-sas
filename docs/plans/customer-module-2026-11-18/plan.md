# ลูกค้า / Customers — module plan

**Date:** 2026-11-18 · **Status:** v1 implemented (2026-11-19); v2 and Later deferred · **Preview:** [index.html](index.html)

**Research:** [codebase-fit.md](../../research/customer-module-2026-11-18/codebase-fit.md) (gpt-6.2-sol) · [domain-ux.md](../../research/customer-module-2026-11-18/domain-ux.md) (gpt-6.2-astra)

## Goal

Today a customer is only a string. Job scans keep the name the AI copied from the ticket, and products keep a free-text `customerReference` (`convex/schema.ts:796`, `:955`). The goal is one customer record per organization, so staff can answer two questions: which jobs and products belong to this customer, and where do we deliver?

Scanning must never wait on customer data. Sales and accounting are future modules, so this module stays a clean master record. Do not add balances, credit terms or invoices to make it look complete.

## Scope decision

The two research reports disagree on v1. Sol defers contacts and addresses. Astra wants multiple establishments, multiple addresses, aliases and merge in v1. **This plan takes Sol's slicing and keeps Astra's field and UX rules.** In v1, a single delivery address and a single contact are embedded objects on the customer, not separate tables. Multiple sites and merge wait until a real customer needs them.

| Phase                 | Delivers                                                                                                                                                                                     | Why this order                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **v1 · Catalogue**    | List, search, create, detail, edit, archive/restore. Fields: name, generated code, optional registered names (TH/EN), tax ID + head-office/branch, one delivery address, one contact, notes. | Useful on its own and touches no scan code.                 |
| **v2 · Link records** | Optional `customerId` on job scans and products, a `customerAliases` table, exact-alias auto-link, a "Names to review" queue, linked jobs and products on detail, and a dry-run backfill.    | Needs real aliases from v1 records before matching is safe. |
| **Later**             | Multiple establishments and delivery sites, merging duplicates, a contacts list, address lookup by postcode, full-text search, sales and accounting fields.                                  | Add only when observed use calls for them.                  |

## Data model (v1)

`customers`: `defineTable(tenantFields({...}))`, scoped to the organization with no `warehouseId`. Register it in `TENANT_TABLES` and reuse the `masterDataStore` validators.

| Field                                                              | Rule                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `code`                                                             | Generated `C-0001`, editable on create. Unique per organization, including archived rows (`by_orgId_code`).                    |
| `name`                                                             | Required. The name staff recognize, kept in its original script.                                                               |
| `normalizedName`                                                   | Computed on the server: NFC, trimmed, whitespace collapsed, Latin case folded. Index `by_orgId_status_normalizedName`.         |
| `legalNameTh`, `legalNameEn`                                       | Optional. Copied exactly as supplied, never translated.                                                                        |
| `taxId`                                                            | Optional. Stored as 13 ASCII digits in a string, with leading zeros kept. A failed checksum warns and saving is still allowed. |
| `establishment`                                                    | Optional: `{ kind: "HEAD_OFFICE" } \| { kind: "BRANCH", code: "00001" }`. Unknown is left unset, never defaulted to `00000`.   |
| `deliveryAddress`                                                  | Optional object: `label`, `line`, `subdistrict`, `district`, `province`, `postcode`.                                           |
| `contact`                                                          | Optional object: `name`, `role`, `phone`, `email`.                                                                             |
| `notes`                                                            | Optional.                                                                                                                      |
| `status`, `version`, `archivedAt/ByUserId`, created/updated stamps | `ACTIVE \| ARCHIVED`. Archived customers stay readable for history.                                                            |

No duplicate-name constraint. The create form suggests likely matches before saving instead.

## Linking (v2)

- Job scans and products each get an optional `customerId` and `customerLinkSource: AUTO | MANUAL | UNLINKED`. The captured `customer` text and `customerReference` are never overwritten.
- `customerAliases` stores `customerId`, `alias`, `normalizedAlias`, the approver and an example scan. It is indexed by org + alias.
- A scan is linked automatically only when its normalized text exactly matches **one active** customer's name or approved alias. That check runs inside the save mutation, after idempotency replay. A blank, unmatched or ambiguous name still saves, without a link.
- The review queue groups unresolved names. A reviewer can link the selected tickets, search for another customer, create one, or skip. By default a decision applies to the listed tickets only. "Remember this name" creates an alias.
- The backfill is internal, bounded and resumable per org and warehouse. It does a dry run first that reports matched, ambiguous and unmatched counts, and it skips voided scans and rows that already have a link decision.
- Do not validate the format of AI-read names (see the no-format-check memory note).

## Permissions and routes

- New org-level permissions: `masterData.customer.read` and `masterData.customer.manage`. Both go to `ORG_ADMIN` through an idempotent role upgrade. Custom roles are left alone.
- Routes under `src/app/[locale]/(desktop)/master-data/customers/`:

| Route                         | Back                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`                   | Hub. `backFallbackHref={null}`.                                                                                                                                                                                  |
| `customers/new`               | Falls back to the list. Cancel uses `returnFromTask`. Save uses the live operation's `complete`, which restores the list's query.                                                                                |
| `customers/[customerId]`      | Falls back to the list. Archive and restore use the shared `ConfirmDialog`, which owns its Back entry.                                                                                                           |
| `customers/[customerId]/edit` | Falls back to the customer. The same form as `new`: Cancel uses `returnFromTask`, Save uses the live operation's `complete`. Opened from the customer, completion returns to that entry with its query and hash. |
| `customers/review` (v2)       | Child of the list. Each link decision is a live operation.                                                                                                                                                       |

- Sidebar: **ลูกค้า / Customers** under Warehouse, below Buildings & spots, gated on the read permission.
- Update `docs/contracts/back-navigation.json` for every route, state and action. Run `pnpm check:navigation`, ESLint, and the runtime Back cases listed in AGENTS.md.

## UI

The [preview](index.html) is the visual spec. It reuses only existing parts: `PageHeader`, `CollectionToolbar`, `DataTable`/`TableScroller`, `CursorPagination` (20 per page by default), `DescriptionList`, `CollapsibleSection`, `FormField`, `StickyActionBar`, `StatusBadge`, `Notice`, `EmptyState` and `ConfirmDialog`. Copy the list structure from `FinishedGoodsCatalogue`.

- **List:** one primary action, one search box (name, code, registered name and exact tax ID; aliases join in v2) and a status filter that defaults to active. Search and status live in the URL, so Back to the list restores them. On mobile, rows become cards that each link to the detail page.
- **Detail:** name, code and status first, then delivery and contact. In v2, recent jobs and linked products sit above the tax details.
- **Form:** create and edit share one form on their own task routes. Implementation chose a route over the earlier in-page `useWorkflowStep` editor: it reuses the create form and its Back contract, and adds no render state to the detail page. Only the name is required. Tax details, address and contact are collapsible sections with a summary. Likely duplicates show inline with **ใช้ลูกค้านี้ / Use this customer**.
- **Copy:** Thai first, plus English in `messages/en.json` under a `Customers` namespace and `Navigation.customers`. Reuse existing terms: the archived status is **เก็บถาวร** (as in `messages/th.json`, not ปิดใช้งาน), page size is **รายการต่อหน้า**, and the verb for linking is always **เชื่อม**, never เชื่อมโยง.
- **One small shared change:** `PageHeader` gets an optional `meta?: ReactNode` slot, used for the code and status badge under the title. Today the component has no slot for this.
- **Empty values:** use "—" everywhere. Show the archived badge (`StatusBadge` muted, เก็บถาวร) only on archived rows.

### Preview audit log

| Round | Reviewer                                                                                     | Fixed                                                                                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Self, from 12 Playwright screenshots                                                         | Review options ran the name into the code. The save bar was capped at form width. Phone detail cards shrank. Header actions sat between the title and summary.                                                                    |
| 2     | Independent Opus review, 15 findings, all applied after checking against the real components | `CollapsibleSection`, `CursorPagination`, `Notice`/`ErrorNotice` and `StatusBadge` now match the app. Terminology made consistent. 48px phone targets. Focus rings no longer clipped. Redundant copy cut. Added the v1/v2 toggle. |
| 3–4   | Self, screenshots plus measurement                                                           | Loading-skeleton columns now line up with the data table (measured identical x positions). Contact-line spacing fixed. No overflow or console errors in any of the 15 variants.                                                   |

Screenshots: [evidence/](evidence/).

## Acceptance

1. A Thai-only, name-only customer saves in under 10 seconds on a 390px phone.
2. An English-only name is not given an invented Thai spelling.
3. A tax ID with a bad checksum warns, and saving is still possible. Leading zeros survive.
4. Two customers with the same name both save, and the form shows the match before saving.
5. Archiving hides the customer from the default list, and the detail page still opens from a direct link.
6. Codes are unique across orgs and archived rows, and access from another organization is denied.
7. Back after a failed edit on a phone keeps the draft (navigation contract cases).
8. (v2) A scan whose name matches nothing still saves. An alias shared by two customers stays in review. A product reference that is a part number is never auto-linked.

## Deferral triggers

- **v2 linking** starts once v1 has real customer records and at least one reviewer has named the aliases seen on job tickets; matching before that would auto-link against guesses.
- **Later** items each wait for an observed need: a customer with a second delivery site, a confirmed duplicate pair, or a request for sales or accounting fields.

## Out of scope

Invoicing, credit, payment terms, VAT treatment, receivables, verifying tax IDs against the Revenue Department, and price lists.
