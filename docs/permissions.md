# Permission catalogue, seeded roles, and policy semantics

Status: **specification.** No permission code, role seed, or policy evaluator exists
in this repository. The tables this catalogue will populate — `permissions`, `roles`,
`rolePermissions` — are declared in `convex/schema.ts` and are empty, unseeded, and
unread. This document is the contract that
[ADR-0006](./adr/0006-authorization-and-support-access.md) requires; it becomes the
source for `convex/lib/permissions.ts` and the reference-data seed when Phase 1
starts.

## 1. Ownership and stability rules

- **The catalogue is code-owned.** Permission codes ship with the application. A
  tenant composes roles from these codes and cannot invent new ones
  (`INV-0006-02`).
- **Codes are stable IDs.** A code such as `receiving.receipt.post` is referenced by
  Convex functions, tests, seeds, and audit rows. Renaming one is a migration with a
  compatibility window, never a refactor (D-22).
- **Naming shape** is `domain.subject.action`, lower-case, dot-separated. `domain`
  matches a feature module; `action` is a verb in the imperative.
- **Fail closed.** An operation with no declared permission is denied
  (`INV-0006-01`).
- **Every check is server-side**, inside the transaction that performs the write
  (`INV-0006-03`).
- **Every check carries scope**: `(orgId, warehouseId?)` (`INV-0006-04`).

## 2. Catalogue

`Scope` column: `ORG` means the decision needs only the organization; `WH` means the
target warehouse participates in the decision.

### 2.1 Administration and access

| Permission code                | Scope | Guards                                                             | Extra policy           |
| ------------------------------ | ----- | ------------------------------------------------------------------ | ---------------------- |
| `admin.organization.read`      | ORG   | Read organization settings and entitlements                        | —                      |
| `admin.organization.update`    | ORG   | Change organization settings (timezone, locale, tolerances, flags) | Step-up                |
| `admin.membership.read`        | ORG   | List memberships and warehouse scopes                              | —                      |
| `admin.membership.invite`      | ORG   | Invite a user to the organization                                  | Step-up                |
| `admin.membership.update`      | ORG   | Change a membership's role, warehouse scope, or status             | Step-up                |
| `admin.membership.revoke`      | ORG   | End a membership                                                   | Step-up                |
| `admin.role.read`              | ORG   | Read roles and their permission composition                        | —                      |
| `admin.role.manage`            | ORG   | Create, edit, and delete roles                                     | Step-up, maker-checker |
| `admin.device.manage`          | ORG   | Register and retire devices                                        | —                      |
| `admin.audit.read`             | ORG   | Read audit events                                                  | —                      |
| `admin.supportGrant.read`      | ORG   | See support grants affecting this tenant                           | —                      |
| `admin.supportGrant.approve`   | ORG   | Approve a support grant for this tenant                            | Step-up, maker-checker |
| `admin.settings.policy.manage` | ORG   | Configure thresholds and maker-checker policy values               | Step-up, maker-checker |

### 2.2 Master data

| Permission code                | Scope | Guards                                          | Extra policy           |
| ------------------------------ | ----- | ----------------------------------------------- | ---------------------- |
| `masterData.item.read`         | ORG   | Read items, UOMs, barcodes, descriptions        | —                      |
| `masterData.item.manage`       | ORG   | Create and edit items, alternate UOMs, barcodes | —                      |
| `masterData.item.deactivate`   | ORG   | Deactivate an item                              | Maker-checker          |
| `masterData.supplier.read`     | ORG   | Read suppliers                                  | —                      |
| `masterData.supplier.manage`   | ORG   | Create and edit suppliers                       | —                      |
| `masterData.warehouse.read`    | ORG   | Read warehouses                                 | —                      |
| `masterData.warehouse.manage`  | ORG   | Create and edit warehouses                      | Step-up                |
| `masterData.location.read`     | WH    | Read locations and storage classes              | —                      |
| `masterData.location.manage`   | WH    | Create and edit locations, capacity, classes    | —                      |
| `masterData.location.reparent` | WH    | Move a location within the hierarchy            | Step-up, maker-checker |
| `masterData.lot.read`          | ORG   | Read lots                                       | —                      |
| `masterData.lot.manage`        | ORG   | Correct lot attributes (dates, codes)           | Maker-checker          |
| `masterData.reasonCode.manage` | ORG   | Manage reason codes                             | —                      |
| `masterData.import.execute`    | ORG   | Run a previewed master-data import              | —                      |
| `masterData.owner.manage`      | ORG   | Manage stock owners (disabled unless enabled)   | Step-up                |

