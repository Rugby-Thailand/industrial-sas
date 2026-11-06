# S02 work-rules foundation (inactive configuration)

Scope: storage and neutral validation for the HRZoft work-condition and OT settings observed in S02-01, S02-02, S02-10, S02-11 and S02-12. This is not HRZoft parity. No setting changes attendance, leave, OT or payroll behavior.

## Where it lives

- `convex/model/hr/workRules.ts`: Convex validator, `WorkRules` type, `validateWorkRules`, and `WORK_RULES_EXECUTION`.
- `convex/model/hr/policy.ts`: `PolicyConfig.workRules` is optional. `validatePolicy` runs the work-rule check after the unchanged leave floors. `validatePolicyCapability` allows `workRules` only on the `LEAVE` capability.
- `convex/hr/policies.ts`: the existing `current`, `saveDraft` and `activate` handlers. They keep HR admin permission, org-wide scope, `hrCommand` idempotency/audit, `expectedVersion` stale checks and immutable activation. `current` (LEAVE) also returns `workRulesExecution`. The `saveDraft` audit records `workRules: NONE | STORED_INACTIVE`.

No new table, capability, route, UI control or translation was added. `thailandDefaults()` returns `LegacyPolicyConfig` (the config without `workRules`), so legacy drafts, versions and leave-request snapshots stay unchanged. The existing policy screen spreads the whole config when it saves, so stored work rules survive a leave-policy edit from that screen. A save that omits `workRules` clears them, the same full-replacement rule every other config field follows.

## Stored fields (all optional, no defaults)

| Field                                                                        | Observed control                      | Accepted values                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| `attendance.lateAfterMinutes`, `veryLateAfterMinutes`, `absentAfterMinutes`  | three minute thresholds (E1)          | safe integers 0–1440. Present values must strictly increase, including across a gap     |
| `attendance.excludeGraceMinutesFromLate`                                     | ยกเว้นนาทีที่ใช้นับเป็น สาย           | boolean, stored only                                                                    |
| `overtime.automaticCalculation`                                              | คำนวณโอทีให้อัตโนมัติ                 | only `false`; `true` is refused with `…automaticCalculation:UNSUPPORTED`                |
| `overtime.beforeShiftStartMinutes`, `afterShiftEndMinutes`, `minimumMinutes` | pre/post-shift start and minimum (E2) | safe integers 0–1440                                                                    |
| `overtime.maximumOutsideShiftMinutes`                                        | maximum outside-shift OT              | 1–1440. Omitted means no cap is configured (demo: ไม่จำกัด). Must be ≥ `minimumMinutes` |
| `overtime.rounding`                                                          | ปัดลง every N minutes                 | `{ direction: "DOWN", intervalMinutes: 1–1440 }`; other directions refused              |
| `overtime.eligibility.requirePassedProbation`                                | ผ่านทดลองงาน                          | boolean                                                                                 |
| `overtime.eligibility.minimumTenureDays`                                     | อายุงานขั้นต่ำ                        | safe integer 0–36500                                                                    |
| `overtime.eligibility.excludedGroupKeys`                                     | excluded groups                       | ≤ 50 unique opaque labels, 1–80 chars, no surrounding whitespace or control characters  |

Unknown keys at any level are refused, so penalty points, OT rates and similar fields cannot be stored by accident. Errors use the existing `POLICY_INVALID` code with the field path (for example `workRules.attendance.veryLateAfterMinutes:ORDER`). The limits are shape guards, not business rules.

## Why the settings cannot affect attendance or payroll yet

`WORK_RULES_EXECUTION` reports `attendanceClassification`, `lateGraceArithmetic` and `overtimeEligibility` as `INACTIVE`, and `overtimeCalculation` and `payroll` as `UNSUPPORTED`. Nothing reads `workRules` apart from validation and persistence. `convex/model/hr/attendance.ts` still excludes lateness judgments and OT entitlement. The research marks every calculation below as a guess (S02-07, S02-13, S02-14) or unknown (S02-25).

Open business decisions, all needed before any of these settings can be activated:

1. Threshold boundaries: whether a threshold is inclusive (late at exactly 5 minutes?), and how seconds round to minutes.
2. Status ordering: whether equal thresholds are legitimate. This foundation refuses them, so the decision only loosens validation later.
3. Grace arithmetic: whether the grace checkbox subtracts minutes, moves the status threshold, or only hides the display.
4. OT order: the sequence of eligibility, minimum, cap and rounding, and whether the minimum applies to raw or rounded minutes.
5. Cap versus entitlement: whether a configured maximum may reduce paid OT. A cap must not remove a statutory payment entitlement (Labour Protection Act s.61–63).
6. Eligibility precedence: whether probation, tenure and group exclusion combine as AND, and how they interact with statutory exemptions.
7. Groups: which entity an excluded group key refers to. No employee-group model exists yet, so keys are unresolved labels.
8. Probation and tenure source: how "passed probation" and completed tenure days are derived (S02-05 and S02-25 are open).
9. Automatic OT: the conditions under which automatic calculation may be enabled, and its approval interaction (slice 06).
10. Payroll categories: the 1x/1.5x/2x/3x holiday/OT rate handling (S02-14), which needs legal review of current amendments.

## Tests

- `convex/model/hr/workRules.test.ts` (unit-node): numeric boundaries (negative, fraction, NaN, Infinity, beyond safe integer, zero, the 1440/36500 limits), ordering, the automatic-OT refusal, rounding, group labels, unknown keys (including an empty key at each nesting level), legacy configs without settings, and the capability guard.
- `tests/integration/hr-work-rules-policy.integration.test.ts` (integration, in-process convex-test): the real exported `current`, `saveDraft`, `activate`, `reconcileOpening` and `leave.preview/submit` handlers. Covered: save/read/reload/replace/clear, legacy save, invalid input with no draft write and a DENIED audit row, non-LEAVE refusal, employee denial, site-scoped admin refusal, cross-tenant isolation, stale version, replay and payload conflict, the activation snapshot, and an unchanged leave submission that carries the snapshot. Registered-function cases also exercise the public Convex argument validator, competing saves at one expected version, and membership revocation before a saved command is replayed.

These tests do not cover a deployed backend, a browser or UI. The research skeletons in `tests/{integration,e2e}/hr-parity/02-rules-calendar-roles.*` remain `todo`/`fixme` because their arithmetic is still unconfirmed.
