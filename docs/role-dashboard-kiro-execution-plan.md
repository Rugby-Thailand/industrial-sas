# Role Dashboard and Customer Portal — Kiro Execution Plan

Status: **Proposed implementation plan**
Prepared: **2026-08-20**
Kiro configuration: **`claude-opus-5`, `--effort max`**

This plan turns the current single warehouse dashboard into role-appropriate
workspaces for:

- Customer
- Sales and Customer Service
- Design and Engineering
- Factory operator and production planner
- Factory QA and approver
- Factory manager
- Owner / executive

It extends, but does not replace, the current order-to-ship operating plan in
[`figma-order-to-ship-operating-plan.md`](./figma-order-to-ship-operating-plan.md).

## 1. Current repository truth

The repository already has:

- Internal roles for Sales/Customer Service, Engineer, Engineering Approver,
  Production Planner, QC Inspector, Warehouse Manager, and Organization Admin.
- Customer orders and customer PO references.
- Customer-order lines with design readiness.
- Engineering design requests, priorities, due dates, assignment, review, and
  released master-card revisions.
- Factory packets that may be issued and acknowledged.
- A warehouse operations dashboard backed by bounded maintained rollups.
- Thai/English catalogues, desktop/handheld shells, tenant isolation, permission
  enforcement, audit, idempotent writes, and accessibility tests.

The repository does **not** yet have authoritative data for:

- Factory orders, production schedules, operation progress, WIP, completion,
  yield, scrap, or rework.
- Finished-goods readiness, reservations, packing, shipments, carrier tracking,
  delivery confirmation, or POD.
- Requested/promised ship and delivery dates, ETA calculation, or promise-change
  history.
- Customer-order prices, currency, discounts, tax, invoice totals, payments,
  credit notes, accounts receivable, cost, or margin.
- External customer identities or customer-scoped portal authorization.
- A client capability snapshot that can safely compose navigation and dashboards
  for a user with one or more custom tenant roles.

Consequently, the current system can honestly say **design ready**, **handed off
to factory**, and **factory acknowledged**. It cannot yet say **in production**,
**ready to ship**, **shipped**, **arriving on a date**, or **paid**.

## 2. Product rules

1. **One truth, many views.** Role dashboards are projections over shared domain
   events; they do not own parallel status fields.
2. **Capabilities, not role-name conditionals.** Tenant roles are editable and a
   person may hold several roles. UI composition uses coarse server-issued
   capabilities derived from effective permissions.
3. **External customers are not internal tenant members.** Customer portal reads
   derive allowed `customerId` values from the verified identity. A request must
   never accept an arbitrary customer ID and then authorize only at organization
   scope.
4. **Status is quantity-derived.** Partial production, partial shipment, partial
   invoice, and partial payment remain visible. A single headline status is a
   projection, not the only evidence.
5. **Dates name their meaning.** Keep requested delivery, committed ship,
   committed delivery, estimated ship, estimated delivery, dispatch, and actual
   delivery separate.
6. **Unknown is a valid answer.** An ETA without evidence is shown as “Not
   committed” or “Estimate unavailable,” never as an invented date.
7. **Money is exact.** Store monetary values in integer minor units plus ISO
   currency. Never use JavaScript floating point for order or payment arithmetic.
8. **Cross-currency totals need an approved FX policy.** Until that exists, the
   Owner dashboard groups totals by currency instead of adding unlike money.
9. **Every dashboard read stays bounded or rollup-backed.** No dashboard scans
   growing order, ledger, production, shipment, invoice, or event history.
10. **Every card answers a decision.** Avoid decorative KPIs, fake sparklines,
    and charts without history.

These choices align with SCOR's customer-facing focus on perfect order
fulfillment and order-fulfillment cycle time:

- <https://scor.ascm.org/performance/introduction>
- <https://scor.ascm.org/performance/reliability/RL.1.1>

## 3. Workspace model

### 3.1 Internal users