### 2.3 Purchase orders

| Permission code            | Scope | Guards                                | Extra policy  |
| -------------------------- | ----- | ------------------------------------- | ------------- |
| `purchasing.po.read`       | WH    | Read purchase orders and lines        | —             |
| `purchasing.po.create`     | WH    | Author a purchase order               | —             |
| `purchasing.po.update`     | WH    | Edit an open purchase order           | —             |
| `purchasing.po.import`     | WH    | Import POs from CSV/XLSX with preview | —             |
| `purchasing.po.cancel`     | WH    | Cancel a purchase order or line       | Maker-checker |
| `purchasing.po.closeShort` | WH    | Under-close a PO line with a reason   | Threshold     |

### 2.4 Receiving

| Permission code                   | Scope | Guards                                                 | Extra policy             |
| --------------------------------- | ----- | ------------------------------------------------------ | ------------------------ |
| `receiving.receipt.read`          | WH    | Read receipts and receipt lines                        | —                        |
| `receiving.receipt.post`          | WH    | Post a receipt line (creates ledger postings)          | —                        |
| `receiving.receipt.overTolerance` | WH    | Post a receipt above configured over-receipt tolerance | Threshold, maker-checker |
| `receiving.receipt.unexpected`    | WH    | Receive an item not on the PO                          | Maker-checker            |
| `receiving.receipt.blind`         | WH    | Receive without a PO reference                         | Maker-checker            |
| `receiving.receipt.cancelLine`    | WH    | Cancel an unposted receipt line                        | —                        |
| `receiving.exception.manage`      | WH    | Record and resolve receipt exceptions                  | —                        |

### 2.5 Quality control

| Permission code               | Scope | Guards                                             | Extra policy           |
| ----------------------------- | ----- | -------------------------------------------------- | ---------------------- |
| `quality.profile.read`        | ORG   | Read QC profiles                                   | —                      |
| `quality.profile.manage`      | ORG   | Configure QC profiles and sampling                 | Step-up                |
| `quality.inspection.read`     | WH    | Read inspections, samples, and results             | —                      |
| `quality.inspection.execute`  | WH    | Record samples, measurements, and attachments      | —                      |
| `quality.disposition.submit`  | WH    | Propose release, quarantine, reject, scrap, rework | —                      |
| `quality.disposition.approve` | WH    | Approve a proposed disposition                     | Maker-checker, step-up |
| `quality.attachment.read`     | WH    | Download private QC evidence files                 | —                      |

### 2.6 Handling units and labels

| Permission code             | Scope | Guards                                     | Extra policy           |
| --------------------------- | ----- | ------------------------------------------ | ---------------------- |
| `handlingUnit.read`         | WH    | Read handling units and contents           | —                      |
| `handlingUnit.build`        | WH    | Create a handling unit from received stock | —                      |
| `handlingUnit.split`        | WH    | Split a handling unit                      | —                      |
| `handlingUnit.merge`        | WH    | Merge handling units                       | —                      |
| `handlingUnit.relabel`      | WH    | Issue a new LPN for a handling unit        | Maker-checker          |
| `handlingUnit.nest`         | WH    | Nest or unnest a handling unit (one level) | —                      |
| `handlingUnit.mixedContent` | WH    | Build mixed SKU/lot content (tenant flag)  | Threshold              |
| `label.template.read`       | ORG   | Read label templates and versions          | —                      |
| `label.template.manage`     | ORG   | Create and publish label template versions | Step-up, maker-checker |
| `label.print.execute`       | WH    | Print a label                              | —                      |
| `label.print.reprint`       | WH    | Reprint an existing label                  | —                      |

