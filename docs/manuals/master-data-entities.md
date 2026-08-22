# Suppliers, barcodes, alternate units, storage classes, and label templates

**Current availability: Read and write surfaces plus desktop screens;
unauthenticated.** Five entities exist end to end — schema, bounded reads,
idempotent audited writes, permissions, Thai-first screens, and preview
fixtures. With no Clerk instance configured every tenant-bound call is denied,
so no screen has shown a real tenant's rows. The screens **do** now expose write
controls, and what an unconfigured machine sees is the honest refusal rather
than a hidden button.

Read [Master-data catalogue](./master-data-catalogue.md) first: the paging rule,
the uniqueness-by-contract rule, the idempotency machinery, and the
field-not-value refusal rule are shared and are not repeated here.

## What exists

### Reads

| Function                                   | Scope | Permission                     | Index used                         |
| ------------------------------------------ | ----- | ------------------------------ | ---------------------------------- |
| `masterData/catalogue:getItem`             | ORG   | `masterData.item.read`         | direct `get`, tenant-bound         |
| `masterData/catalogue:listSuppliers`       | ORG   | `masterData.supplier.read`     | `by_orgId_code` / `…_status_code`  |
| `masterData/catalogue:listStorageClasses`  | ORG   | `masterData.storageClass.read` | `by_orgId_code` / `…_status_code`  |
| `masterData/catalogue:listBarcodesForItem` | ORG   | `masterData.item.read`         | `by_orgId_itemId_barcode`          |
| `masterData/catalogue:resolveBarcode`      | ORG   | `masterData.item.read`         | `by_orgId_barcode`                 |
| `masterData/catalogue:resolveScanToItem`   | ORG   | `masterData.item.read`         | `by_orgId_barcode`, `by_orgId_sku` |
| `masterData/catalogue:listItemUoms`        | ORG   | `masterData.item.read`         | `by_orgId_itemId_uom`              |
| `masterData/catalogue:getItemUomProfile`   | ORG   | `masterData.item.read`         | `by_orgId_itemId_status_uom`       |
| `masterData/catalogue:listLabelTemplates`  | ORG   | `label.template.read`          | `by_orgId_status_code`             |
| `masterData/catalogue:getLabelTemplate`    | ORG   | `label.template.read`          | direct `get`, tenant-bound         |

### Writes

| Mutation                                 | Scope | Permission                       | Idempotency operation            |
| ---------------------------------------- | ----- | -------------------------------- | -------------------------------- |
| `masterData/writes:createSupplier`       | ORG   | `masterData.supplier.manage`     | `masterData.supplier.create`     |
| `masterData/writes:updateSupplier`       | ORG   | `masterData.supplier.manage`     | `masterData.supplier.update`     |
| `masterData/writes:createStorageClass`   | ORG   | `masterData.storageClass.manage` | `masterData.storageClass.create` |
| `masterData/writes:updateStorageClass`   | ORG   | `masterData.storageClass.manage` | `masterData.storageClass.update` |
| `masterData/writes:createBarcode`        | ORG   | `masterData.item.manage`         | `masterData.barcode.create`      |
| `masterData/writes:deactivateBarcode`    | ORG   | `masterData.item.manage`         | `masterData.barcode.deactivate`  |
| `masterData/writes:createItemUom`        | ORG   | `masterData.item.manage`         | `masterData.itemUom.create`      |
| `masterData/writes:deactivateItemUom`    | ORG   | `masterData.item.manage`         | `masterData.itemUom.deactivate`  |
| `masterData/writes:draftLabelTemplate`   | ORG   | `label.template.draft`           | `label.template.draft`           |
| `masterData/writes:publishLabelTemplate` | ORG   | `label.template.manage`          | `label.template.publish`         |

### Screens

| Route                                   | What it maintains                                                    |
| --------------------------------------- | -------------------------------------------------------------------- |
| `/{locale}/master-data/suppliers`       | Suppliers: register, create, deactivate                              |
| `/{locale}/master-data/storage-classes` | Storage classes: register, create, deactivate                        |
| `/{locale}/master-data/label-templates` | Template versions: register, draft, publish                          |
| `/{locale}/master-data/items/{itemId}`  | One item's barcodes, alternate units, lots; item edit and deactivate |

The item register (`/{locale}/master-data/items`) links each row to its detail
screen rather than expanding it: three sub-tables inside a row would be a page
inside a cell.

## The rules each entity actually owns

### Suppliers and storage classes

Both are a code, a name, and a status, and both are **organization-scoped**.

A storage class could plausibly have been warehouse-scoped, and it is not. A
class means the same thing at every site (D-13): a per-warehouse definition
would let two plants disagree about what "flammable" requires while both calling
it by that name. Because it means the same thing everywhere, it gets its own
`masterData.storageClass.read` / `.manage` pair rather than borrowing the
warehouse-scoped location codes.

### Barcodes and scan aliases

