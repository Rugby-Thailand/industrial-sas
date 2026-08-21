# Permission catalogue, seeded roles, and policy semantics

Status: **partially implemented.** `convex/lib/permissions.ts` is the code-owned
catalogue and fail-closed pure policy evaluator. Organization provisioning seeds the
catalogue, twelve editable default roles, and their mappings idempotently in the same
transaction; reruns preserve tenant edits. Enforcement is live in the public Convex
wrappers: a function that does not declare a code-owned, non-`PLATFORM` permission
cannot be registered, the decision is made server-side from the active tenant's own
rows, and each attempt is appended to `auditEvents` except on a query, which cannot
write (`RG-071`). What remains: the threshold and maker-checker _policy values_
(§5 Q26), the administration UI, and the feature functions the catalogue exists to
guard. Inventory, inbound, reporting, and Phase 5A order-to-ship operations are live;
later factory-order, execution, shipment, and administration surfaces remain. This
document remains the review contract
required by [ADR-0006](./adr/0006-authorization-and-support-access.md).

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
  (`INV-0006-01`). Enforced earlier than that in practice: a public Convex function
  that declares no code-owned, non-`PLATFORM` permission cannot be _registered_, and
  `pnpm verify:tenant-boundary` fails the build if one is written.
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
| `admin.device.read`            | ORG   | Read the device registry and installation bindings                 | —                      |
| `admin.device.manage`          | ORG   | Register, rename, and retire devices                               | —                      |
| `admin.audit.read`             | ORG   | Read audit events                                                  | —                      |
| `admin.supportGrant.read`      | ORG   | See support grants affecting this tenant                           | —                      |
| `admin.supportGrant.approve`   | ORG   | Approve a support grant for this tenant                            | Step-up, maker-checker |
| `admin.settings.policy.manage` | ORG   | Configure thresholds and maker-checker policy values               | Step-up, maker-checker |

### 2.2 Master data

| Permission code                  | Scope | Guards                                          | Extra policy           |
| -------------------------------- | ----- | ----------------------------------------------- | ---------------------- |
| `masterData.item.read`           | ORG   | Read items, UOMs, barcodes, descriptions        | —                      |
| `masterData.item.manage`         | ORG   | Create and edit items, alternate UOMs, barcodes | —                      |
| `masterData.item.deactivate`     | ORG   | Deactivate an item                              | Maker-checker          |
| `masterData.supplier.read`       | ORG   | Read suppliers                                  | —                      |
| `masterData.supplier.manage`     | ORG   | Create and edit suppliers                       | —                      |
| `masterData.warehouse.read`      | ORG   | Read warehouses                                 | —                      |
| `masterData.warehouse.manage`    | ORG   | Create and edit warehouses                      | Step-up                |
| `masterData.location.read`       | WH    | Read locations                                  | —                      |
| `masterData.location.manage`     | WH    | Create and edit locations and their capacity    | —                      |
| `masterData.storageClass.read`   | ORG   | Read storage classes                            | —                      |
| `masterData.storageClass.manage` | ORG   | Create and edit storage classes                 | —                      |
| `masterData.location.reparent`   | WH    | Move a location within the hierarchy            | Step-up, maker-checker |
| `masterData.lot.read`            | ORG   | Read lots                                       | —                      |
| `masterData.lot.create`          | ORG   | Create a lot while receiving                    | —                      |
| `masterData.lot.manage`          | ORG   | Correct lot attributes (dates, codes)           | Maker-checker          |
| `masterData.reasonCode.read`     | ORG   | Read reason codes                               | —                      |
| `masterData.reasonCode.manage`   | ORG   | Manage reason codes                             | —                      |
| `masterData.import.execute`      | ORG   | Run a previewed master-data import              | —                      |
| `masterData.owner.read`          | ORG   | Read stock owners (disabled unless enabled)     | —                      |
| `masterData.owner.manage`        | ORG   | Manage stock owners (disabled unless enabled)   | Step-up                |

### 2.3 Sales, engineering, and production hand-off

The order-to-ship slice ([ADR-0013](./adr/0013-order-to-ship-design-authority.md)).
Three domains rather than one, because the separation between them is the control:
sales commits to a customer, engineering decides what gets made, production issues
the packet that reaches a machine. A role that spans two of them can approve its own
work.

`sales.*` guards **customer** orders and never touches `purchaseOrders`, which is
the supplier side of the business (§2.4). `engineering.masterCard.read` covers every
revision including drafts — which is why no production role holds it, and why a
factory packet carries its own snapshot of the released specification instead.

