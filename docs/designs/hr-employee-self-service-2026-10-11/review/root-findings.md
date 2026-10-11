# Root review observations for final verification

Confirmed by initial browser checks: 17 core journeys passed after test timing/isolation corrections. Edge tests found shared holiday/payslip year state and stale valid rows after invalid replacement import; returned resubmission, duplicate ID validation and real 60-second remasking passed. Kiro's retry packet includes those defects.

Visual observations before fix batch: `.panel + .panel` adds margin to grid children and misaligns leave/component cards. Mobile leave cards should stack at readable width. Kiro's packet includes both.

Additional detail to verify after fixes: the local clock-out action creates an original punch on 12 October. Its `originalEnd` must become 17:30 along with effective `end`. A certified correction on 6 October must keep `originalEnd` missing and change only effective `end`. These are distinct evidence paths. Reviewer comparisons must read each matching day's actual original rather than always hard-coding “missing”.

Persona changes are review controls, not access enforcement. If the Kiro fix isolates the reviewer persona from Mintra's employee pages, tests must switch back to the employee explicitly before inspecting Mintra's own balances/day/payslip; that preserves the real test intent.

The first Kiro process wrote a small partial patch as it stopped; the retry read that state. Final syntax/runtime checks must cover the combined result, including renaming shared selector state consistently.
