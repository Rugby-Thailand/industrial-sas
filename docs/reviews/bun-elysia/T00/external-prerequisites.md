# External verification prerequisites

Independent Codex read-only audit, 2026-10-11. Reference:
`ca8c296b2364fcbca33df81a5b18f9e1a213ac16`. Configuration inventories checked
names only; no secrets, business records, remote changes or recipient contact.

The user clarified that provider recipients/accounts and Sentry configuration
are for later. Continue compatible tooling work; do not repeatedly request them.
Fixture tests cannot substitute for the eventual configured live acceptance.

| Item                                 | Evidence and consequence                                                                                                                                                                 | Next action                                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Main protection                      | Ruleset 24799747 requires PRs, resolved conversations, strict current checks (`check`, both `Analyze` jobs and `CodeQL`); human/code-owner approvals currently zero.                     | Preserve protection and the user's independent audits; no administrative bypass.                                                                                                                 |
| Release environments                 | `staging` and `production-release` are main-only with no reviewer approval gate. Required CI credential names are present.                                                               | Use the existing automatic controller, locks, backup and same-deployment promotion.                                                                                                              |
| Production configuration discrepancy | `convex env list --names-only --deployment greedy-cardinal-537` includes `ALLOW_LOCAL_TEST_SEED`; the runbook requires its absence. Its value and enabled behavior were not inspected.   | Reconcile through the reviewed configuration process before claiming the complete environment contract; no ad hoc removal.                                                                       |
| Staging uploads                      | Vercel environment-name inventory lacks `UPLOADTHING_TOKEN` on staging; production lists it.                                                                                             | T16 live upload acceptance awaits an identified staging UploadThing application/token. Production file-store ownership/recovery remains a separate runbook limitation.                           |
| LINE / Sent / Composio               | No matching configuration names in either inspected Vercel project, either Convex deployment or primary local environment. Other credential stores/provider accounts were not ruled out. | Configure designated sandbox flows when their tasks are reached. Explicit routing ownership must prevent LINE double sends. Calendar provider/account and allowed operations remain unspecified. |
| OpenRouter                           | Production Convex lists its key; staging Convex and both Vercel projects do not.                                                                                                         | Preserve backend-only credentials. Reviewed environment-contract changes precede any Elysia provider-hosting activation.                                                                         |
| Sentry                               | No activation/DSN/upload credential names in either Vercel project.                                                                                                                      | Remote delivery, symbolication, private artifacts and alert routing remain pending actual project configuration.                                                                                 |
| Physical cameras                     | Historical independent evidence excludes real phones; no device access established.                                                                                                      | Require physical iOS/Android verification before camera claims. Emulated mobile covers layout only.                                                                                              |

Read-only commands included GitHub rules/environment APIs, the Vercel project
environment-name API and Convex `env list --names-only`. Missing local names do
not prove that an external account or credential does not exist.

The main reference's quality run
[38107420036](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38107420036)
completed staging and production. The coordinator separately downloaded its
sanitized release artifacts: production outcome `RELEASED`, matching SHA,
completed storage-inclusive backup, candidate/live smoke each 6 passed / 0
failed / 1 optional unconfigured; staging 12 passed / 0 failed / 1 optional
unconfigured. These historical artifacts do not establish Bun runtime adoption
or verification of a later SHA.

Concurrent navigation PR #69 merged as
`9675ae7b77c7e2a1369e4ef5c520531e14b8d823`. Integrating that or any later change
requires affected evidence and gates on the final version. Phase 2 measurements
wait for the exact released Bun/Elysia version including HR/search/navigation.
