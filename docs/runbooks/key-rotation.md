# RB-07 — Key and secret rotation

Status: **skeleton, never executed.** No secrets exist in any environment because no
environment exists. Evidence gate: `RG-060` (rehearsed), `RG-059` (environment separation).

## Secret inventory

Names only. No value ever appears in this repository or in any runbook
(`INV-0012-05`). Tracked names live in [`.env.example`](../../.env.example).

| Secret class                      | Owner    | Rotation trigger                            | Notes                                             |
| --------------------------------- | -------- | ------------------------------------------- | ------------------------------------------------- |
| Identity provider API keys        | Platform | Scheduled, staff change, suspected exposure | Per environment; never shared across environments |
| Identity webhook signing secret   | Platform | Scheduled, suspected exposure               | Rotation needs an overlap window (see below)      |
| Convex deployment keys            | Platform | Scheduled, staff change                     | Separate per environment                          |
| File-storage vendor token         | Platform | Scheduled, suspected exposure               | Revoking invalidates in-flight upload grants      |
| Export encryption key             | Platform | Scheduled                                   | Old keys retained while old exports exist         |
| Telemetry ingestion keys          | Platform | Low sensitivity, scheduled                  | Rotate without downtime                           |
| Outbound integration HMAC secrets | Platform | Per integration agreement                   | Coordinate with the consumer                      |

`TODO` Secret storage location per environment — blocked by `RG-059`.
`TODO` Rotation schedule per class — blocked by `RG-048` (security measures documentation).

## General procedure

1. **Confirm scope.** Which environment, which secret, and whether this is scheduled or
   incident-driven. Incident-driven rotation follows
   [`RB-01`](./incident-response.md) first.
2. **Prefer overlap over cutover.** Where the vendor supports two active secrets, add the
   new one, deploy, verify, then remove the old one. A hard cutover means downtime and a
   guaranteed webhook gap.
3. **Rotate.** Create the new secret in the vendor console, store it in the environment's
   secret store, and deploy.
4. **Verify** the dependent path explicitly, not just that the app starts:
   - Identity keys: a sign-in and a token verification.
   - Webhook secret: a signed test event is accepted and a stale-signature event is rejected.
   - File storage: an upload grant and a signed download.
   - Export key: an export is produced and decrypts.
   - Outbound HMAC: the consumer accepts a delivery.
5. **Revoke the old secret** and confirm the old value now fails.
6. **Reconcile anything missed during the window.** For webhooks, run the membership
   reconciliation job to catch events rejected mid-rotation
   ([Clerk contract](../integration-contracts/clerk-identity.md)).
7. **Record.** Secret class, environment, times, verification results, and any gap observed.

## Suspected exposure (destructive, urgent)

1. Treat as a P0/P1 incident (`RB-01`).
2. Revoke first, restore service second. An exposed credential is worse than a short
   outage.
3. Assess what the credential could reach and whether tenant or personal data was
   accessible; if so, follow the PDPA assessment path (`RG-048`).
4. Rotate every secret that shared the exposure path, not only the one known to be leaked.
5. Check the repository history for the value; if a secret was ever committed, treat it as
   permanently exposed regardless of later removal.

## Never

- Paste a secret value into a ticket, chat, log, or this runbook.
- Reuse a secret across environments.
- Rotate a webhook signing secret without an overlap window or a reconciliation pass.
- Skip verification because the deploy succeeded.

## References

- [ADR-0012 — delivery and environments](../adr/0012-delivery-release-and-quality-gates.md)
- [ADR-0008 — adapter configuration](../adr/0008-adapter-ports-and-release-gates.md)
- Plan §14