Add a bounded `workspace/current:readCapabilities` projection. Return coarse
capabilities, not a hard-coded primary role:

- `CUSTOMER_SERVICE_WORKSPACE`
- `ENGINEERING_WORKSPACE`
- `FACTORY_EXECUTION_WORKSPACE`
- `FACTORY_QUALITY_WORKSPACE`
- `FACTORY_MANAGEMENT_WORKSPACE`
- `EXECUTIVE_WORKSPACE`
- existing warehouse operations capabilities

When a user has several capabilities, show a workspace switcher and remember the
last choice. The server remains authoritative for every underlying query and
mutation.

Do not equate Owner with `ORG_ADMIN`. Add a read-focused executive permission
group and an `EXECUTIVE_VIEWER` default role. Administrative power and executive
visibility are separate responsibilities.

### 3.2 External customers

Add a customer portal identity boundary with records such as:

- `customerPortalUsers`
- `customerPortalAccounts` or customer-user links
- optional customer representative versus individual-order access scope
- invitation, activation, suspension, and audit evidence

Add a dedicated customer query wrapper or an equivalent server-owned constraint
that resolves the visible customer/order set from identity. Prove that:

- a portal user cannot read another customer's order by guessing an ID;
- an individual user may be limited to orders they placed;
- a customer representative may see all orders for explicitly linked customer
  accounts;
- customer users cannot read engineering files, internal notes, costs, margin,
  other customers, warehouse internals, or unrestricted organization data.

Microsoft's current customer-portal model similarly distinguishes authorized
individuals from customer representatives with account-wide visibility:
<https://learn.microsoft.com/en-us/dynamics365/supply-chain/sales-marketing/customer-portal-user-admin>.

## 4. What matters to each role

| Workspace                  | First question                                                        | Primary dashboard content                                                                                                                                                                                                                                                                   | Primary actions                                                                                                                          | Explicitly hidden                                                                                |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Customer                   | “What is happening to my PO, when will it arrive, and what do I owe?” | Active POs; order total; ready/shipped quantities; milestone timeline; committed and estimated dates with confidence; invoice/payment state; shipment tracking; blocking question                                                                                                           | View PO/order detail, download approved customer documents, answer information request, acknowledge promise change, open support request | Other customers, internal design files/notes, internal cost/margin, unrestricted factory details |
| Sales / Customer Service   | “Which customer promises need attention now?”                         | Due soon; late/at-risk; missing customer information; design overdue; material shortage; production/QC/shipping exceptions; uncommitted ETA; credit/payment holds; recent customer messages                                                                                                 | Create/amend/release order, request information, assign follow-up, change promise with reason, notify customer, escalate exception       | Engineering artwork unless separately authorized; unrestricted finance administration            |
| Design Engineer            | “What must I design or revise next?”                                  | My queue; unassigned queue; due/overdue; priority; completeness; reuse candidates; drafts; rejected/rework items; review feedback                                                                                                                                                           | Claim, request missing information, draft, attach evidence, submit, fulfill request with released revision                               | Payments, customer credit, owner financial KPIs, unrelated factory operations                    |
| Engineering Approver       | “What needs an independent decision?”                                 | In-review revisions; age; author; changed fields; calculation/evidence completeness; prior rejection context                                                                                                                                                                                | Compare revisions, release, reject with reason                                                                                           | Draft/submit actions that would collapse maker-checker separation                                |
| Factory Operator / Planner | “What can run next, and what blocks it?”                              | Released work; material readiness; route; target quantity/date; next operation; required files; shortages; current assignment; server-confirmed progress                                                                                                                                    | Claim/dispatch work, scan materials, start/pause/complete operation, raise exception                                                     | Unreleased engineering revisions, payments, margin                                               |
| Factory QA / Approver      | “What must be inspected or dispositioned?”                            | Inspections due; sampling obligation; blocked quantity; failed characteristics; holds; rework return; evidence completeness; approval queue                                                                                                                                                 | Record result/evidence, submit disposition, independently approve/reject, send to rework                                                 | Customer finance, unrestricted design drafts, self-approval                                      |
| Factory Manager            | “Will the factory meet commitments?”                                  | Plan versus actual; late/at-risk factory orders; material-ready backlog; WIP by work center; bottlenecks; throughput; yield/scrap/rework; QC hold; downtime/exception age; staffing/capacity only when modeled                                                                              | Reprioritize within policy, assign supervisor, approve guarded exceptions, drill into FO/operation                                       | Customer-private financial details unless separately authorized                                  |
| Owner / Executive          | “Are we delivering, earning, and collecting?”                         | Orders/backlog by currency; on-time-in-full; fulfillment cycle time; late promise risk; shipped/invoiced/collected amounts; AR aging; gross margin only after cost policy; capacity trend; yield/scrap; inventory value only after valuation policy; customer concentration; data freshness | Drill from KPI to accountable exception, export approved summaries                                                                       | Shop-floor action controls, sensitive design files by default                                    |