### 2.7 Putaway

| Permission code         | Scope | Guards                                       | Extra policy |
| ----------------------- | ----- | -------------------------------------------- | ------------ |
| `putaway.task.read`     | WH    | Read putaway tasks and recommendations       | —            |
| `putaway.task.claim`    | WH    | Claim a putaway task                         | —            |
| `putaway.task.confirm`  | WH    | Confirm a putaway movement                   | —            |
| `putaway.task.override` | WH    | Confirm to a location other than recommended | Threshold    |
| `putaway.policy.manage` | WH    | Configure putaway policies and preferences   | Step-up      |

### 2.8 Inventory

| Permission code                    | Scope | Guards                                                     | Extra policy                      |
| ---------------------------------- | ----- | ---------------------------------------------------------- | --------------------------------- |
| `inventory.balance.read`           | WH    | Read current balances                                      | —                                 |
| `inventory.history.read`           | WH    | Read ledger history for a bucket, item, lot, or HU         | —                                 |
| `inventory.statusChange.submit`    | WH    | Propose a stock-status reclassification                    | —                                 |
| `inventory.statusChange.approve`   | WH    | Approve a stock-status reclassification                    | Maker-checker                     |
| `inventory.transaction.reverse`    | WH    | Reverse a transaction with a reason code                   | Threshold, maker-checker, step-up |
| `inventory.negativeStock.override` | WH    | Post under an explicit negative-stock tenant policy (D-12) | Step-up, maker-checker            |

### 2.9 Reporting

| Permission code            | Scope | Guards                                   | Extra policy |
| -------------------------- | ----- | ---------------------------------------- | ------------ |
| `reporting.dashboard.read` | WH    | View dashboard widgets and occupancy map | —            |
| `reporting.export.execute` | WH    | Start an asynchronous export job         | —            |
| `reporting.export.read`    | WH    | Download a private export artifact       | —            |
| `reporting.jobRun.read`    | ORG   | Inspect job runs and dead letters        | —            |

### 2.10 Platform-only (never granted to tenant roles)

| Permission code                 | Scope    | Guards                                    | Extra policy                     |
| ------------------------------- | -------- | ----------------------------------------- | -------------------------------- |
| `platform.supportGrant.request` | PLATFORM | Request a support grant for a tenant      | Disabled by default (`ADR-0006`) |
| `platform.supportGrant.approve` | PLATFORM | Second approval for a write-capable grant | Two-person, disabled by default  |
| `platform.tenant.read`          | PLATFORM | Read tenant data under an enabled grant   | Read-only, time-boxed, audited   |
| `platform.tenant.write`         | PLATFORM | Write under an enabled grant              | Two approvals required           |

## 3. Seeded default roles

Seeds are idempotent and editable by the tenant after creation
(`INV-0006-11`, D-22). Role keys are stable IDs.

| Role key            | Intended holder              | Default warehouse scope |
| ------------------- | ---------------------------- | ----------------------- |
| `ORG_ADMIN`         | Tenant administrator         | All warehouses          |
| `WAREHOUSE_MANAGER` | Site manager                 | Assigned warehouses     |
| `SUPERVISOR`        | Shift supervisor / approver  | Assigned warehouses     |
| `RECEIVER`          | Inbound operator (handheld)  | Assigned warehouses     |
| `QC_INSPECTOR`      | Quality inspector            | Assigned warehouses     |
| `PUTAWAY_OPERATOR`  | Putaway operator (handheld)  | Assigned warehouses     |
| `INVENTORY_ANALYST` | Inventory / planning analyst | Assigned warehouses     |
| `VIEWER`            | Read-only stakeholder        | Assigned warehouses     |