| Permission code                     | Scope | Guards                                                   | Extra policy           |
| ----------------------------------- | ----- | -------------------------------------------------------- | ---------------------- |
| `sales.customer.read`               | ORG   | Read customers                                           | —                      |
| `sales.customer.manage`             | ORG   | Create and edit customers                                | —                      |
| `sales.order.read`                  | ORG   | Read customer orders and their lines                     | —                      |
| `sales.order.create`                | ORG   | Raise a customer order                                   | —                      |
| `sales.order.update`                | ORG   | Add and edit lines on a draft order                      | —                      |
| `sales.order.release`               | ORG   | Commit a draft order to the customer                     | —                      |
| `sales.order.cancel`                | ORG   | Cancel a customer order                                  | Maker-checker          |
| `fulfillment.order.read`            | WH    | Read available-stock fulfillment orders and lines        | —                      |
| `fulfillment.order.manage`          | WH    | Create and configure warehouse fulfillment               | —                      |
| `fulfillment.order.release`         | WH    | Release configured demand for allocation                 | —                      |
| `fulfillment.atp.read`              | WH    | Read explainable available-to-promise quantities         | —                      |
| `fulfillment.reservation.allocate`  | WH    | Allocate eligible FIFO/FEFO stock to released demand     | —                      |
| `fulfillment.reservation.release`   | WH    | Explicitly release, expire, or cancel reserved stock     | —                      |
| `fulfillment.pick.read`             | WH    | Read waves, tasks, scan evidence, and packages           | —                      |
| `fulfillment.pick.plan`             | WH    | Create and release bounded pick waves                    | —                      |
| `fulfillment.pick.execute`          | WH    | Record exact pick, short, and damage evidence            | —                      |
| `fulfillment.pick.check`            | WH    | Independently check a submitted pick                     | Maker-checker          |
| `fulfillment.pick.pack`             | WH    | Pack a checked pick into a traceable package             | —                      |
| `fulfillment.pick.stage`            | WH    | Confirm a package at an outbound staging location        | —                      |
| `fulfillment.pick.issue`            | WH    | Post staged stock to the customer shipment boundary      | —                      |
| `fulfillment.pick.reverse`          | WH    | Reverse an issued fulfillment transaction                | Step-up, maker-checker |
| `fulfillment.shipment.read`         | WH    | Read shipment manifests and delivery state               | —                      |
| `fulfillment.shipment.manage`       | WH    | Create and release issued-package shipment manifests     | —                      |
| `fulfillment.transport.read`        | WH    | Read trips, load progress, gate evidence, and milestones | —                      |
| `fulfillment.transport.plan`        | WH    | Create, assign, and release vehicle trips                | —                      |
| `fulfillment.transport.load`        | WH    | Start loading, scan packages, and seal a complete load   | —                      |
| `fulfillment.transport.gate`        | WH    | Release a sealed trip through the warehouse gate         | Maker-checker          |
| `fulfillment.transport.deliver`     | WH    | Depart and record delivery or failure milestones         | —                      |
| `fulfillment.pod.read`              | WH    | Read private proof-of-delivery metadata and files        | —                      |
| `fulfillment.pod.capture`           | WH    | Upload and capture recipient delivery evidence           | —                      |
| `fulfillment.pod.review`            | WH    | Independently accept or reject captured POD              | Maker-checker          |
| `fulfillment.documentReturn.manage` | WH    | Record return of signed original delivery documents      | —                      |
| `transfer.request.read`             | WH    | Read source or destination warehouse transfers           | —                      |
| `transfer.request.manage`           | WH    | Create transfer requests and requested lines             | —                      |
| `transfer.request.approve`          | WH    | Approve a transfer before source dispatch                | Maker-checker          |
| `transfer.dispatch`                 | WH    | Post source stock into the in-transit boundary           | —                      |
| `transfer.receive`                  | WH    | Receive dispatched stock at the destination              | —                      |
| `transfer.discrepancy.manage`       | WH    | Own and resolve transfer quantity discrepancies          | —                      |
| `transfer.replenishment.read`       | WH    | Read explainable replenishment proposals                 | —                      |
| `engineering.request.read`          | ORG   | Read the design queue                                    | —                      |
| `engineering.request.assign`        | ORG   | Take or assign a design request                          | —                      |
| `engineering.masterCard.read`       | ORG   | Read master cards and every revision, including drafts   | —                      |
| `engineering.masterCard.draft`      | ORG   | Create a card and draft a revision                       | —                      |
| `engineering.masterCard.submit`     | ORG   | Submit a draft revision for review                       | —                      |
| `engineering.masterCard.release`    | ORG   | Approve or reject a revision under review                | Maker-checker          |
| `engineering.file.read`             | ORG   | Request access to an attached dieline, artwork, or photo | —                      |
| `engineering.file.attach`           | ORG   | Attach a file to a draft revision                        | —                      |
| `production.packet.read`            | WH    | Read factory packets at a site                           | —                      |
| `production.packet.issue`           | WH    | Issue a packet for a design-ready line                   | —                      |
| `production.packet.acknowledge`     | WH    | Acknowledge a packet on the floor                        | —                      |
| `production.order.read`             | WH    | Read production orders at a site                         | —                      |
| `production.order.manage`           | WH    | Create and maintain draft production orders              | —                      |
| `production.order.release`          | WH    | Independently release a pinned production order          | Maker-checker          |
| `production.material.issue`         | WH    | Issue pinned material quantities to production           | —                      |
| `production.operation.report`       | WH    | Report good, scrap, rework, and downtime                 | —                      |
| `production.output.receive`         | WH    | Receive reported output into QC hold                     | —                      |
| `production.quality.decide`         | WH    | Independently release or reject production output        | Maker-checker          |

