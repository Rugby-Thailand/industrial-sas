# UI audit rubric (frozen 2026-11-05 after Stage 0 calibration)

Use this rubric to audit each Yongkit screen. Score what the screenshots, accessibility snapshot, axe results and source show. Do not score intentions. Read `PRODUCT.md`, `docs/plans/design-system.md`, the module's section of `docs/research/ui-competitive-benchmark-2026-11-04.md` (its "Audit rubric anchors" for the module, plus the cross-cutting anchors) and `decisions.md` first. Do not score a screen down on a benchmark pattern tagged [S] (search excerpt only) by itself. Items in `decisions.md` are accepted product decisions: do not score them down.

Users: Thai warehouse workers on phones (often one-handed, gloves, glare), HR employees and reviewers, and organisation administrators. Thai is the primary language.

## 1. Severity

| Level | Meaning                                                                                     | Examples                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0    | Blocks the task or risks a wrong saved record                                               | Primary action missing or hidden; a mis-paired ticket saves with no warning; content unreadable; layout broken                                                                                   |
| P1    | Likely error, confusion or a clear slowdown on the primary path                             | No loading/empty/error state on a primary path; page-wide horizontal scroll at 390 px; WCAG AA contrast failure on primary content; touch target < 44 px on a primary control; clipped Thai text |
| P2    | Noticeable friction or inconsistency; a reference product does the same task clearly better | Hierarchy or spacing off the design system; inconsistent toolbar or action placement versus sibling screens; vague copy; weak secondary state                                                    |
| P3    | Polish nit                                                                                  | 1–2 px alignment, minor wording                                                                                                                                                                  |

## 2. Dimensions (each 1–10)

1. **Task focus.** There is one obvious next action. Primary facts (location, lot, quantity, status, date, amount) come before metadata.
2. **Hierarchy and layout.** Design-system type scale, 4 px spacing rhythm, page-width rules; canvas → card → overlay layering.
3. **Feedback and states.** Loading, empty, error, success, pending write, permission denied, camera denied/unavailable.
4. **Ergonomics.** At 390 px: thumb reach, ≥ 48 px primary targets, no page overflow, camera framing. At 1440 px: sensible use of width.
5. **Language.** Natural Thai first, English parity; wrapping without clipping; Thai-friendly line height; consistent number, date and currency format.
6. **Accessibility.** Contrast 4.5:1 for text and 3:1 for UI; visible focus; accessible names; status not shown by colour alone; reduced motion respected; axe clean.
7. **Consistency and benchmark.** Same patterns as sibling Yongkit screens, and parity with the module's benchmark anchors.

## 3. Screen score

1. Average the seven dimensions and round to the nearest integer.
2. Apply the cap from the findings:

| Findings on the screen                                                                                                             | Maximum score |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Any P0                                                                                                                             | 4             |
| Two or more P1                                                                                                                     | 6             |
| One P1                                                                                                                             | 7             |
| Three or more P2                                                                                                                   | 8             |
| ≤ 2 P2, no P0/P1                                                                                                                   | 9             |
| 10 is allowed only when you can name the reference product the screen matches or beats for this task, and there are no P2 findings | 10            |

**Screen score** = min(rounded average, cap).

Anchors: **9** = you would ship it next to the best reference product without apology; only polish remains. **8** = solid, a few P2s. **7** = works, but a primary-path issue remains. **5–6** = several primary-path issues. **≤ 4** = a blocker or wrong-data risk.

## 4. Rules

- Every finding needs **evidence**: a screenshot file and region, a DOM/a11y node, or a `file:line`. Give a concrete fix. Name the benchmark product when the finding comes from a comparison.
- Do not propose behaviour or data-rule changes as UI fixes. Report them as `type: "behaviour"`; the orchestrator sends them to the user.
- Judge each persona's own view. An employee screen is not penalised for lacking admin actions.
- Score only what is captured. If a state is missing from the capture, report it as `type: "coverage"`, not as a UI defect.

## 5. Output (JSON)

```json
{
  "auditor": "gpt-6.1-sol | opus-5.5",
  "stage": 2,
  "loop": 3,
  "commit": "<sha>",
  "screens": [
    {
      "id": "fg-scan-intake",
      "dimensions": {
        "taskFocus": 8,
        "hierarchy": 9,
        "feedback": 7,
        "ergonomics": 9,
        "language": 9,
        "accessibility": 8,
        "consistency": 8
      },
      "average": 8,
      "cap": 7,
      "score": 7,
      "findings": [
        {
          "id": "S2-017",
          "severity": "P1",
          "type": "ui | behaviour | coverage",
          "title": "Ticket lines show no scanned/expected progress",
          "evidence": "th-390-light-intake.png, top band; JobScanScreen.tsx:351",
          "fix": "Show a 1/2 → 2/2 counter on each ticket and turn completed tickets green",
          "benchmark": "Odoo 18 Barcode: per-line scanned/expected counter, done lines turn green"
        }
      ],
      "reachesNineIf": "One sentence: what is still missing for 9"
    }
  ],
  "stageScore": 7,
  "stageMedian": 8
}
```
