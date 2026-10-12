# Codex Spec review

Reviewed `git diff 11c8c2cc65173e252b2464150cccdda092b0235d...b90281c4` and its one implementation commit against the 17 requirements in [the plan](./README.md), including the user's final clarifications.

## Finding at the reviewed commit

1. **P2 — UX-06: an active submenu can remain collapsed after a rapid drawer reopen.** In `SidebarNavigation.tsx`, `NavigationSubmenu` initializes `expanded` from `active` and restores it only when `activeHref` changes. The plan requires “หาก navigation รุ่นจริงมีกลุ่มพับให้เปิดกลุ่มของ active item” (open the active item's collapsed group). In Chromium at 390 × 844, with the real shell and a synthetic permitted `/hr/leave/review` route, collapse **Leave**, close the drawer, then reopen on the next animation frame. The component survives its closing animation: **Leave** still has `aria-expanded="false"`, and the active **Review leave** link has no bounding box. The new scroll hook therefore cannot reveal it. Restore the active group on every fresh mobile opening while retaining manual collapse during that opening.

No other missing, incorrectly implemented, or unasked behavior was found in the scoped diff. The scanner changes are opt-in only at the Job location step; default acquisition controls remain available. Mobile map reopening retains selection and camera state; the dimensions helper changes display only and preserves unknown suffixes. Export retains the existing frozen scope and lifecycle. Specific Search action descriptions remain while generic page actions and the requested disclosure are removed.

## Post-review disposition

Codex added fresh-mobile-opening tracking to `NavigationSubmenu`. The identical Chromium reproduction now reports `aria-expanded="true"`; the active link is visible within the drawer's scroll bounds. Manually collapsing the group afterward still works. This verification used browser fixtures with synthetic grants, without backend writes. The original finding above remains the result for pinned commit `b90281c4`.

**Result:** one Spec finding at the reviewed commit; its working-tree repair passed the reproduction.
