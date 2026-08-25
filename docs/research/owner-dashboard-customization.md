# Owner dashboard and customizable quick menu

Research brief, 2026-08-24. “Owner” here means the organization’s business
owner/executive, not the `owners` table’s legal owner of consigned stock and not
automatically the `ORG_ADMIN` technical-administration role.

Evidence labels used below:

- **Sourced fact** means the statement is directly supported by the linked
  first-party product documentation or standard.
- **Design inference/recommendation** means it is a proposed decision for this
  product, derived from those facts and the inspected repository.

## Executive conclusion

The current page is a useful **warehouse supervisor** surface: it shows one
warehouse’s waiting work, cumulative receipt activity, occupancy, and execution
shortcuts. It is not yet an owner dashboard. The owner’s first screen should lead
with business-impacting exceptions and a small scorecard of service, flow,
inventory, and capacity health, then offer drilldowns. Raw work queues and task
execution should remain available, but below the owner summary or on operational
pages.

The quick menu should be personalizable per account **within** a server-defined,
permission- and entitlement-filtered action catalogue. A saved item is a display
preference, never an authorization grant.

## Sourced facts: what the primary sources establish

### Role-tailored home pages

- Microsoft describes a Role Center as a role-tailored home page and explicitly
  names business owners, department leads, and information workers as different
  target profiles. It recommends quick access to the information and tasks most
  important to that intended user, with the most important/frequent actions at
  the top level. [Microsoft: Designing Role Centers](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-designing-role-centers)