The Owner scorecard should remain balanced. SCOR recommends reliability,
responsiveness, agility, cost, profit, and asset perspectives rather than one
isolated revenue number: <https://scor.ascm.org/performance/introduction>.

## 5. Shared customer-order experience

Every internal role and the external customer should reach the same order
identity through a permission-specific view. The detail page should include:

1. Header: internal sales order, customer PO, customer, order date, current
   promise, commercial total when authorized, and honest headline state.
2. Quantity summary per line: ordered, designed, planned, produced, QC accepted,
   reserved, shipped, delivered, invoiced, and paid where applicable.
3. Milestone timeline from append-only events with actor, time, reason, and
   source document.
4. Exceptions and next owner: what is blocked, since when, who must act, and the
   recovery action.
5. Documents: customer-visible confirmation/invoice/shipment documents separated
   from internal engineering and factory evidence.
6. Promise history: original request, every committed-date change, reason, actor,
   notification state, and customer acknowledgement when required.

Use explicit customer PO, supplier PO, and internal sales-order labels. Never use
an unqualified “PO” where the direction is ambiguous.

## 6. Data required before richer cards unlock

### 6.1 Promise and ETA

Add requested and committed date evidence before showing countdowns:

- customer-requested ship/delivery date;
- current committed ship/delivery date;
- append-only promise-change events and reason;
- estimated ship/delivery date, calculation source, confidence, and calculated
  time;
- dispatch and actual delivery events.

ETA should be a range when uncertainty warrants it. Use committed dates for
promise performance and estimates for operational prediction; do not overwrite
one with the other.

### 6.2 Commercial value and payment

Add or integrate:

- exact order-line price, discount, tax, currency, and immutable commercial
  snapshots;
- invoice and credit-note identities, issue date, due date, currency, and total;
- payment/settlement events and allocation to invoices;
- derived states such as `NOT_INVOICED`, `UNPAID`, `PARTIALLY_PAID`, `PAID`, and
  `OVERDUE`;
- invoice-account separation when the order customer differs from the payer.

Order-to-cash does not end at order creation. Microsoft documents invoice status,
payments, and cash flow as a separate accounts-receivable process:
<https://learn.microsoft.com/en-us/dynamics365/guidance/business-processes/order-to-cash-invoice-sales-orders-overview>.

### 6.3 Production and shipping

Follow the accepted sequence in the existing operating plan:

- Phase 5B: factory order and material readiness.
- Phase 5C: route execution and material/WIP ledger postings.
- Phase 5D: production QC and accepted finished-goods receipt.
- Phase 5E: reservation, shipment, dispatch, partial fulfillment, and closure.

Only then may the UI use “ready to ship,” “shipped,” and on-time delivery metrics.

## 7. Visual and interaction direction

- Keep the established industrial visual language: flat surfaces, strong
  hierarchy, restrained accent color, tabular numerals, and clear borders.
- Customer portal: calm and reassuring, mobile-first, one prominent “next
  shipment” or “action needed” card, order list, and milestone timeline.