### 3.1 Default mapping

`Y` = granted by default. Blank = not granted. Platform-only permissions appear in
no tenant role.

| Permission                         | ORG_ADMIN | WAREHOUSE_MANAGER | SUPERVISOR | RECEIVER | QC_INSPECTOR | PUTAWAY_OPERATOR | INVENTORY_ANALYST | VIEWER |
| ---------------------------------- | --------- | ----------------- | ---------- | -------- | ------------ | ---------------- | ----------------- | ------ |
| `admin.organization.read`          | Y         | Y                 |            |          |              |                  |                   |        |
| `admin.organization.update`        | Y         |                   |            |          |              |                  |                   |        |
| `admin.membership.read`            | Y         | Y                 | Y          |          |              |                  |                   |        |
| `admin.membership.invite`          | Y         | Y                 |            |          |              |                  |                   |        |
| `admin.membership.update`          | Y         | Y                 |            |          |              |                  |                   |        |
| `admin.membership.revoke`          | Y         |                   |            |          |              |                  |                   |        |
| `admin.role.read`                  | Y         | Y                 |            |          |              |                  |                   |        |
| `admin.role.manage`                | Y         |                   |            |          |              |                  |                   |        |
| `admin.device.manage`              | Y         | Y                 |            |          |              |                  |                   |        |
| `admin.audit.read`                 | Y         | Y                 | Y          |          |              |                  | Y                 |        |
| `admin.supportGrant.read`          | Y         | Y                 |            |          |              |                  |                   |        |
| `admin.supportGrant.approve`       | Y         |                   |            |          |              |                  |                   |        |
| `admin.settings.policy.manage`     | Y         |                   |            |          |              |                  |                   |        |
| `masterData.item.read`             | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |
| `masterData.item.manage`           | Y         | Y                 |            |          |              |                  |                   |        |
| `masterData.item.deactivate`       | Y         | Y                 |            |          |              |                  |                   |        |
| `masterData.supplier.read`         | Y         | Y                 | Y          | Y        | Y            |                  | Y                 | Y      |
| `masterData.supplier.manage`       | Y         | Y                 |            |          |              |                  |                   |        |
| `masterData.warehouse.read`        | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |
| `masterData.warehouse.manage`      | Y         |                   |            |          |              |                  |                   |        |
| `masterData.location.read`         | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |
| `masterData.location.manage`       | Y         | Y                 |            |          |              |                  |                   |        |
| `masterData.location.reparent`     | Y         | Y                 |            |          |              |                  |                   |        |
| `masterData.lot.read`              | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |
| `masterData.lot.manage`            | Y         | Y                 | Y          |          |              |                  |                   |        |
| `masterData.reasonCode.manage`     | Y         | Y                 |            |          |              |                  |                   |        |
| `masterData.import.execute`        | Y         | Y                 |            |          |              |                  |                   |        |
| `masterData.owner.manage`          | Y         |                   |            |          |              |                  |                   |        |
| `purchasing.po.read`               | Y         | Y                 | Y          | Y        |              |                  | Y                 | Y      |
| `purchasing.po.create`             | Y         | Y                 | Y          |          |              |                  |                   |        |
| `purchasing.po.update`             | Y         | Y                 | Y          |          |              |                  |                   |        |
| `purchasing.po.import`             | Y         | Y                 |            |          |              |                  |                   |        |
| `purchasing.po.cancel`             | Y         | Y                 |            |          |              |                  |                   |        |
| `purchasing.po.closeShort`         | Y         | Y                 | Y          |          |              |                  |                   |        |
| `receiving.receipt.read`           | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |
| `receiving.receipt.post`           | Y         | Y                 | Y          | Y        |              |                  |                   |        |
| `receiving.receipt.overTolerance`  | Y         | Y                 | Y          |          |              |                  |                   |        |
| `receiving.receipt.unexpected`     | Y         | Y                 | Y          |          |              |                  |                   |        |
| `receiving.receipt.blind`          | Y         | Y                 |            |          |              |                  |                   |        |
| `receiving.receipt.cancelLine`     | Y         | Y                 | Y          | Y        |              |                  |                   |        |
| `receiving.exception.manage`       | Y         | Y                 | Y          | Y        |              |                  |                   |        |
| `quality.profile.read`             | Y         | Y                 | Y          |          | Y            |                  | Y                 |        |
| `quality.profile.manage`           | Y         | Y                 |            |          |              |                  |                   |        |
| `quality.inspection.read`          | Y         | Y                 | Y          | Y        | Y            |                  | Y                 | Y      |
| `quality.inspection.execute`       | Y         | Y                 | Y          |          | Y            |                  |                   |        |
| `quality.disposition.submit`       | Y         | Y                 | Y          |          | Y            |                  |                   |        |
| `quality.disposition.approve`      | Y         | Y                 | Y          |          |              |                  |                   |        |
| `quality.attachment.read`          | Y         | Y                 | Y          |          | Y            |                  | Y                 |        |
| `handlingUnit.read`                | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |
| `handlingUnit.build`               | Y         | Y                 | Y          | Y        |              |                  |                   |        |
| `handlingUnit.split`               | Y         | Y                 | Y          | Y        |              | Y                |                   |        |
| `handlingUnit.merge`               | Y         | Y                 | Y          | Y        |              | Y                |                   |        |
| `handlingUnit.relabel`             | Y         | Y                 | Y          |          |              |                  |                   |        |
| `handlingUnit.nest`                | Y         | Y                 | Y          | Y        |              | Y                |                   |        |
| `handlingUnit.mixedContent`        | Y         | Y                 |            |          |              |                  |                   |        |
| `label.template.read`              | Y         | Y                 | Y          |          |              |                  |                   |        |
| `label.template.manage`            | Y         |                   |            |          |              |                  |                   |        |
| `label.print.execute`              | Y         | Y                 | Y          | Y        | Y            | Y                |                   |        |
| `label.print.reprint`              | Y         | Y                 | Y          | Y        |              | Y                |                   |        |
| `putaway.task.read`                | Y         | Y                 | Y          | Y        |              | Y                | Y                 | Y      |
| `putaway.task.claim`               | Y         | Y                 | Y          | Y        |              | Y                |                   |        |
| `putaway.task.confirm`             | Y         | Y                 | Y          | Y        |              | Y                |                   |        |
| `putaway.task.override`            | Y         | Y                 | Y          |          |              | Y                |                   |        |
| `putaway.policy.manage`            | Y         | Y                 |            |          |              |                  |                   |        |
| `inventory.balance.read`           | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |
| `inventory.history.read`           | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |
| `inventory.statusChange.submit`    | Y         | Y                 | Y          |          | Y            |                  | Y                 |        |
| `inventory.statusChange.approve`   | Y         | Y                 | Y          |          |              |                  |                   |        |
| `inventory.transaction.reverse`    | Y         | Y                 |            |          |              |                  |                   |        |
| `inventory.negativeStock.override` | Y         |                   |            |          |              |                  |                   |        |
| `reporting.dashboard.read`         | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |
| `reporting.export.execute`         | Y         | Y                 | Y          |          |              |                  | Y                 |        |
| `reporting.export.read`            | Y         | Y                 | Y          |          |              |                  | Y                 |        |
| `reporting.jobRun.read`            | Y         | Y                 |            |          |              |                  |                   |        |