The unique key is **`(orgId, barcode)`**, not `(orgId, itemId, barcode)`. That is
the entire contract: a scan must resolve to at most one item, and a key that
included the item would permit two items to claim one printed value — a
scan that could not be resolved without asking the operator which item they
meant.

`orgId` is the other half and it matters just as much. Two manufacturers may
legitimately stock the same purchased part under the same GTIN; a check that
forgot the organization would refuse the second tenant's registration _and_
disclose that the value exists somewhere. `tests/isolation/master-data-entities.isolation.test.ts`
proves both tenants can register the same GTIN and that each resolves to their
own item.

**Kinds are not re-validated here.** `convex/model/masterData/catalogueRules.ts`
delegates:

- `GTIN` goes through `normalizeGtin` — the same kernel the scan resolver uses.
  It pads to 14 digits and verifies the modulo-10 check digit. A row claiming
  `GTIN` for a value whose check digit fails is a row the resolver would never
  produce, so the catalogue would hold an alias no scan could ever match.
- `SSCC`, `INTERNAL`, and `SUPPLIER` are normalized as raw scans and not
  otherwise judged. An SSCC's check digit is verified by the resolver when it
  classifies one, an internal LPN's check character belongs to the LPN kernel,
  and a supplier's code is whatever the supplier printed.

One rule _is_ added rather than delegated: a whitespace-only alias is refused.
`normalizeRawScan` deliberately preserves whitespace, because a **scan** is
persisted as it arrived (`INV-0005-12`). A stored **alias** made only of spaces
is unusable, unscannable, and would still occupy the unique key that guarantees
one scan resolves to one item.

**Deactivation keeps the key occupied.** The value is still printed on cartons in
a warehouse; it must not become available for something else. It simply stops
resolving — `resolveBarcode` answers `{found:false, reason:"UNKNOWN_BARCODE"}`
for a deactivated alias, byte-identical to what it answers for one that never
existed. There is no reactivate control, because re-pointing a printed barcode is
a decision rather than a toggle.

**`resolveScanToItem` is the counter-read the receiving screens use.**
`resolveBarcode` is the narrow, kind-checked lookup for a caller that already
knows the symbology it holds. `resolveScanToItem` takes whatever a wedge scanner
typed and tries the two rungs a local catalogue can answer: an active barcode
(`by_orgId_barcode`), then an active item SKU (`by_orgId_sku`). The barcode wins
a tie — the thing on the carton beats the thing written about it — and case is
folded, because a person typing and a scanner disagree about it.

Every miss is the same answer. An unregistered string, a withdrawn alias, a
deactivated item, and another tenant's barcode are indistinguishable
(`INV-0002-03`); telling them apart would make the read an oracle over a
catalogue the caller cannot list. It deliberately does _not_ implement the full
scan ladder of `convex/model/identifiers/scanResolution.ts` — that decides what a
string **is** and needs a per-tenant LPN namespace policy; this decides what a
string **refers to** among items, which is the whole question a receiving item
field asks.

### Alternate units and exact conversions

Stored as **two integers**, `toBaseNumerator` and `toBaseDenominator`, and
reduced by `makeRatio` before storage. Three consequences, each load-bearing:

1. **A factor no float represents survives.** A drum decanted into three is
   `200/3` litres; no decimal expansion exists and none is stored. The screen
   shows `200/3` for the same reason.
2. **Two spellings of one factor store identically.** `24/2` and `12/1` are the
   same factor; storing both forms would make an equality check on a conversion
   table a comparison of spellings.
3. **The arithmetic has exactly one implementation.** `profileFromRows` rebuilds
   an `ItemUomProfile` and hands it to the kernel's own `convertToBase`. There is
   no conversion arithmetic in the catalogue layer at all.

The base unit may not be an alternate of itself, and that is checked at **create**
time rather than left to profile assembly: at create time there is no profile
yet, and discovering the clash only when the whole table is rebuilt would mean
storing a row that can never be read back.

`getItemUomProfile` reads at most `MAX_ITEM_UOM_ROWS` (16) active rows through a
bounded `take`. An item with more than sixteen alternate units is not a
conversion table; it is a data-entry problem, and refusing to page it here keeps
the read bounded.

### Label templates

A template is `(code, version)`. The version is **assigned by the server** from
`nextTemplateVersion` — one above the highest existing version for the code — so
a version number is a count of published revisions rather than an opaque handle.
A printed label can cite the version that produced it. `MAX_TEMPLATE_VERSIONS`
(50) bounds the history a single code may accumulate.

**Publishing is this repository's first genuine maker-checker workflow.** The
drafter is recorded on the row as `draftedByUserId`, and the publish policy hands
that field to the authorization evaluator as the maker. The evaluator denies when
the maker and the actor are the same person **and** when there is no maker at all
— both fail-closed. So a drafter cannot publish their own draft, and a second
`ORG_ADMIN` must.

The screen still shows the publish control to the drafter. They will be denied,
and the denial is what teaches the rule; a hidden control reads as a missing
feature.

