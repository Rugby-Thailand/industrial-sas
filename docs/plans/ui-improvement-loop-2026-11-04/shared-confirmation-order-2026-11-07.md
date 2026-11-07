# Confirmation action order

On phones, the shared unsaved-work prompt and confirmation shell displayed their actions in the reverse of keyboard and DOM order. Keep editing / Cancel appeared below Discard / Delete, while Tab reached Keep editing / Cancel first. Desktop already matched.

The two callers now override `DialogFooter` with `flex-col`. Responsive desktop `sm:flex-row` remains in effect. Button order, labels, handlers, pending protection, disclosure ownership and the navigation state machine are unchanged. The generic footer default is unchanged, so unrelated callers keep their existing layout.

## Evidence

The unchanged-source browser baseline reproduces the mismatch in all four phone combinations: real guard and ConfirmDialog components, Thai/light and English/dark, at 390 px. All four corresponding 1440 px desktop combinations already match. Actual Tab transitions, button rectangles, screenshots and callback checks are retained in `output/ui-loop/shared-confirmation-order/before/`.

This uses a credential-free Vite fixture importing the real components and current global CSS. Next routing is stubbed and callbacks are synthetic counters; no authentication, backend or business writes occur. It verifies component layout and interaction, not current production caller navigation or physical device coverage. Stage 2's separate actual application traces in `loop-5-footer-proof/report.json` independently showed the same guard/delete reversal before this change.

The presentation inventory's semantic targets and state ownership do not change. Fresh Stage 2/4 caller captures and runtime checks remain required at their next source boundaries; frozen audit inputs are preserved.

## Validation

The same eight current-source browser cases now all match visual and actual Tab order, with zero overflow, axe violations or page errors. All four desktop rectangle arrays are byte-for-byte equal as JSON values before and after; all eight Tab sequences are unchanged. Keep / Cancel retains the local draft or leaves the confirmation count at zero; Discard / Confirm invokes its synthetic action once.

All 107 existing tests across the four NavigationGuardProvider suites and ForegroundOrdering pass with one worker and default timeouts. The navigation gate, normal full ESLint and source formatting results are bound in the accompanying check receipt.

The phone images were inspected directly. Focus remains visible on the destructive action; button heights remain 48 px on phone and 36 px on desktop. The fixture uses the current stylesheet with system fallback fonts, so these captures establish ordering and interaction rather than the application's production font loading.

[Before/after measurements](shared-confirmation-order-evidence/after.json), [Thai guard after](shared-confirmation-order-evidence/after-guard-th-light-390.png), and [English confirmation after](shared-confirmation-order-evidence/after-confirm-en-dark-390.png). The real-component fixture and runner are archived as `.txt` sources for reproduction at their original output-directory paths.