- Internal desktop: dense but calm exception-first layout with saved filters,
  bounded tables, and right-side detail panels.
- Factory handheld: scan-first, one decision per screen, one dominant action,
  persistent task and server-confirmation state.
- Factory manager and Owner: a small number of decision-grade KPIs with drilldown;
  no dashboard wall of cards.
- Pair every status color with text and icon. Provide a list/table equivalent for
  charts.
- Show data freshness on every maintained aggregate. Mark suspect or incomplete
  projections.
- Thai is the layout baseline. Test long Thai labels at 320, 360, 768, and 1280
  CSS pixels, 200% zoom, keyboard, screen reader, reduced motion, dark/light
  theme, and poor network conditions.

## 8. Edge cases that must be designed before implementation

- One customer PO number reused by different customers.
- No customer PO reference.
- Multiple lines at different lifecycle stages.
- One line split across factories, production runs, shipments, invoices, or
  payments.
- Partial shipment, short close, over-production, cancellation, reversal, return,
  credit note, and refund.
- New design, rejected design, changed design after an order, and superseded
  revision while an FO remains pinned to the old release.
- Material shortage, expired/held stock, production interruption, QC failure,
  rework, and rejected finished goods.
- Requested date earlier than feasible; promise changed after customer
  acknowledgement; ETA becomes unknown.
- Shipment dispatched but carrier tracking unavailable; carrier says delivered
  while POD is absent or disputed.
- Order customer and invoice account differ.
- Partial payment, overpayment, payment reversal, overdue invoice, credit hold,
  and payment recorded in a different source system.
- Multi-currency orders without an approved FX rate.
- User holds several internal roles; custom role changes while a session is open.
- Org-wide versus assigned-warehouse access; order fulfilled across warehouses.
- External user linked to several customer accounts or only their own orders.
- Stale rollup, incomplete page, denied permission, missing integration, offline,
  slow response, empty state, and first-ever tenant state.

## 9. Kiro delivery loop

Do not give Kiro the whole roadmap in one prompt. Use one precise task at a time.
Every feature follows three separate runs:

1. **Design run:** create/update only the feature brief, state model, wireframe,
   query contract, edge-case matrix, and acceptance criteria.
2. **Implementation run:** implement the approved vertical slice with scoped
   backend, UI, messages, and tests.
3. **Polish run:** perform visual/accessibility/responsive review, fix findings,
   and run the relevant verification.

Before every run:

```bash
git status --short
'/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat' chat \
  --list-models --format json-pretty
```

Only continue when the worktree is clean or when the exact existing changes are
intentionally isolated in a dedicated branch/worktree. Never let an autonomous
run mix with unidentified user edits.

Base command:

```bash
'/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat' chat \
  --model claude-opus-5 \
  --effort max \
  --trust-all-tools \
  --no-interactive \
  "Task: <one precise task>. Keep changes scoped. Preserve tenant and customer isolation. Do not invent unavailable data. Add Thai and English copy. Run targeted tests and report every check."
```

After every run, review the full diff before running repository checks or starting
the next task.

## 10. Ordered Kiro tasks

### K0 — Baseline and decisions

- Reconcile this plan with the current Phase 5A review status and existing dirty
  changes.
- Record decisions for customer identity, promised-date ownership, invoice source
  of truth, currency/FX, delivery boundary, and Owner permissions.
- Output: approved ADR/feature brief only; no production code.

### K1 — Capability-aware workspace foundation

- Add effective capability projection and permission-driven workspace switcher.
- Filter navigation and quick actions without weakening server authorization.
- Add read-only executive permission group and role.
- Test multi-role users, custom roles, role revocation, assigned warehouses, and
  Thai/English navigation.

### K2 — Shared dashboard composition and visual foundation

- Build reusable role-dashboard primitives: scoped header, freshness indicator,
  KPI/exception card, bounded work queue, milestone timeline, status legend,
  empty/error/denied state, responsive detail surface, and accessible chart/table
  pair.