### 2.4 Purchase orders

| Permission code            | Scope | Guards                                | Extra policy  |
| -------------------------- | ----- | ------------------------------------- | ------------- |
| `purchasing.po.read`       | WH    | Read purchase orders and lines        | —             |
| `purchasing.po.create`     | WH    | Author a purchase order               | —             |
| `purchasing.po.update`     | WH    | Edit an open purchase order           | —             |
| `purchasing.po.import`     | WH    | Import POs from CSV/XLSX with preview | —             |
| `purchasing.po.cancel`     | WH    | Cancel a purchase order or line       | Maker-checker |
| `purchasing.po.closeShort` | WH    | Under-close a PO line with a reason   | Threshold     |

### 2.5 Receiving

| Permission code                   | Scope | Guards                                                 | Extra policy             |
| --------------------------------- | ----- | ------------------------------------------------------ | ------------------------ |
| `receiving.receipt.read`          | WH    | Read receipts and receipt lines                        | —                        |
| `receiving.receipt.post`          | WH    | Post a receipt line (creates ledger postings)          | —                        |
| `receiving.receipt.overTolerance` | WH    | Post a receipt above configured over-receipt tolerance | Threshold, maker-checker |
| `receiving.receipt.unexpected`    | WH    | Receive an item not on the PO                          | Maker-checker            |
| `receiving.receipt.blind`         | WH    | Receive without a PO reference                         | Maker-checker            |
| `receiving.receipt.cancelLine`    | WH    | Cancel an unposted receipt line                        | —                        |
| `receiving.exception.manage`      | WH    | Record and resolve receipt exceptions                  | —                        |

### 2.6 Quality control

| Permission code               | Scope | Guards                                             | Extra policy           |
| ----------------------------- | ----- | -------------------------------------------------- | ---------------------- |
| `quality.profile.read`        | ORG   | Read QC profiles                                   | —                      |
| `quality.profile.manage`      | ORG   | Configure QC profiles and sampling                 | Step-up                |
| `quality.inspection.read`     | WH    | Read inspections, samples, and results             | —                      |
| `quality.inspection.execute`  | WH    | Record samples, measurements, and attachments      | —                      |
| `quality.disposition.submit`  | WH    | Propose release, quarantine, reject, scrap, rework | —                      |
| `quality.disposition.approve` | WH    | Approve a proposed disposition                     | Maker-checker, step-up |
| `quality.attachment.read`     | WH    | Download private QC evidence files                 | —                      |

### 2.7 Handling units and labels

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
| `label.template.draft`      | ORG   | Author a DRAFT template version            | —                      |
| `label.template.manage`     | ORG   | Publish or retire a template version       | Step-up, maker-checker |
| `label.print.read`          | WH    | Read generated label payloads and evidence | —                      |
| `label.print.execute`       | WH    | Generate a label payload                   | —                      |
| `label.print.reprint`       | WH    | Reprint an existing label                  | —                      |

### 2.8 Putaway

| Permission code         | Scope | Guards                                       | Extra policy |
| ----------------------- | ----- | -------------------------------------------- | ------------ |
| `putaway.task.read`     | WH    | Read putaway tasks and recommendations       | —            |
| `putaway.task.claim`    | WH    | Claim a putaway task                         | —            |
| `putaway.task.confirm`  | WH    | Confirm a putaway movement                   | —            |
| `putaway.task.override` | WH    | Confirm to a location other than recommended | Threshold    |
| `putaway.policy.manage` | WH    | Configure putaway policies and preferences   | Step-up      |

### 2.9 Inventory

| Permission code                    | Scope | Guards                                                     | Extra policy                      |
| ---------------------------------- | ----- | ---------------------------------------------------------- | --------------------------------- |
| `inventory.balance.read`           | WH    | Read current balances                                      | —                                 |
| `inventory.history.read`           | WH    | Read ledger history for a bucket, item, lot, or HU         | —                                 |
| `inventory.transaction.post`       | WH    | Post a balanced inventory ledger transaction               | —                                 |
| `inventory.opening.read`           | WH    | Read opening-stock imports, validation, and posting links  | —                                 |
| `inventory.opening.manage`         | WH    | Create, map, validate, submit, or reject an opening import | —                                 |
| `inventory.opening.approve`        | WH    | Approve an opening-stock import                            | Step-up, maker-checker            |
| `inventory.opening.post`           | WH    | Post an approved opening import through the ledger         | Step-up                           |
| `inventory.count.read`             | WH    | Read count plans, assigned tasks, and permitted evidence   | —                                 |
| `inventory.count.plan`             | WH    | Build, release, cancel, and monitor count plans            | —                                 |
| `inventory.count.execute`          | WH    | Capture and submit blind or visible physical counts        | —                                 |
| `inventory.count.reconcile`        | WH    | Request recounts and prepare variance decisions            | —                                 |
| `inventory.count.approve`          | WH    | Approve high-risk count adjustments                        | Threshold, maker-checker, step-up |
| `inventory.statusChange.submit`    | WH    | Propose a stock-status reclassification                    | —                                 |
| `inventory.statusChange.approve`   | WH    | Approve a stock-status reclassification                    | Maker-checker                     |
| `inventory.transaction.reverse`    | WH    | Reverse a transaction with a reason code                   | Threshold, maker-checker, step-up |
| `inventory.negativeStock.override` | WH    | Post under an explicit negative-stock tenant policy (D-12) | Step-up, maker-checker            |

