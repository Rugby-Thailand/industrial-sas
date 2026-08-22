# Application shell, locale routing, and the inventory read screens

**Current availability: Authenticated application surface.** Signed-out users go
to localized Clerk sign-in. Tenant screens render only after an active Clerk
organization and a provisioned Convex membership resolve.

## What exists

| Route                          | Shell      | What it does                                             |
| ------------------------------ | ---------- | -------------------------------------------------------- |
| `/{locale}`                    | —          | Redirects to sign-in or the dashboard                    |
| `/{locale}/dashboard`          | Supervisor | Work counters, occupancy, and quick actions              |
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

## Making the screens show real data

1. Follow the [development product setup](../development-setup.md) to connect a
   Clerk development instance and activate its first-class Convex integration.
2. Set the Clerk Frontend API URL as `CLERK_JWT_ISSUER_DOMAIN` in the selected
   Convex development deployment, then sync `convex/auth.config.ts`.
3. Run Clerk session-token v2. Tenant resolution reads the built-in `o.id`
   claim; no custom JWT template or hand-built `setAuth` path is used.
4. Set `NEXT_PUBLIC_CONVEX_URL` and run the Next.js and Convex development
   processes.
5. Provision an organization, membership, and warehouse through the webhook
   and seed path described in
   [Identity and organization sync](./identity-and-organization-sync.md).

Steps 1, 2, and 4 need vendor accounts and are outside this repository.

## Related references

- [ADR-0009 — Degraded-online connectivity](../adr/0009-degraded-online-connectivity.md)
- [ADR-0010 — Thai-first i18n and accessibility](../adr/0010-thai-first-i18n-and-accessibility.md)
- [Inventory ledger](./inventory-ledger.md)
- [Tenant and warehouse access](./tenant-and-warehouse-access.md)
