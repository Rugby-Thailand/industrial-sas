# Application shell, locale routing, and the inventory read screens

**Current availability: Application surface; unauthenticated.** The screens run,
navigate, and call the ledger's real public Convex queries. With no Clerk
instance configured, every one of those calls is denied by the server, so no
screen has yet shown a tenant's data. Local preview data (below) exists to
evaluate layout and copy in the meantime.

## What exists

| Route                          | Shell      | What it does                                             |
| ------------------------------ | ---------- | -------------------------------------------------------- |
| `/{locale}`                    | —          | Redirects to the dashboard in the same locale            |
| `/{locale}/dashboard`          | Supervisor | System state, capability summary, entry points           |
| `/{locale}/inventory/balances` | Supervisor | `inventory/ledger:listBalances`, paged, read-only        |
| `/{locale}/inventory/history`  | Supervisor | `inventory/ledger:listTransactions`, paged, newest first |
| `/{locale}/setup`              | Supervisor | Which dependencies are configured on this machine        |
| `/{locale}/sign-in`            | None       | Explains that sign-in belongs to the identity provider   |
| `/{locale}/handheld`           | Operator   | Task launcher; unbuilt tasks are listed and marked       |
| `/{locale}/handheld/inventory` | Operator   | The same balances read, in the operator shell            |

`{locale}` is `th` or `en`. There is no unprefixed route: `/` negotiates a locale
and redirects, so every URL an operator can share names its language.

## Choosing a language

The language control is in both shells. It switches without leaving the current
screen and records the choice in a cookie, so the next visit to `/` resolves to
the language chosen rather than re-negotiating the browser's `Accept-Language`.

Thai is the default. A browser advertising a language this product does not serve
gets Thai, never English.

## Choosing a warehouse

Every ledger read is scoped to exactly one warehouse, and the server revalidates
the selected warehouse on every call — it must exist, belong to the resolved
tenant, be `ACTIVE`, and be inside the actor's membership scope. The selector is
therefore safe to remember in the browser, and it is: the choice persists across
navigation and across visits, and it resets the current page of results when it
changes, because a cursor is only meaningful inside the query that produced it.

The **organization** is not selectable. It comes from the verified token's
active-organization claim and is resolved server-side; switching organization is
the identity provider's job, not this application's.

## Reading the connectivity badge

| Badge              | Meaning                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| Connected          | A WebSocket to the deployment reached "ready". The server is acknowledging.   |
| Connecting         | No acknowledgement yet, and none has ever been received. Normal on load.      |
| Disconnected       | There was a connection and it dropped. Treat stock-confirming work as unsafe. |
| Not configured     | No deployment URL. Nothing was attempted.                                     |
| Local preview data | Synthetic rows. Nothing on screen came from a server.                         |

The badge is derived from the client's own socket state, not from
`navigator.onLine`: a captive portal and a dead uplink both report the browser as
online (`INV-0009-07`).

## What the screens will not do

- **No screen writes.** There is no control that posts, edits, or deletes a
  balance or a transaction; a correction is a reversal, posted as a second
  transaction that names the first, and no UI for that exists yet.
- **No optimistic update.** Convex query subscriptions are live, so a confirmed
  posting arrives on its own. Nothing is shown as changed before the server says
  so (`INV-0009-04`).
- **No permission guessing.** A denial shows the server's single generic message
  and the request ID its audit row quotes. The UI never infers which permission
  was missing.

## Local preview data

Set `NEXT_PUBLIC_LOCAL_PREVIEW=1` and run `pnpm dev`. The inventory screens then
render a small synthetic dataset — two warehouses, eight balance rows across four
stock statuses, seven transactions including a reversal — so layout, Thai
wrapping, column widths, and paging can be evaluated without a deployment.

Rules it follows, so it cannot be mistaken for stock:

- A banner that cannot be dismissed appears on every screen it can reach.
- The connectivity badge reads "local preview data", never "connected".
- Every identifier carries a `prv_` prefix.
- It cannot be enabled in a production build: the flag must be exactly `"1"` and
  `NODE_ENV` must not be `"production"`, and that comparison is replaced
  statically at build time.

It is not a fake backend. It has no authorization, no tenant resolution, and no
writes.

## Making the screens show real data

1. Configure a Clerk instance and set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
2. Add a Convex JWT template and `convex/auth.config.ts`, and confirm the
   active-organization claim name matches `ACTIVE_ORGANIZATION_CLAIM` in
   `convex/lib/tenantContext.ts`.
3. Wire `ConvexReactClient.setAuth` to Clerk's token fetcher — and to nothing
   else. A token this application minted itself would be an authentication
   bypass, not a shortcut.
4. Deploy the Convex functions and set `NEXT_PUBLIC_CONVEX_URL`.
5. Provision an organization, a membership, and a warehouse through the webhook
   and seed path described in
   [Identity and organization sync](./identity-and-organization-sync.md).

Steps 1, 2, and 4 need vendor accounts and are outside this repository.

## Related references

- [ADR-0009 — Degraded-online connectivity](../adr/0009-degraded-online-connectivity.md)
- [ADR-0010 — Thai-first i18n and accessibility](../adr/0010-thai-first-i18n-and-accessibility.md)
- [Inventory ledger](./inventory-ledger.md)
- [Tenant and warehouse access](./tenant-and-warehouse-access.md)
