# HR design review package

Start with the [interactive preview](preview/index.html), served from this folder at `http://127.0.0.1:3187/preview/`. The [full plan](plan.md) has startup instructions, gaps, phased implementation and acceptance criteria.

Latest change: shortcut customization uses a single drag grip per row, with no arrow buttons. Mouse, touch and keyboard use the same grip. See the [scoped update and checks](review/shortcut-drag/review.md).

Suggested review path:

1. **Today:** clock out in the sample, inspect the receipt, then open attendance.
2. **Requests and leave:** review a returned request, resubmit it, create a leave request and check the charge/balance preview.
3. **Holidays and communications:** change the year, export the calendar, open an announcement and mark notifications read.
4. **Payslips:** open a period, cancel or complete simulated verification, hide the amounts and download the synthetic statement.
5. **Companion workflows:** use the review toolbar to select Supervisor or HR; inspect request decisions, future leave policy, announcement drafts and CSV validation/publication.
6. **Design evidence:** open Shared Action Card and the image gallery. Four component studies and ten page boards are saved with their exact prompts.

The role/state controls are review tooling. They do not represent authentication. All data and mutations are synthetic and local; only menu preferences persist after reload. The “Start sample again” button clears those preferences too. New production HR features remain future work.

Original screenshots: [reference index](../../references/hr/README.md). Exact image provenance: [manifest](manifest.json). Review evidence: [Kiro](review/kiro-review.md), [final checks](review/final-review.md), and [visual-system documentation](review/documentation-review.md).