Notes on the mapping:

- `RECEIVER` and `PUTAWAY_OPERATOR` deliberately hold no approval permission, so
  maker-checker cannot collapse into one person on a handheld.
- `SUPERVISOR` can approve dispositions and status changes but cannot reverse ledger
  transactions; reversal stays with `WAREHOUSE_MANAGER` and `ORG_ADMIN`.
- `inventory.negativeStock.override` is granted only to `ORG_ADMIN` and only has
  effect if the tenant policy in D-12 is explicitly enabled.
- `VIEWER` holds read permissions only, including no attachment access, because QC
  photos may contain incidental personal data.

## 4. Policy semantics

### 4.1 Warehouse scope

- A membership is either organization-wide or scoped to an explicit warehouse set
  (§5 Q13).
- The decision input is `(actor, permission, orgId, warehouseId?)`. An operation
  targeting a warehouse outside the actor's scope is denied even if the role grants
  the permission (`INV-0006-04`).
- Scope is resolved from mirrored membership rows, never from a client claim
  ([ADR-0001](./adr/0001-multi-tenant-saas-and-identity-ownership.md)).
- Adding a warehouse to a membership never removes access to another (monotonicity;
  a property test).

### 4.2 Threshold policies

- A threshold policy attaches a numeric limit to a permission per warehouse: for
  example over-receipt tolerance percentage, override count per shift, or reversal
  value ceiling.