- Microsoft says KPIs should map to strategic objectives, mix leading and
  lagging indicators, have a target/owner/cadence, include comparison data, and
  remain relevant and actionable for the intended audience rather than overload
  a report. [Microsoft: Using KPIs to meet business goals](https://learn.microsoft.com/en-us/dynamics365/business-central/analytics-about-kpis)
- Official warehouse products consistently cover inbound, outbound, inventory,
  and exceptions. Microsoft’s Warehouse Performance content includes dock-to-
  stock time, early/on-time/late receipts, inventory discrepancy rate, and
  early/on-time/late shipments, with breakdowns by warehouse, vendor, item, and
  customer. [Microsoft: Warehouse performance Power BI content](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/analytics/warehouse-power-bi-content)
- Oracle’s current landing page puts inbound shipments due, critical stockouts,
  cycle counts due, and outbound shipments due into scoreboard cards, limited to
  inventory organizations the warehouse manager can access. [Oracle: Improved
  Inventory Management landing page](https://docs.oracle.com/en/cloud/saas/readiness/scm/25b/inv25b/25B-inventory-wn-f36654.htm)
- Oracle’s Warehouse Activity dashboard summarizes critical work as completed
  versus incomplete and supports drilling into work areas to understand issues
  and take corrective action. Its KPI layer includes inventory value and count
  accuracy. [Oracle: Warehouse Operations Dashboard](https://docs.oracle.com/cloud/131/user_services/FAMLI/F428468AN13D7F.htm)
- SAP’s daily warehouse overview combines inbound/outbound status, timeliness,
  picking accuracy, and internal order cycle time; its overview is separated
  from detail pages. [SAP: Warehouse Dashboard for Daily Operation](https://help.sap.com/docs/SAP_S4HANA_CLOUD/87f9b54f9c4f4e75aff0061860a6589a/b8ba091ba9e94110a6d7e2d76826188b.html)

**Design inference/recommendation:** supervisors/operators need “what must I execute or assign
today?” Owners need “where is service, cash/inventory, capacity, or customer
commitment at risk, how is it trending, and where should I intervene?” The same
domain data can feed both, but the hierarchy and available actions must differ.

### Personalization is not authorization

- Business Central separates administrator-defined profile/role layouts from
  per-user personalization. Users can move or hide parts and actions and clear
  their personalization; administrators can define or lock a role default.
  [Microsoft: Customize pages for roles](https://learn.microsoft.com/en-us/dynamics365/business-central/ui-personalization-manage),
  [Personalize your workspace](https://learn.microsoft.com/en-au/dynamics365/business-central/ui-personalization-user)
- Dynamics saved views require an explicit save, support named/default views and
  Move up/Move down ordering, and publish organization defaults only to selected
  security roles and legal entities. When a user loses the relevant role/entity,
  the published view disappears automatically. [Microsoft: Saved views](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/get-started/saved-views)
- Oracle WMS assigns default UI/RF menus through groups and applies additional
  permissions separately. [Oracle: Group configuration](https://docs.oracle.com/en/cloud/saas/warehouse-management/26c/owmim/group-configuration.html)
- OWASP requires access-control decisions at a trusted service layer, least
  privilege, and enforcement for every protected request; hiding a client-side
  menu item is not enforcement. [OWASP ASVS access-control requirements](https://cornucopia.owasp.org/taxonomy/asvs-4.0.3/04-access-control/01-general-access-control-design)

**Design inference/recommendation:** resolve the quick menu through this pipeline:

1. Code-owned action registry with stable action IDs, routes, required
   permissions, required entitlements, warehouse requirements, and locale keys.
2. Owner-role default preset.
3. The signed-in membership’s explicit saved ordering/visibility.
4. Server-side intersection with the membership’s current effective permissions,
   entitlements, warehouse scope, and active status.
5. Render only the intersection, then re-authorize the destination query or
   mutation normally.

Never store arbitrary URLs, localized labels, permission claims, or entitlement
claims in a preference. Re-evaluate saved entries on every read so a revoked
grant disappears immediately. Validate the same rules on write, but do not rely
on write-time validation because access can change later.

## Design inference/recommendation: owner first screen

The following is a proposed product design, derived from the source patterns and
the data this repository can truthfully support.

### 1. Header and scope

- Title: **Owner overview**, organization, selected warehouse, and “as of”.
- Keep the shell’s single warehouse selector; do not duplicate it in the page.
- Phase 1 remains selected-warehouse only. Add “All allowed warehouses” only
  after an org-wide, bounded aggregate exists and visibly states partial scope.

### 2. Needs attention — first

One ranked list, not a wall of zero-valued cards. Each row needs severity text,
business impact, age/deadline, affected entity, and one descriptive drilldown.

Suggested initial signals:

- outbound shipments/order lines late or due soon;
- critical stockouts or allocations that cannot be fulfilled;
- QC parked/dispositions awaiting approval;
- cycle-count discrepancies or overdue counts;
- production/customer orders at risk of missing due dates;
- transfer discrepancies, failed report/integration jobs, and suspect dashboard
  rollups.

Sort by severity and time-to-impact, with a deterministic tie-breaker. “Critical”
must be text/icon as well as color. This follows WCAG’s rule that color cannot be
the only status cue. [WCAG 2.2, 1.4.1](https://www.w3.org/TR/WCAG22/#use-of-color)

### 3. Owner scorecard — six maximum initially

| KPI                       | First-screen form                     | Drilldown                       | Repo readiness                           |
| ------------------------- | ------------------------------------- | ------------------------------- | ---------------------------------------- |
| On-time shipment rate     | today/7 days, target, prior period    | late shipments → customer/order | Needs historical rollup                  |
| Order fulfillment at risk | count and committed quantity due soon | fulfillment/order lines         | Derivable but needs bounded projection   |
| Dock-to-stock time        | median/average, target, prior period  | receipt/vendor/item             | Needs timestamp aggregate                |
| Inventory accuracy        | discrepancy rate and overdue counts   | count plan/location/item        | Needs historical aggregate               |
| Capacity risk             | locations in high/full band, trend    | occupancy map/location          | Current occupancy exists; trend does not |
| Production plan adherence | completed/due/late orders             | production order/operation      | Needs historical aggregate               |

Keep **inventory value, revenue, gross margin, and cash impact out of the UI for
now**. Oracle shows why inventory value belongs on an owner view, but this schema
has no authoritative item cost/currency or commercial price/revenue model, so any
number would be invented. Add it only with an explicit valuation model, period,
currency, and reconciliation contract.

Every KPI card should show label, value/unit, scope, period, freshness, target or
comparison, trend direction in text, and one obvious drilldown. A card that is
entirely clickable must not contain competing nested actions; Carbon’s official
tile guidance warns against multiple click targets inside a clickable tile.
[Carbon: Tile usage](https://carbondesignsystem.com/components/tile/usage/)

### 4. Customizable quick menu

Start the owner default with four to six actions, for example:

- Review exceptions
- Orders at risk
- Inventory health
- Production status
- Operational reports
- Users and access (only for an owner who separately has admin permission)

Offer **Customize** as an explicit mode. The user can add from the currently
authorized catalogue, remove, Move up, Move down, and Reset to owner default.
Drag-and-drop may be an enhancement, never the only ordering mechanism; WCAG 2.2
requires a non-drag alternative. [WCAG 2.2, 2.5.7](https://www.w3.org/TR/WCAG22/#dragging-movements)

Recommended persistence is one bounded tenant record per membership and page:

```text
dashboardPreferences
  orgId
  membershipId
  pageKey: "OWNER_DASHBOARD"
  presetVersion: 1
  quickActionIds: string[]       // maximum 6, ordered
  widgetIds: string[]            // bounded, ordered
  hiddenWidgetIds: string[]      // bounded
  updatedAt
```

Key it by **membership**, not global `userId`: one Clerk user may belong to
multiple organizations and must not carry a tenant’s shortcuts into another
tenant. Use stable registry IDs rather than URLs. A version enables safe default
migrations. Personal changes affect only that membership; a later admin-managed
role preset should be a separate record and require explicit profile-management
authorization.

## Design inference/recommendation: interaction rules

- Cards summarize one subject. Use tables/lists for comparing many rows.
- Preserve dashboard scope and timeframe in drilldowns; provide a clear route
  back. Oracle explicitly pairs infolets with task/detail drilldowns.
  [Oracle: Inventory Management work area](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/famli/inventory-management-work-area.html)
- Persistent page-load exceptions belong in an attention list/callout, not toast
  messages. Keep notices short, state what happened and what to do next, and use
  disruptive alerts sparingly. [Carbon: Notification usage](https://carbondesignsystem.com/components/notification/usage/)
- Announce asynchronous save/loading results as programmatic status messages
  without stealing focus. [WCAG 2.2, 4.1.3](https://www.w3.org/TR/WCAG22/#status-messages)
- On mobile, keep the same semantic DOM order and stack to one column: urgent
  attention, owner scorecard, quick actions, then detail. Do not simply shrink a
  dense desktop grid. Content must reflow at an equivalent 320 CSS-pixel width,
  and pointer targets must meet the 24-by-24 CSS-pixel minimum or an allowed
  exception. [WCAG reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow),
  [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- Loading, denied, empty, stale, partial, and suspect states remain independent
  per widget. One failed metric must not blank the whole dashboard.

## Repository findings and recommended implementation order

### Existing seams to reuse

- `src/app/[locale]/(desktop)/dashboard/page.tsx` currently hardcodes two hero
  actions plus eight “Start work” entries. Replace both duplicated menus with one
  registry-backed client surface.
- `src/lib/navigation.ts` and
  `convex/model/authorization/navigationPermissions.ts` already provide stable
  route/permission vocabulary. Extract or extend a pure `DASHBOARD_ACTIONS`
  registry that reuses those constants.
- `convex/workspace/current.ts` already resolves the active membership,
  warehouse scope, and a bounded navigation grant set. Do not treat its browser
  snapshot as enforcement; add a trusted dashboard-preference query/mutation that
  resolves the effective intersection server-side.
- `convex/reporting/dashboard.ts` correctly uses bounded maintained rollups and
  marks freshness/suspect data. Preserve that honesty contract.

### Gaps

- The page and code comments currently identify the dashboard as a supervisor
  entry point; no explicit owner dashboard profile exists.
- `ORG_ADMIN` is a tenant system administrator, not proof that the human is the
  business owner. Do not select owner content by string-matching that role.
- `operationsRollups` stores current counts only. Rates, targets, comparisons,
  trends, deadlines, and cross-warehouse totals need new maintained daily/hourly
  projections; do not scan operational tables on page load.
- There is no tenant-scoped per-membership preference table.
- There is no cost/currency/revenue source of truth, so owner financial KPIs are
  not implementable honestly yet.

### Small, safe delivery sequence

1. Define the owner dashboard contract, stable widget/action registry, maximums,
   and an explicit `OWNER_DASHBOARD` profile/default without changing grants.
2. Add the tenant-scoped `dashboardPreferences` table, indexed uniquely by
   `(orgId, membershipId, pageKey)`, plus permission-aware read/update/reset
   functions and tests for revocation, cross-tenant isolation, warehouse scope,
   stale IDs, ordering, and bounds.
3. Replace the hardcoded hero/entry actions with the customizable quick menu;
   ship keyboard ordering, reset, English/Thai copy, mobile reflow, and
   accessibility tests.
4. Recompose the existing honest data into owner hierarchy: attention first,
   current capacity/quality signals next, operational details below. Do not add
   fabricated trend arrows.
5. Add owner KPI projections one domain at a time with definitions, targets,
   freshness, reconciliation, drilldowns, and property/integration tests.
6. Add org-wide scope only after the aggregate remains bounded and honors the
   membership’s allowed-warehouse set.

### Acceptance boundaries

- A user cannot save, render, navigate to, query, or mutate an action merely
  because its ID appears in preferences.
- Revoking a permission, entitlement, warehouse assignment, membership, or role
  removes the item on the next read and the destination independently denies it.
- Personalization never changes another membership or organization.
- Reset produces the latest permitted owner default, not a stale copied array.
- Every number identifies scope, period, freshness, and definition; partial or
  suspect data is visibly labeled.
- The dashboard works at 320 CSS pixels, without drag, without color, with
  keyboard only, and with assistive-technology status announcements.
