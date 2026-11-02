# Employee review H1/H2 corrections

Source: independent review checkpoint `b3babeb0492d1f0c5fb9d17ae81fe7fc2918cdb3`, in its completed isolated checkout. Root made these narrow corrections; no other worktree or production data was changed. No browser acceptance is claimed.

H1: section completion now explicitly settles only its foreground scope, while the existing navigation guard serializes history-buffer removal before the live Dialog completion callback. The default settlement behavior stays unchanged. Personal, Contact, Payment and Lifecycle use the scoped option. The retained underlay stays dirty and the next Back still asks before leaving it. The actual Employees caller regression proves Personal save does not prompt, retains Display name, then checks Keep editing and explicit discard to the original list/query/hash.

H2: `buildDayDetail` returns no detail for an absent day outside the employee's intervals. Both registered self/review queries return `HR_OUTSIDE_EMPLOYMENT`, which their existing error presentation displays without correction/disposition controls. Captured days remain readable: a real registered clock-in/out followed by backdated separation/reinstatement retains the exact day detail. No attendance or frozen history is rewritten.

## Evidence

- Original two reproductions: 2 failed as expected, `/tmp/hr-final-p2-red.log`.
- First minimal completion attempt passed the new underlay case but failed seven existing completion cases. Removing explicit settlement also failed those seven. Neither attempt is delivered. Logs `/tmp/hr-final-p2-tests.log` and `/tmp/hr-final-p2-callers-v2.log` retain the failures. One unrelated EmployeesNavigation timeout also occurred in the first expanded run; no cause is attributed.
- Final scoped settlement: EmployeeProfileSections plus NavigationGuardProvider, **85/85 passed**, `/tmp/hr-final-p2-callers-v3.log`.
- Final registered hardening/review plus EmployeesNavigation and gap caller tests: **50/50 passed**, `/tmp/hr-final-p2-backend-final.log`. The caller mocks are not browser evidence.
- Navigation fixtures and inventory passed; explicit underlay regression added to the two exact section owners.
- Pinned Bun check passed, 1,087 files. Codegen passed with no generated drift; its disposable backend exited.
- Normal full lint, TS6, discovery (388 Vitest / 17 Playwright files), final format and diff checks all exited 0. Logs `/tmp/hr-final-p2-{lint,ts6,discovery,format}.log`. No full repository suite or production build was repeated for these narrow changes.
- All owned execution sessions completed: red 68152, first green 40534, first expanded 63123, unsuccessful completion variant 10526, final callers 37279, lint 70532, navigation/backend 22544, Bun/TS6 65949, codegen 1254, discovery/format 9143. No browser or application server was started; codegen cleaned its own throwaway backend.

The source includes the independent review's additional registered controls. Integration should take review-only commit `b3babeb0` plus this incremental correction commit, preserving the combined branch's roster/harness changes. There are no new public function arguments or schema changes. Expected overlapping files with roster are `self.ts` and `review.ts`; retain roster plan resolution and these explicit null-detail guards.

Clock observations jumped substantially during work; logs retain their actual timestamps. No cause is established. The 06:30 freeze was observed at 06:36, and only finishing checks/commit/cleanup followed. All work remains subject to the 07:00 stop.
