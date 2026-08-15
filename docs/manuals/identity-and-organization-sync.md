# Identity and organization synchronization manual

Status: **Development wiring implemented; external instance not connected.** The
signed Clerk webhook route, idempotent mirror, Clerk middleware, provider bridge,
Convex auth config, and sign-in UI are implemented and tested. The development
Clerk instance, signing secret, and end-to-end authenticated smoke test remain
external setup work.

## Who this is for

- Platform operators configuring Clerk and Convex
- Tenant administrators who need to understand automatic provisioning
- Developers diagnosing organization, user, or membership synchronization

## What the feature does

Clerk owns authentication and organization membership. Industrial SAS mirrors only
the identity data needed for tenant access:

- organizations: external ID, display name, status, and event watermark;
- users: external ID, display name, preferred locale, status, and watermark;
- memberships: organization/user references, membership status, scope mode, effective
  dates, and watermark.

Passwords, tokens, and other credentials are never mirrored.

## Supported events

- `organization.upsert` and `organization.delete`
- `user.upsert` and `user.delete`
- `membership.upsert` and `membership.delete`

An applied event returns one of three internal outcomes:

- `APPLIED`: the mirror changed;
- `REPLAY`: the same delivery was already processed;
- `STALE`: a newer event for the entity already won.

## Provisioning flow

1. Clerk sends a signed `POST /webhooks/clerk` request.
2. The handler verifies the signature before reading the event as trusted data.
3. The delivery ID and timestamp are validated and the Clerk event is normalized.
4. Unsupported event types return HTTP `204` without changing data.
5. A supported event is applied idempotently through an internal Convex mutation.
6. Creating an organization also applies safe defaults and seeds the code-owned
   permission catalogue, eight editable tenant roles, and their mappings in the same
   transaction.

New organizations default to Thai locale, THB, and `Asia/Bangkok`. Serial tracking,
mixed handling-unit content, consigned stock, negative available inventory, and
support grants start disabled.

## HTTP outcomes

| Status | Meaning                                                                    | Operator action                                                           |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `204`  | Supported event applied/replayed/stale, or event intentionally ignored     | None                                                                      |
| `400`  | Signature, delivery metadata, or normalized payload is invalid             | Check Clerk endpoint/signing configuration; do not replay a modified body |
| `503`  | Signing secret is missing or the internal mirror could not apply the event | Restore configuration/backend health, then let Clerk retry                |

Responses are deliberately PII-silent. Use delivery IDs, structured logs, and audit
records for diagnosis; do not add raw webhook bodies to logs.

## Configuration checklist

1. Create the Clerk application and organization configuration.
2. Activate Clerk's Convex integration and use session-token v2 (`o.id`).
3. Deploy Convex and generate the server bindings.
4. Set `CLERK_WEBHOOK_SIGNING_SECRET` in the Convex environment.
5. Register the deployed `/webhooks/clerk` URL in Clerk.
6. Subscribe only to the supported organization, user, and membership events.
7. Send a test event and confirm HTTP `204` plus the expected mirrored row.
8. Replay the same delivery and confirm it does not duplicate data or reset edited
   tenant roles.

## Important rules

- Clerk organization is the tenant boundary; do not create a second tenant identity
  from request data.
- Deletion events change mirrored lifecycle state; they do not erase historical audit
  or ledger data.
- A seed rerun preserves tenant-edited roles. New catalogue permissions require an
  explicit migration for existing tenants.
- Control characters, empty identifiers, and overlong identifiers are rejected.
- Never expose the internal identity mutation as a public function.

## Troubleshooting

- Repeated `400`: verify the exact deployed URL, signing secret, proxy body handling,
  and the `svix-id`/`svix-timestamp` headers.
- Repeated `503`: verify the secret exists and the Convex internal mutation is
  available; Clerk retries should reuse the original delivery.
- Membership exists in Clerk but access is denied: confirm the membership mirror is
  active, effective now, and associated with the active Clerk organization claim.
- Tenant role edits disappeared: stop; reseeding must never overwrite existing role
  composition. Treat this as an incident.

## Implementation references

- `convex/http.ts`
- `convex/lib/clerkWebhook.ts`
- `convex/lib/clerkWebhookNormalizer.ts`
- `convex/lib/identityWebhook.ts`
- `convex/lib/identityMirrorConvex.ts`
- [Clerk identity integration contract](../integration-contracts/clerk-identity.md)
