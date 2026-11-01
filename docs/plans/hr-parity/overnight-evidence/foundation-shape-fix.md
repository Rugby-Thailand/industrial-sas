# Foundation review P3: ambiguous logo removal

Coordinator correction on 2026-11-01 at 22:40 Bangkok, after independent review
75377d68. Production change is limited to rejecting any upload field on a removal
request. No schema, public argument or UI/navigation change.

- The existing integration regression now exercises ambiguous shapes through the
  registered `hr/org:saveCompanyLogo` mutation, including `remove: true` plus
  mimeType alone and base64 alone. It asserts no logo/profile domain changes.
- Red: `pnpm exec vitest run --project integration tests/integration/hr-parity/01-org-positions.test.ts -t 'invalid logos persist' --maxWorkers 2`
  failed as expected: registered removal returned `written: true` instead of
  `LOGO_FILE_INVALID`. 1 failed, 17 not selected; duration 605ms.
- Green: complete slice01 integration command without `-t`, same worker bound,
  passed 18/18 in 839ms. Existing upload/removal/replay tests remain passing.
- Targeted normal ESLint passed. Initial Prettier check found import formatting;
  applied Prettier and rechecked. No test timeout or behavioral assertion weakened.
- No server/CLI process remains; all test/check sessions completed.

P1 employee legacy-write compatibility and P2 logo generation/revision protocol
remain separate substantive fixes. This correction does not close either finding
or establish browser/deployed-backend verification.