### 2.10 Human resources

HR is deliberately not inherited from system administration. `ORG_ADMIN` receives
only the four self-service codes; team, employment, period-close, and payroll access
must be composed into an explicit tenant HR role. The seeded site manager and
supervisor can decide site requests, but list responses omit private leave reasons.

| Permission code              | Scope | Guards                                                   | Extra policy           |
| ---------------------------- | ----- | -------------------------------------------------------- | ---------------------- |
| `hr.self.read`               | ORG   | Read the actor's own employment, time, and leave history | —                      |
| `hr.self.attendance.record`  | WH    | Record the actor's own clock and break event             | —                      |
| `hr.self.correction.request` | WH    | Request a correction to the actor's own day              | —                      |
| `hr.self.leave.request`      | WH    | Submit or cancel the actor's own leave request           | —                      |
| `hr.team.read`               | WH    | Read capacity-safe attendance and request facts at site  | —                      |
| `hr.team.correction.decide`  | WH    | Approve or reject another employee's correction          | Maker-checker          |
| `hr.team.leave.decide`       | WH    | Approve or reject another employee's leave               | Maker-checker          |
| `hr.admin.employee.manage`   | ORG   | Manage employee identity, team, and employment history   | Step-up                |
| `hr.admin.period.close`      | ORG   | Close an attendance period after exception review        | Step-up, maker-checker |
| `hr.payroll.read`            | ORG   | Read payroll-oriented attendance outputs                 | —                      |

### 2.11 Integration delivery

| Permission code                 | Scope | Guards                                                       | Extra policy |
| ------------------------------- | ----- | ------------------------------------------------------------ | ------------ |
| `integration.health.read`       | ORG   | Read bounded adapter health, queue counts, and safe failures | —            |
| `integration.adapter.manage`    | ORG   | Enable or disable a configured adapter                       | Step-up      |
| `integration.delivery.dispatch` | ORG   | Claim and record one adapter delivery attempt                | —            |
| `integration.delivery.retry`    | ORG   | Return a dead-lettered or delayed message to the retry queue | —            |

### 2.12 Reporting

| Permission code            | Scope | Guards                                   | Extra policy |
| -------------------------- | ----- | ---------------------------------------- | ------------ |
| `reporting.dashboard.read` | WH    | View dashboard widgets and occupancy map | —            |
| `reporting.export.execute` | WH    | Start an asynchronous export job         | —            |
| `reporting.export.read`    | WH    | Download a private export artifact       | —            |
| `reporting.jobRun.read`    | ORG   | Inspect job runs and dead letters        | —            |

### 2.13 Shared operator work

Phase 1's shared task contract (`FF-P1-09`–`FF-P1-11`). Warehouse-scoped, because
a task belongs to a site: an organization-wide code would let an actor with no
membership at that site claim its backlog (`INV-0006-04`).

`work.stepUp.approve` carries step-up **and** maker-checker. Step-up makes the
evaluator demand fresh Clerk reverification of the approver before an approval can
be minted; maker-checker makes it refuse an approver who is the operator. The
approval it mints is single-use and bound to organization, operation, target,
operator, and device — it is never a reusable elevated browser scope (plan §4
invariant 19).

`work.exception.resolve` carries maker-checker. The exception row supplies the
reporter as the maker, so the authorization boundary refuses self-resolution before
the handler can change the decision. The proposed disposition and recovery action
remain stored beside the supervisor's final decision.

Task attachments separate metadata discovery from byte access. `work.attachment.read`
must be re-evaluated for every one-use download grant; no stored provider URL is
rendered or returned by the list query. `work.attachment.attach` additionally checks
that the uploader still owns a live task lease before it mints or consumes an upload
capability.

| Permission code          | Scope | Guards                                                      | Extra policy           |
| ------------------------ | ----- | ----------------------------------------------------------- | ---------------------- |
| `work.task.read`         | WH    | Read the site's work board and My work                      | —                      |
| `work.task.manage`       | WH    | Create and cancel assigned work                             | —                      |
| `work.task.claim`        | WH    | Claim a task and hold its lease                             | —                      |
| `work.task.complete`     | WH    | Complete a task the actor holds                             | —                      |
| `work.task.reassign`     | WH    | Move a task to another operator, keeping partial evidence   | —                      |
| `work.evidence.record`   | WH    | Append quantity, scan, or note evidence to a held task      | —                      |
| `work.attachment.read`   | WH    | Request a one-use download for private task evidence        | —                      |
| `work.attachment.attach` | WH    | Upload verified private evidence while holding the task     | —                      |
| `work.exception.report`  | WH    | Raise a task exception with evidence and proposed recovery  | —                      |
| `work.exception.resolve` | WH    | Decide a task exception as somebody other than its reporter | Maker-checker          |
| `work.stepUp.approve`    | WH    | Approve an operator's blocked action on the operator device | Step-up, maker-checker |
| `work.device.seen`       | WH    | Record that a registered device is still in service         | —                      |

