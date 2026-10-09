# Clerk webhook source-clock migration

The former HTTP boundary used `svix-timestamp` as the identity watermark. Svix
timestamps identify delivery attempts; a retried old event can have a newer
attempt timestamp. The changed boundary verifies the signature and attempt
freshness with Clerk's SDK, then uses the signed Clerk payload's `data.updated_at`
as the object clock and top-level `timestamp` to break ties. Deletes use the
event timestamp, even if their payload includes an older object clock. Objects
without `updated_at` also use the event timestamp. Missing, negative, fractional,
unsafe or excessively future source clocks are rejected; object clocks after
their event timestamp are rejected. The maximum tolerated future event skew is
five minutes, matching the signature verifier's freshness allowance.

Installed `@clerk/backend` 3.16.4 verifies the raw body but drops top-level
`timestamp` from its returned event and type. The handler retains a clone of the
same request and reads the clock from that body only after SDK verification
succeeds. Invalid signatures never reach normalization or database writes.

## Additive rollout and legacy records

`clerkLastEventTimestamp` is optional on organizations, users and memberships.
No existing field or index is removed. The internal mirror event accepts the
optional `eventTimestamp` clock; signed HTTP events always supply it. Public
function arguments/results do not change. The reviewed internal-function
contract snapshot needs a refresh for this additive argument field.

An existing row without `clerkLastEventTimestamp` retains its old
`clerkLastEventAt` as a conservative floor. Upserts at or below that floor remain
stale even if their top-level timestamp is later; a strictly newer object clock
can advance the row and install the source clock pair. There is no automatic
watermark reset, bulk backfill, data restore, or reinterpretation of a delivery
clock as a source timestamp. A terminal deletion still closes/deactivates/revokes
the external ID when its source clock is below that floor, while retaining the
floor. This prevents the migration from leaving a revoked legacy identity active.

Deleted users and revoked membership IDs stay inactive on later upserts.
Organization upserts preserve local suspension/closure. A valid re-add creates
a new membership ID with default `WAREHOUSE_SCOPED` access and no inherited role
or warehouse grants. Tenant lookup reads the exact ACTIVE and SUSPENDED buckets
with at most two rows each, excludes historical REVOKED rows, and denies multiple
current memberships. Existing suspension, tenant and user checks still apply.
Authorization uses that same bounded current-membership selection.
The current Clerk token carries user/organization claims, without a local
membership ID. The backend therefore selects the current membership; it cannot
distinguish a previously issued same-user/same-organization JWT by membership ID.
Clerk token expiry/revocation remains the authentication boundary. Historical
membership grants are never inherited by the new membership.

Membership payloads provision absent embedded organizations/users but never
overwrite an existing parent's metadata, status or clock. Each object's own
lifecycle events maintain its source watermarks. Embedded provisioning does not
assign a membership clock to those separate objects.

## Recovery and verification

Deploy and verify this change on the dedicated staging backend before enabling
the prepared Clerk endpoint. Use only namespaced synthetic identities; the
existing development Clerk instance is shared, so the endpoint receives matching
events for that instance. Do not use broad cleanup or real identity inventories.

The signed registered HTTP suite covers late retries after deletion, object
clock ties, replay, legacy floors, deletion below a legacy floor, re-add with a
new membership ID, ambiguous current membership denial, parent identity
isolation, missing/future clocks, bad signatures and missing signing secret.
Re-run the tenant/isolation suites and schema compatibility checks before rollout.

Legacy floors can delay otherwise legitimate metadata updates. Reconcile an
affected identity only through a separately reviewed operator procedure that
checks its current authoritative Clerk state and exact local identity. Preserve
tombstones and scoped grants; do not delete/reset watermarks or replay a broad
historical event range to force updates. No reconciliation tool is introduced by
this change and no production records were inspected or modified.

A frontend rollback does not revert this backend boundary. Reverting the backend
to delivery-clock ordering would reopen the bug. Keep the optional schema field
and use a forward fix if staging exposes a provider-contract difference.

Sources: [Clerk payload clocks and delivery ordering](https://clerk.com/docs/guides/development/webhooks/overview)
and [Svix attempt timestamps and signature verification](https://www.svix.com/guides/receiving/receive-webhooks-with-javascript-express/).
