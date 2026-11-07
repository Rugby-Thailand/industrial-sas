# HR reference images

Ten employee self-service screenshots of another vendor's HR product (hrzoft) informed the [HR improvement plan](../../plans/hr-employee-self-service-improvement-2026-10-11.md). Two batches were received on 11 October 2026. This repository is public, so the images were removed from the tree on 7 November 2026. Git history keeps them; commit `4f35f6f7` still has them. The descriptions below remain so the `HRZ-` IDs cited by plans and designs stay meaningful.

## Screenshot index

| Reference | Original file    | Screen                      | Visible features                                                                                                                                                                        |
| --------- | ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HRZ-01    | `1000035362.jpg` | Employee home               | Date and time, scheduled in/out times, holiday status, work progress, scan/location/Beacon actions, eleven shortcuts, notification and announcement counts.                             |
| HRZ-02    | `1000035364.jpg` | Shortcut customization      | Eleven enabled shortcuts, drag handles, visibility switches, selected count, Cancel and Save.                                                                                           |
| HRZ-03    | `1000035366.jpg` | Request creation            | Leave, off-site work, OT, shift swap, shift change, holiday change, expense reimbursement, a greyed salary advance option, and salary certificate. Search and filters are also visible. |
| HRZ-04    | `1000035368.jpg` | Personal attendance summary | Month/year selection, payroll-period control, attendance counts, annual leave usage by type, and other request usage. One metric label is truncated and remains unidentified.           |
| HRZ-05    | `1000035370.jpg` | Annual holidays             | Year selection, month groups, date and weekday badges, holiday names, and Download. One entry is labelled WFH; its business meaning is unconfirmed.                                     |
| HRZ-06    | `1000035372.jpg` | Company announcements       | Titles, content previews, author/avatar, timestamps and blue status dots. The first title contains a pin symbol; separate pinning behavior is unconfirmed.                              |
| HRZ-07    | `1000035374.jpg` | Employee payslip list       | Employee profile header, payslip tab, year selection, four periods, descending period order, date ranges, payment dates and monthly payment type.                                       |
| HRZ-08    | `1000035376.jpg` | Masked payslip detail       | Period, date range, payment date/type, last calculation timestamp, masked earnings/deductions/net pay, visibility controls, settings icon and Download.                                 |
| HRZ-09    | `1000035378.jpg` | Payslip PIN prompt          | Six PIN slots, numeric keypad, delete, close and a password alternative over the masked payslip. Verification, retry limits and recovery behavior are unconfirmed.                      |
| HRZ-10    | `1000035380.jpg` | Revealed payslip detail     | Earnings and deductions by line, salary and OT calculation explanations, additional income, totals, net pay, visibility controls and Download.                                          |

The screenshots show UI states, not proof of the reference product's validation rules, approval behavior, attendance verification, authentication enforcement or policy calculations. Quotas, notification counts, dates, announcement policies, employee details and payslip amounts/formulas are reference content, not our company configuration.

## Adding references

Do not commit screenshots of another vendor's product to this repository. Keep the images privately, describe each one in this index, and continue the stable reference IDs from `HRZ-11`. Use a separate product prefix if a later reference comes from another application.
