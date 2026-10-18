# LINE employee preview

Interactive standalone HTML preview for the user's confirmed employee-first LINE flow. The bot assigned on each HR employee row is an HR assistant and notification sender. Customer business process remains outside this preview.

Mode: Operate. Code-led extension of established Drease/EasePOS UI. The user explicitly authorized reusing their UI and requested the complete flow; no visual-world selection is pending.

Visual sources inspected: Drease `src/features/settings/pages/SettingsLayout.tsx`, `public/css/settings.css`, `public/css/satinglass.css`, `previews/line-appt-card-header.html` and `previews/line-appointment-actions/shot-confirm.png`; EasePOS pinned source `src/components/line-preview/LinePhonePreview.tsx` and `LineSetupStepper.tsx`. Adapt their flat settings rail, blue selected controls, server-evidence stepper and branded LINE card/chat behavior to Industrial SAS employee data. Preserve current production files.

First viewport: a working connection/setup surface with three readiness stages, clear incomplete/ready state, and an obvious next task. The sidebar provides the full employee journey without decorative dashboard metrics.

Signature interaction: compose a Card with a live phone preview, send a publication to a scoped employee audience, switch to that employee, acknowledge once, and return to the HR tracking view to see the same publication/version receipt. Employee bot chat can hand off to an HR inbox; HR reply appears in that employee's chat.

Required coverage: connection credentials/webhook/test/activation; default bot and notification settings; employee roster/link/account mismatch/expiry/unlink; per-row bot override; templates and preview; immediate/scheduled sending; tracking/unlinked/blocked employees/reminder/withdrawn publication; employee LINE and in-app detail/acknowledgment/preferences; HR human handoff; browser Back, Close and retained drafts; resettable sample scenarios.

All employee names, company identity, IDs, messages, credentials and receipts are synthetic. All provider and authentication operations are local simulations. No LINE/Clerk/Convex writes. Preview state is session-local, with an explicit reset. Phone mockup is an illustration, not a production screenshot.

Quality bar: usable at 1440px and 390px; no page-wide overflow; 48px touch controls; keyboard focus and native labels; one acknowledgment receipt per employee/publication version; explicit success only after simulated completion; unread/opened and acknowledgment remain distinct; no claim of LINE delivery/read receipts. Reuse the established source vocabulary and geometry. Review and documentation are limited to this preview directory.