- The compared value is always computed server-side from stored data
  (`INV-0006-06`).
- Exceeding a threshold does not silently fail: the operation returns a structured,
  translatable denial naming the policy, and where a maker-checker path exists it
  offers submission for approval.

### 4.3 Maker-checker

- Applies to the operations marked `Maker-checker` in §2.
- The flow is submit → pending approval → approve or reject. Each step is its own
  audited transaction; approval posts the ledger effect.
- The approving actor must differ from the submitting actor (`INV-0006-05`). Holding
  both permissions does not permit self-approval.
- A pending item is visible to every actor holding the approving permission in the
  target warehouse.
- Rejection requires a reason code and leaves no inventory effect.
- Pending items expire per policy; expiry is audited and posts nothing.

### 4.4 Step-up reverification

- Operations marked `Step-up` require a Clerk reverification whose age is below the
  configured freshness window, verified server-side (`INV-0006-07`).
- Freshness is checked at the moment of the write, not at screen entry.
- Shared handhelds never carry step-up implicitly; privileged flows are designed for
  the desktop shell (D-02).

### 4.5 Support grants (disabled by default)

- With no enabled grant, application code has no cross-tenant read or write path
  (`INV-0006-08`).
- Enabling requires: an approved request with reason and ticket, an expiry, and
  read-only default. Any write capability needs two distinct platform approvals plus
  tenant approval via `admin.supportGrant.approve`.
- Every access under a grant is audited, attributed to the platform actor, and
  visible to the tenant (`INV-0006-09`).
- Grants expire automatically; there is no indefinite grant.
- Procedure: [support access runbook](./runbooks/support-access.md). Policy
  confirmation is gate `RG-015`.

### 4.6 Denials

- Every denial is audited with actor, permission, target, scope, and reason
  (`INV-0006-10`).
- Denial reasons distinguish "no permission", "out of warehouse scope", "threshold
  exceeded", "approval required", and "reverification required", because operators
  need to know which one applies.

## 5. Verification obligations

Every row in §2 becomes a test case: an actor with the permission succeeds, an actor
without it is denied, and an actor with it but outside warehouse scope is denied.
Maker-checker rows add a self-approval rejection case; step-up rows add a stale
reverification case. See
[ADR-0006 verification](./adr/0006-authorization-and-support-access.md#verification)
and the [coverage matrix](./specification-coverage.md).

## 6. Open items

- `RG-024` Catalogue review with the pilot tenant (§5 Q14).
- `RG-015` Support-access policy confirmation, including whether grants are enabled
  at all during the pilot (§5 Q15).
- `RG-030` Shared-device and privileged-session policy, including session lifetimes
  (§5 Q16).
- Threshold defaults per warehouse are unset; they need pilot values before Phase 3
  (§5 Q26).
