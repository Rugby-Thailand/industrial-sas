# LINE employee HTML preview

Interactive preview for business-owned LINE OA onboarding, HR employee account linking, HR assistant assignment, configurable Cards, notifications, acknowledgments and HR human handoff. The business, people, credentials and events are synthetic. All actions operate on isolated browser session state; no LINE, Clerk or Convex requests are sent.

Open `index.html` with its sibling assets, or serve this folder:

```sh
python3 -m http.server 8770 --bind 127.0.0.1 --directory docs/previews/line-hr-onboarding-2026-10-13
```

Open http://localhost:8770/index.html. The top selector offers ready, fresh onboarding and LINE outage scenarios. Reset clears only this preview's sample session. Dark mode, mobile layout and browser Back work within the preview. Only the scenario and theme preferences are retained in session storage. Employee records, entered credentials, conversations, invitations and drafts stay in memory and reset on reload; legacy stored records are not restored.

## Try the complete flow

1. Select fresh onboarding. Use sample credentials, verify, configure the sample webhook, run the simulated inbound/reply test, and activate.
2. Set the default HR assistant, welcome text, notification event types and quiet hours.
3. Open Employees and connect EMP-002. The employee adds the sample OA, selects their own system identity and confirms. The mismatched-account and expired-invite paths refuse linking; renew the invitation to recover. HR may override the assistant per row. EMP-004 requires a system-member link first.
4. Edit a Card with its live phone preview. Select whether acknowledgment is required, save a new template version, and keep already published versions intact.
5. Send to selected employees, immediately or at a scheduled sample time. Unlinked/blocked employees still have the message in the app. Scheduled messages stay hidden until the preview's simulated send-time action.
6. Switch to the recipient employee. Read the in-app detail or LINE Card and acknowledge once. The HR tracking row updates for that publication version; repeated taps do not create another receipt.
7. Ask the assistant, request HR help, switch to the HR inbox, take over and reply. The reply appears in that employee's chat. Return control to the assistant when done. Composing drafts stay per employee/thread.
8. On Bot settings, try an HR event. Enabled event rules use the configured template and one publication per sample event. Quiet hours queue LINE notifications; the app notice remains available. The simulated end-of-quiet-hours action rechecks recipient eligibility.

Tracking distinguishes provider acceptance, an in-app detail opening, and explicit acknowledgment. It supports pending-recipient reminders and publication withdrawal. Withdrawal preserves earlier receipts and refuses new acknowledgments on the old Card. It does not pretend to edit already-sent LINE Cards.

## UI sources reused

- Drease: flat two-pane Settings rail and blue selected controls from `drease-v4-frontend/src/features/settings/pages/SettingsLayout.tsx`, `public/css/settings.css` and `public/css/satinglass.css`.
- Drease: Flex Card, sender row and LINE chat shell from `Drease/previews/line-appt-card-header.html` and the inspected confirmation capture in `previews/line-appointment-actions/shot-confirm.png`.
- EasePOS: readiness based on individual checks from pinned `LineSetupStepper.tsx`, and playable phone/Card interactions from `src/components/line-preview/LinePhonePreview.tsx` at frontend commit `e00d2c3eda11ecf87aa38ceb79498c30653dce5b`.

The copied patterns are adapted to Industrial SAS. The company banner inside each Card was removed at the user’s request on 14 October 2026; the message, sender row and actions remain. This preview does not establish that Drease/EasePOS already supplies the proposed employee HR bot features.

## Boundaries

This is standalone HTML with hash routes, outside production `src/app`. It adds no production route, schema, policy or integration. Production Back-aware hooks and authorization must be integrated and inventoried when implementing the actual feature. The simulation's account selector and event callbacks are not security evidence.

The general HR clocking/correction/leave modules and customer inbox are not reimplemented here. The assistant provides sample read-only information and human handoff. Production credentials, provider identity validation, signature checking, delivery reconciliation, durable workers, attendance policy, privacy/retention and real authentication remain implementation work.

Assets are local. Sarabun regular/semibold come from Google Fonts (SIL Open Font License); `qrcode-generator` 1.4.4 is MIT licensed and produces an actual QR for the local preview URL. The QR is not reachable from another phone unless this local server is exposed appropriately. `html-to-image` 1.11.13 (MIT) is a review-only DOM export helper, not loaded by the application.

## Verification

See [qa.md](qa.md), [design brief](brief.md), [artifact-local design record](DESIGN.md), [design sidecar](.impeccable/design.json), [documentation evidence](.impeccable/documentation-report.md) and the review files in `.impeccable/review`. Browser interactions were exercised in the T3 shared browser. Native snapshot capture failed on the connected client; the review PNGs are browser-rendered DOM exports of the actual source, with local fonts loaded, at 1440px/390px widths. Internal scroller positions may differ in DOM exports. This is emulated viewport verification, not a physical-device or live-LINE test.