### 2.14 Platform-only (never granted to tenant roles)

| Permission code                 | Scope    | Guards                                    | Extra policy                     |
| ------------------------------- | -------- | ----------------------------------------- | -------------------------------- |
| `platform.supportGrant.request` | PLATFORM | Request a support grant for a tenant      | Disabled by default (`ADR-0006`) |
| `platform.supportGrant.approve` | PLATFORM | Second approval for a write-capable grant | Two-person, disabled by default  |
| `platform.tenant.read`          | PLATFORM | Read tenant data under an enabled grant   | Read-only, time-boxed, audited   |
| `platform.tenant.write`         | PLATFORM | Write under an enabled grant              | Two approvals required           |

## 3. Seeded default roles

Seeds are idempotent and editable by the tenant after creation
(`INV-0006-11`, D-22). Role keys are stable IDs.

Implemented behaviour, stated because the limit is deliberate: the seed runs inside
the transaction that inserts the organization, so a tenant never exists without its
roles, and a failed provisioning leaves neither. A rerun that finds a role by
`(orgId, key)` leaves that role and its composition exactly as the tenant left
them — it repairs nothing it did not create, because a repair would silently undo a
deliberate edit. The consequence is that a release adding a catalogue code does not
add it to the roles of an organization that already exists; distributing a new code
to existing tenants is a migration under D-22, not a reseed. Enforcement is
unaffected: decisions read the code-owned catalogue in `convex/lib/permissions.ts`,
not the `permissions` table, which is reference data for administration and audit.

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

The four order-to-ship roles are separate rather than folded into the warehouse
roles, because separating them is how the slice's two rules are held. `ENGINEER`
draws and submits but cannot release; `ENGINEERING_APPROVER` releases but holds
neither `draft` nor `submit`, so a checker cannot first become a maker.
`PRODUCTION_PLANNER` holds no `engineering.*` code at all — an unreleased revision
must never reach the floor, and the packet's own snapshot is what makes those narrow
permissions sufficient. `SALES_CUSTOMER_SERVICE` can read which revision an order is
pinned to but holds no `engineering.file.read`: a customer-facing role holding
artwork is how another customer's artwork leaves the building.

| Role key                 | Intended holder             | Default warehouse scope |
| ------------------------ | --------------------------- | ----------------------- |
| `SALES_CUSTOMER_SERVICE` | Sales / customer service    | All warehouses          |
| `ENGINEER`               | Design engineer             | All warehouses          |
| `ENGINEERING_APPROVER`   | Engineering lead / approver | All warehouses          |
| `PRODUCTION_PLANNER`     | Production planner          | Assigned warehouses     |

### 3.1 Default mapping

`Y` = granted by default. Blank = not granted. Platform-only permissions appear in
no tenant role.