- Recompose the current warehouse dashboard with these primitives first, proving
  no regression before adding new workspaces.

### K3 — Customer Service workspace over Phase 5A

- Build an exception-first order/design/factory-handoff dashboard using only
  existing Phase 5A truth.
- Show design overdue, missing assignment, awaiting design, design ready, handed
  off, packet issued, and packet acknowledged.
- Label factory acknowledgement honestly; do not call it production or shipping.

### K4 — Engineering and Engineering Approver workspaces

- Engineer queue: assignment, priority, due/overdue, completeness, reuse
  candidates, in-progress, review, and rejection recovery.
- Approver queue: independent review, revision comparison, evidence, release or
  rejection.
- Prove maker-checker separation in both UI and backend tests.

### K5 — Customer portal security and Phase 5A experience

- Implement external customer identity/account scoping and portal shell.
- Show only the linked customer's active orders, customer PO references, ordered
  quantities, and honest Phase 5A milestones.
- Add adversarial cross-customer and cross-tenant isolation tests before any
  commercial or shipment detail.

### K6 — Factory planning and management over Phase 5B

- After factory-order/material-readiness domain work lands, build Planner,
  Operator, and Factory Manager views.
- Focus on executable work, shortages, route, commitments, blockers, and plan
  versus actual.
- Use material-readiness evidence and quantities, not a free-floating boolean.

### K7 — Factory QA over Phase 5D

- Build inspection and approval workspaces after production-QC records exist.
- Include samples, characteristics, evidence, blocked quantities, holds,
  dispositions, rework, and independent approval.
- Ensure rejected/held stock cannot appear ready to ship.

### K8 — Fulfillment, ETA, and shipment views over Phase 5E

- Add promise history and credible ship/delivery estimates.
- Add reservations, ready-to-ship quantities, partial shipments, dispatch,
  tracking/POD boundary, and on-time exception rollups.
- Upgrade Customer and Customer Service dashboards only after the source events
  exist.

### K9 — Commercial, invoice, payment, and Owner workspace

- Integrate or implement exact commercial totals, invoices, settlements, and AR.
- Add customer-visible order total and invoice/payment status.
- Add Owner KPIs by currency, OTIF, cycle time, backlog, shipped/invoiced/paid,
  AR aging, and operational risk.
- Add margin and inventory value only after approved costing/valuation rules.

### K10 — Cross-role hardening

- Full order timeline and drilldown across every authorized workspace.
- Bounded-query and rollup verification, tenant/customer isolation, maker-checker,
  idempotency, concurrency, partial quantity, stale-data, and integration-failure
  tests.
- Thai/English parity, accessibility, keyboard/scanner flows, responsive visual
  snapshots, dark/light themes, reduced motion, and performance budgets.
- Update manuals, training, coverage matrix, release gates, and rollback notes.

## 11. Feature-level definition of done

A Kiro feature is done only when:

- its source-of-truth data and status derivation are named;
- permissions and tenant/customer/warehouse scope are enforced by the server;
- all dashboard reads are bounded or pre-aggregated;
- happy path plus relevant edge cases and refusals are tested;
- no optimistic state claims a durable approval, inventory, production, shipment,
  invoice, or payment outcome before server confirmation;
- Thai and English catalogues have identical keys and reviewed real copy;
- empty, loading, partial, stale, denied, offline, and integration-unavailable
  states are useful;
- keyboard, screen-reader, 200% zoom, long Thai, and target viewport checks pass;
- the full diff is reviewed and targeted checks are green;
- documentation states what is implemented and what remains unavailable.

## 12. Immediate next action

The safest first execution is **K0**, not a UI implementation. The current
worktree contains many existing modifications and deletions, so first isolate or
finish that work. Then run K0 to settle the external-customer identity boundary,
date promise ownership, commercial source of truth, and Owner permission model.
Those decisions control every later dashboard and prevent attractive screens
from being built on unsafe or fictional data.