The client is told only `AUTHORIZATION_DENIED` and a request ID. It is **not**
told that an approval was required. Distinguishing "needs a second person" from
"you lack the permission" in the payload would let a caller enumerate their own
permissions (`INV-0002-07`); the real reason survives on the audit row, reachable
through `admin.audit.read`.

## Nothing is printed, and nothing pretends to be

This bears stating plainly because a label feature implies a printer:

- There is **no printer transport**. That is `INT-04` and it does not exist.
- There is **no physical print verification**. That is `RG-004` and it has not
  happened.
- The template body is stored **as text**. Nothing in this repository parses ZPL,
  validates a PDF, renders a preview, or transmits a payload anywhere.

`validateLabelBody` is deliberately shallow: non-empty, at most
`MAX_LABEL_BODY_LENGTH` (16,384) characters, and no control characters other than
tab, newline, and carriage return. A validator that accepted only "real" ZPL
would imply a verification nobody has performed. The screen says the same thing
in Thai and English, on the page, next to the field.

## The write path in the browser

`src/lib/convex/writeState.ts` names every ending a write can have, because a
screen that collapses two of them lies to an operator:

| State     | What is actually true                                              |
| --------- | ------------------------------------------------------------------ |
| `SAVED`   | The server wrote it, and says whether this was a replay.           |
| `DENIED`  | Authorization refused. Generic, by contract; quote the request ID. |
| `REFUSED` | Authorized, but the write was rejected — a field, a duplicate key. |
| `FAILED`  | Transport or unknown. The write **may or may not** have run.       |

`FAILED` is the one that earns the module. A network failure after the mutation
reached the server is indistinguishable from one before it, so the screen does
not say "not saved". It says retry — and the retry **reuses the same idempotency
key**, so the server replays instead of writing a second row. A key released on
failure would turn one flaky moment into two suppliers with the same name.

Row controls key the idempotency key by **row**. Pressing the same row twice
replays one write; pressing a different row mints a new key, because reusing the
first row's key with different arguments would produce
`REQUEST_ARGUMENT_CONFLICT` — a confusing way to be told "that already worked".

A replay is reported as a replay (`savedReplayed`), not as a fresh save. It is the
idempotency key doing its job, and saying so is what stops an operator "fixing"
it by submitting again.

## Permissions added with this slice

| Code                             | Scope | Granted to                        |
| -------------------------------- | ----- | --------------------------------- |
| `masterData.storageClass.read`   | ORG   | every role that reads master data |
| `masterData.storageClass.manage` | ORG   | `ORG_ADMIN`                       |
| `label.template.draft`           | ORG   | `ORG_ADMIN`, `WAREHOUSE_MANAGER`  |

`label.template.draft` is separate from `label.template.manage` on purpose.
Drafting is authoring; managing is publishing and retiring, which is the
maker-checker half. One code for both would have made the second person
unnecessary.

The full matrix is in the [permission catalogue](../permissions.md) §4, and
`tests/integration/permissions.integration.test.ts` fails if the code and the
document disagree — including on ordering.

## Cross-tenant behaviour

Proved in `tests/isolation/master-data-entities.isolation.test.ts`, a blocking
merge gate (`RG-031`):

- Both tenants may hold the same supplier code, the same storage-class code, and
  the same GTIN.
- A shared barcode resolves to **each tenant's own** item.
- A barcode only the other tenant registered answers byte-identically to one
  nobody registered.
- A barcode whose `itemId` belongs to another tenant is `REFERENCE_NOT_FOUND`,
  and no row is written.
- One tenant cannot publish another tenant's draft.
- Every row written carries the writing tenant's `orgId`, which is derived from
  the resolved context and is never an argument (`INV-0001-02`).

## What is deliberately absent

**Warehouse, handling-unit, owner, and reason-code writes.** None is a
prerequisite for the five entities above: a supplier, a storage class, a
barcode, an alternate unit, and a label template are all reachable and complete
without them. They remain deferred, each needing its own uniqueness contract and
permission split.

**Linking a storage class to a location or an item.** The class exists and is
maintainable; nothing yet references it. The reference is a schema change on
`locations` (or `items`) with its own migration and its own validation, and
adding an unenforced column now would be a claim about a rule that does not run.

**Linking a supplier to a receipt.** Receiving does not exist (`INT-01`,
Phase 3). The register is the prerequisite, not the workflow.

**Reactivating a barcode or an alternate unit.** Both are one-way by design; see
above.

**Any printing whatsoever.** See "Nothing is printed".

## Related

- [Master-data catalogue](./master-data-catalogue.md)
- [Quantities and UOM](./quantities-and-uom.md)
- [Barcode and identifier processing](./barcode-and-identifiers.md)
- [Roles, permissions, and audit](./roles-permissions-and-audit.md)
- [Application shell and locale](./application-shell-and-locale.md)
- [Permission catalogue](../permissions.md)