| Permission                          | ORG_ADMIN | WAREHOUSE_MANAGER | SUPERVISOR | RECEIVER | QC_INSPECTOR | PUTAWAY_OPERATOR | INVENTORY_ANALYST | VIEWER | SALES_CUSTOMER_SERVICE | ENGINEER | ENGINEERING_APPROVER | PRODUCTION_PLANNER |
| ----------------------------------- | --------- | ----------------- | ---------- | -------- | ------------ | ---------------- | ----------------- | ------ | ---------------------- | -------- | -------------------- | ------------------ |
| `admin.organization.read`           | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.organization.update`         | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.membership.read`             | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.membership.invite`           | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.membership.update`           | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.membership.revoke`           | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.role.read`                   | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.role.manage`                 | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.device.read`                 | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.device.manage`               | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.audit.read`                  | Y         | Y                 | Y          |          |              |                  | Y                 |        |                        |          |                      |                    |
| `admin.supportGrant.read`           | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.supportGrant.approve`        | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `admin.settings.policy.manage`      | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.item.read`              | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `masterData.item.manage`            | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.item.deactivate`        | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.supplier.read`          | Y         | Y                 | Y          | Y        | Y            |                  | Y                 | Y      |                        |          |                      |                    |
| `masterData.supplier.manage`        | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.warehouse.read`         | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      | Y                      | Y        | Y                    | Y                  |
| `masterData.warehouse.manage`       | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.location.read`          | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `masterData.location.manage`        | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.storageClass.read`      | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `masterData.storageClass.manage`    | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.location.reparent`      | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.lot.read`               | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `masterData.lot.create`             | Y         | Y                 | Y          | Y        |              |                  |                   |        |                        |          |                      |                    |
| `masterData.lot.manage`             | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.reasonCode.read`        | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `masterData.reasonCode.manage`      | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.import.execute`         | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.owner.read`             | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `masterData.owner.manage`           | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `sales.customer.read`               | Y         | Y                 |            |          |              |                  |                   |        | Y                      | Y        | Y                    | Y                  |
| `sales.customer.manage`             | Y         |                   |            |          |              |                  |                   |        | Y                      |          |                      |                    |
| `sales.order.read`                  | Y         | Y                 |            |          |              |                  |                   |        | Y                      | Y        | Y                    | Y                  |
| `sales.order.create`                | Y         |                   |            |          |              |                  |                   |        | Y                      |          |                      |                    |
| `sales.order.update`                | Y         |                   |            |          |              |                  |                   |        | Y                      |          |                      |                    |
| `sales.order.release`               | Y         |                   |            |          |              |                  |                   |        | Y                      |          |                      |                    |
| `sales.order.cancel`                | Y         |                   |            |          |              |                  |                   |        | Y                      |          |                      |                    |
| `fulfillment.order.read`            | Y         | Y                 | Y          |          |              |                  | Y                 | Y      | Y                      |          |                      | Y                  |
| `fulfillment.order.manage`          | Y         | Y                 | Y          |          |              |                  |                   |        | Y                      |          |                      |                    |
| `fulfillment.order.release`         | Y         | Y                 | Y          |          |              |                  |                   |        | Y                      |          |                      |                    |
| `fulfillment.atp.read`              | Y         | Y                 | Y          |          |              |                  | Y                 | Y      | Y                      |          |                      | Y                  |
| `fulfillment.reservation.allocate`  | Y         | Y                 | Y          |          |              |                  | Y                 |        | Y                      |          |                      |                    |
| `fulfillment.reservation.release`   | Y         | Y                 | Y          |          |              |                  |                   |        | Y                      |          |                      |                    |
| `fulfillment.pick.read`             | Y         | Y                 | Y          |          |              |                  | Y                 | Y      | Y                      |          |                      | Y                  |
| `fulfillment.pick.plan`             | Y         | Y                 | Y          |          |              |                  | Y                 |        |                        |          |                      | Y                  |
| `fulfillment.pick.execute`          | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.pick.check`            | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.pick.pack`             | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.pick.stage`            | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.pick.issue`            | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.pick.reverse`          | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.shipment.read`         | Y         | Y                 | Y          |          |              |                  | Y                 | Y      | Y                      |          |                      |                    |
| `fulfillment.shipment.manage`       | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.transport.read`        | Y         | Y                 | Y          |          |              |                  | Y                 | Y      | Y                      |          |                      |                    |
| `fulfillment.transport.plan`        | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.transport.load`        | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.transport.gate`        | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.transport.deliver`     | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.pod.read`              | Y         | Y                 | Y          |          |              |                  |                   | Y      | Y                      |          |                      |                    |
| `fulfillment.pod.capture`           | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.pod.review`            | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `fulfillment.documentReturn.manage` | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `transfer.request.read`             | Y         | Y                 | Y          | Y        |              | Y                | Y                 |        |                        |          |                      |                    |
| `transfer.request.manage`           | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `transfer.request.approve`          | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `transfer.dispatch`                 | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `transfer.receive`                  | Y         | Y                 | Y          | Y        |              | Y                |                   |        |                        |          |                      |                    |
| `transfer.discrepancy.manage`       | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `transfer.replenishment.read`       | Y         | Y                 | Y          |          |              |                  | Y                 |        |                        |          |                      |                    |
| `engineering.request.read`          | Y         |                   |            |          |              |                  |                   |        | Y                      | Y        | Y                    |                    |
| `engineering.request.assign`        | Y         |                   |            |          |              |                  |                   |        |                        | Y        |                      |                    |
| `engineering.masterCard.read`       | Y         |                   |            |          |              |                  |                   |        | Y                      | Y        | Y                    |                    |
| `engineering.masterCard.draft`      | Y         |                   |            |          |              |                  |                   |        |                        | Y        |                      |                    |
| `engineering.masterCard.submit`     | Y         |                   |            |          |              |                  |                   |        |                        | Y        |                      |                    |
| `engineering.masterCard.release`    | Y         |                   |            |          |              |                  |                   |        |                        |          | Y                    |                    |
| `engineering.file.read`             | Y         |                   |            |          |              |                  |                   |        |                        | Y        | Y                    |                    |
| `engineering.file.attach`           | Y         |                   |            |          |              |                  |                   |        |                        | Y        |                      |                    |
| `production.packet.read`            | Y         | Y                 |            |          |              |                  |                   | Y      | Y                      |          |                      | Y                  |
| `production.packet.issue`           | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      | Y                  |
| `production.packet.acknowledge`     | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      | Y                  |
| `production.order.read`             | Y         | Y                 | Y          |          | Y            |                  |                   |        |                        |          |                      | Y                  |
| `production.order.manage`           | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      | Y                  |
| `production.order.release`          | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      | Y                  |
| `production.material.issue`         | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      | Y                  |
| `production.operation.report`       | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      | Y                  |
| `production.output.receive`         | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      | Y                  |
| `production.quality.decide`         | Y         | Y                 |            |          | Y            |                  |                   |        |                        |          |                      | Y                  |
| `purchasing.po.read`                | Y         | Y                 | Y          | Y        |              |                  | Y                 | Y      |                        |          |                      |                    |
| `purchasing.po.create`              | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `purchasing.po.update`              | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `purchasing.po.import`              | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `purchasing.po.cancel`              | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `purchasing.po.closeShort`          | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `receiving.receipt.read`            | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `receiving.receipt.post`            | Y         | Y                 | Y          | Y        |              |                  |                   |        |                        |          |                      |                    |
| `receiving.receipt.overTolerance`   | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `receiving.receipt.unexpected`      | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `receiving.receipt.blind`           | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `receiving.receipt.cancelLine`      | Y         | Y                 | Y          | Y        |              |                  |                   |        |                        |          |                      |                    |
| `receiving.exception.manage`        | Y         | Y                 | Y          | Y        |              |                  |                   |        |                        |          |                      |                    |
| `quality.profile.read`              | Y         | Y                 | Y          |          | Y            |                  | Y                 |        |                        |          |                      |                    |
| `quality.profile.manage`            | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `quality.inspection.read`           | Y         | Y                 | Y          | Y        | Y            |                  | Y                 | Y      |                        |          |                      |                    |
| `quality.inspection.execute`        | Y         | Y                 | Y          |          | Y            |                  |                   |        |                        |          |                      |                    |
| `quality.disposition.submit`        | Y         | Y                 | Y          |          | Y            |                  |                   |        |                        |          |                      |                    |
| `quality.disposition.approve`       | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `quality.attachment.read`           | Y         | Y                 | Y          |          | Y            |                  | Y                 |        |                        |          |                      |                    |
| `handlingUnit.read`                 | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `handlingUnit.build`                | Y         | Y                 | Y          | Y        |              |                  |                   |        |                        |          |                      |                    |
| `handlingUnit.split`                | Y         | Y                 | Y          | Y        |              | Y                |                   |        |                        |          |                      |                    |
| `handlingUnit.merge`                | Y         | Y                 | Y          | Y        |              | Y                |                   |        |                        |          |                      |                    |
| `handlingUnit.relabel`              | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `handlingUnit.nest`                 | Y         | Y                 | Y          | Y        |              | Y                |                   |        |                        |          |                      |                    |
| `handlingUnit.mixedContent`         | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `label.template.read`               | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `label.template.draft`              | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `label.template.manage`             | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `label.print.read`                  | Y         | Y                 | Y          | Y        | Y            | Y                |                   |        |                        |          |                      |                    |
| `label.print.execute`               | Y         | Y                 | Y          | Y        | Y            | Y                |                   |        |                        |          |                      |                    |
| `label.print.reprint`               | Y         | Y                 | Y          | Y        |              | Y                |                   |        |                        |          |                      |                    |
| `putaway.task.read`                 | Y         | Y                 | Y          | Y        |              | Y                | Y                 | Y      |                        |          |                      |                    |
| `putaway.task.claim`                | Y         | Y                 | Y          | Y        |              | Y                |                   |        |                        |          |                      |                    |
| `putaway.task.confirm`              | Y         | Y                 | Y          | Y        |              | Y                |                   |        |                        |          |                      |                    |
| `putaway.task.override`             | Y         | Y                 | Y          |          |              | Y                |                   |        |                        |          |                      |                    |
| `putaway.policy.manage`             | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `inventory.balance.read`            | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `inventory.history.read`            | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `inventory.transaction.post`        | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `inventory.opening.read`            | Y         | Y                 | Y          |          |              |                  | Y                 | Y      |                        |          |                      |                    |
| `inventory.opening.manage`          | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `inventory.opening.approve`         | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `inventory.opening.post`            | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `inventory.count.read`              | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `inventory.count.plan`              | Y         | Y                 | Y          |          |              |                  | Y                 |        |                        |          |                      |                    |
| `inventory.count.execute`           | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 |        |                        |          |                      |                    |
| `inventory.count.reconcile`         | Y         | Y                 | Y          |          |              |                  | Y                 |        |                        |          |                      |                    |
| `inventory.count.approve`           | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `inventory.statusChange.submit`     | Y         | Y                 | Y          |          | Y            |                  | Y                 |        |                        |          |                      |                    |
| `inventory.statusChange.approve`    | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `inventory.transaction.reverse`     | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `inventory.negativeStock.override`  | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.self.read`                      | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.self.attendance.record`         | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.self.correction.request`        | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.self.leave.request`             | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.team.read`                      |           | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.team.correction.decide`         |           | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.team.leave.decide`              |           | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.admin.employee.manage`          |           |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.admin.period.close`             |           |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `hr.payroll.read`                   |           |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `integration.health.read`           | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `integration.adapter.manage`        | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `integration.delivery.dispatch`     | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `integration.delivery.retry`        | Y         |                   |            |          |              |                  |                   |        |                        |          |                      |                    |
| `reporting.dashboard.read`          | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      | Y                      | Y        | Y                    | Y                  |
| `reporting.export.execute`          | Y         | Y                 | Y          |          |              |                  | Y                 |        |                        |          |                      |                    |
| `reporting.export.read`             | Y         | Y                 | Y          |          |              |                  | Y                 |        |                        |          |                      |                    |
| `reporting.jobRun.read`             | Y         | Y                 |            |          |              |                  |                   |        |                        |          |                      |                    |
| `work.task.read`                    | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 | Y      |                        |          |                      |                    |
| `work.task.manage`                  | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `work.task.claim`                   | Y         | Y                 | Y          | Y        | Y            | Y                |                   |        |                        |          |                      |                    |
| `work.task.complete`                | Y         | Y                 | Y          | Y        | Y            | Y                |                   |        |                        |          |                      |                    |
| `work.task.reassign`                | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `work.evidence.record`              | Y         | Y                 | Y          | Y        | Y            | Y                |                   |        |                        |          |                      |                    |
| `work.attachment.read`              | Y         | Y                 | Y          | Y        | Y            | Y                | Y                 |        |                        |          |                      |                    |
| `work.attachment.attach`            | Y         | Y                 | Y          | Y        | Y            | Y                |                   |        |                        |          |                      |                    |
| `work.exception.report`             | Y         | Y                 | Y          | Y        | Y            | Y                |                   |        |                        |          |                      |                    |
| `work.exception.resolve`            | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `work.stepUp.approve`               | Y         | Y                 | Y          |          |              |                  |                   |        |                        |          |                      |                    |
| `work.device.seen`                  | Y         | Y                 | Y          | Y        | Y            | Y                |                   |        |                        |          |                      |                    |

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
- Implemented: the evidence is the actor's own `sessionsAudit` rows in the active
  tenant — `STEP_UP_VERIFIED`, outcome `ALLOWED`, `reverifiedAt` inside the window
  and not in the future. The window is a code-owned ten minutes
  (`STEP_UP_MAX_AGE_MS`) until `RG-030` supplies a policy value, and the read is a
  bounded descending window of the newest events, so an actor with an unusually busy
  session history can be denied for lack of evidence that exists. That fails closed
  and is recorded here rather than left to be discovered.

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
  (`INV-0006-10`). Implemented for mutations — in the same transaction, which is why
  a denied mutation _returns_ its denial instead of throwing: a throw would roll the
  row back — and for actions, whose internal preflight mutation commits the row
  before any external work. **A query cannot write, so a denied read is enforced but
  not recorded** (`RG-071`).
- Denial reasons distinguish "no permission", "out of warehouse scope", "threshold
  exceeded", "approval required", "reverification required", "entitlement disabled",
  and "inactive membership", because operators need to know which one applies.
- **The reason is server-side only.** The payload a caller receives is one generic
  code (`AUTHORIZATION_DENIED`), one fixed message, and the server-minted request
  ID; the reason lives on the audit row that request ID keys (`INV-0002-07`).
  Distinguishing the reasons _to the caller_ would let an unauthorized client
  enumerate another tenant's shape — which reason applies is an authorized read of
  `auditEvents` under `admin.audit.read`, not a wider error.
- The translatable, reason-specific message §4.2 promises an operator is therefore
  owed by that authorized read and the UI built on it, not by the denial payload.

### 4.7 What the browser cannot influence

Stated because "server-side" is easy to claim and hard to check. Of everything a
decision reads, exactly three inputs are client-influenced, and each is verified
before use:

| Input               | How it is handled                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Target warehouse    | Resolved to a document, checked for tenant, `ACTIVE` status, and membership scope, then used         |
| Audit target ID     | Read through the tenant-bound accessor; recorded only if this tenant owns it, otherwise omitted      |
| Device installation | Resolved through this organization's index; correlation only, and never a permission (`ADR-0006` §8) |

Everything else — `orgId`, the actor, the permission code, the entitlement key, the
audit target table, the request ID, the step-up window, and the threshold and
maker-checker facts — is server-owned. A wrapper argument named after a policy fact
is ignored; the fact comes from a callback that runs inside the transaction with the
trusted context (`INV-0006-06`).

## 5. Verification obligations

Every row in §2 becomes a test case: an actor with the permission succeeds, an actor
without it is denied, and an actor with it but outside warehouse scope is denied.
Maker-checker rows add a self-approval rejection case; step-up rows add a stale
reverification case. See
[ADR-0006 verification](./adr/0006-authorization-and-support-access.md#verification)
and the [coverage matrix](./specification-coverage.md).

That per-row matrix is not written yet, and cannot be: no feature function declares a
permission. What exists is the enforcement path each row will travel, proved once for
each _class_ of decision in
`tests/isolation/authorization-enforcement.isolation.test.ts` — grant, warehouse
scope, effective period, entitlement, threshold, maker-checker, step-up, device
correlation, support-grant non-bypass, and the audit row of each. A per-row case is
therefore an assertion about a function's declaration, not a re-test of the policy.

## 6. Open items

- `RG-024` Catalogue review with the pilot tenant (§5 Q14).
- `RG-015` Support-access policy confirmation, including whether grants are enabled
  at all during the pilot (§5 Q15).
- `RG-030` Shared-device and privileged-session policy, including session lifetimes
  and the step-up freshness window (§5 Q16).
- `RG-071` Denied read attempts are enforced but not recorded, because a Convex query
  cannot write.
- Threshold defaults per warehouse are unset; they need pilot values before Phase 3
  (§5 Q26). Until then a threshold or maker-checker permission must supply its facts
  through a per-operation server-side callback, which the wrapper requires at
  registration.
