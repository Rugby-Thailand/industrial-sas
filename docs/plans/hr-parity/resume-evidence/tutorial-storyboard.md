# HR tutorial storyboard (draft, no footage)

Status: plan only. Nothing was recorded. Each shot below must be captured from a real verified run on the corrected source, with test data only, after Sol's browser acceptance passes for that flow. Shots whose acceptance is still missing are marked **gate**; drop or replace them if the gate is not met. Labels are the current English UI strings in `messages/en.json`; record a Thai pass separately if wanted.

Constraints for the recording:

- Test tenant and seeded test employees only. No real names, national IDs or bank numbers. Mask nothing by blurring after the fact; type obviously fake values instead.
- No Clerk sign-in screens, tokens, URLs with secrets or browser profile chrome in frame.
- No voiceover unless asked. On-screen captions may describe what happens; they must not claim behaviour that the shot does not show.
- At most three flows per video. These three can be one video with chapters or three short videos.

## Video 1 — Company and organisation (slice 01)

Route: HR settings (`/hr/settings`, sections `company`, `branches`, `organization`). Prior browser evidence exists on an older revision; rerun on corrected source before recording.

| #   | Shot                         | Action on screen                                                                                               | Caption (draft)                                                          |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1.1 | HR settings, Company details | Fill Company name, Company name (English), Tax ID (13 digits), address fields, phone                           | "Enter the company's legal details. The tax ID must have 13 digits."     |
| 1.2 | Bank accounts                | Add account, fill Bank / Account number / Account name; add a second; Remove account 2                         | "The first account is stored as the primary account."                  |
| 1.3 | Save                         | Save company profile, reload page, values remain                                                               | "Saved details persist after reload."                                    |
| 1.4 | Company logo                 | Choose a PNG; logo shows; Remove logo                                                                          | "Choosing a logo uploads it separately from Save. Wait for the saved preview."                            |
| 1.5 | Branches                     | Add branch: head office, Revenue Department branch number 00000, Social Security employer account; Save branch | "The head office uses branch number 00000."                   |
| 1.6 | Organisation masters         | Add a department, a position and a level                                                                       | "Departments, positions and levels become choices on the employee form." |
| 1.7 | Employee form                | Open an employee, pick branch, department, position, level; save; reload                                       | "Assignments are stored on the employee."                                |

Not shown (not implemented): company selector or affiliated companies, Thai address master pickers, configurable running numbers.

## Video 2 — Employee profile and lifecycle (slice 03)

Route: Employees (`/hr/employees`) → employee editor. Desktop personal/contact/emergency/payment persistence passed in a prior browser run; committed-reload recovery and lifecycle are **gate** (not yet browser-accepted on corrected source).

| #            | Shot                  | Action on screen                                                                                                      | Caption (draft)                                                           |
| ------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 2.1          | Employee editor       | Edit personal details: First name, Last name, Nickname, Date of birth; Save                                           | "Personal details open in a dialog over the editor."                      |
| 2.2          | Contact and emergency | Edit contact details: Email, Phone, LINE ID; then emergency contact Name, Relationship, Phone                         | "Contact and emergency details are saved separately."                     |
| 2.3          | Cancel safety         | Type a change, press Back, choose Keep editing, then Cancel and Discard                                               | "Back or Cancel asks before discarding a typed draft."                    |
| 2.4          | Payment details       | Edit payment details: Pay by Bank, Bank, Account number, Account name; Save; the number shows masked                  | "Payment details need HR administration permission. The summary masks the account number."                  |
| 2.5 **gate** | Lifecycle: probation  | Confirm probation with today's date                                                                                   | "Probation confirmation is dated and recorded in the employment history." |
| 2.6 **gate** | Lifecycle: offboard   | Record resignation or termination: type, last working day (at least two days ago), reason; the employee leaves the default list | "Offboarded employees are kept, but drop out of the default list."        |
| 2.7 **gate** | Lifecycle: reinstate  | Reinstate with a later effective date; the gap stays in history                                                       | "Reinstatement keeps the separation gap."                                 |

Not shown (not implemented): 15-tab profile layout, salary and documents tabs, Excel import/export, final leave settlement. The profile is sections on the editor page.

## Video 3 — Fixed shifts and the monthly roster (slice 04)

Routes: Shifts (`/hr/shifts`) and Work roster (`/hr/roster`). **gate**: no roster browser test exists yet; every shot here waits for Sol's acceptance.

| #   | Shot            | Action on screen                                                                                        | Caption (draft)                                                                       |
| --- | --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 3.1 | Shifts          | Choose a site; Add shift: Shift code, Shift name, Colour, working time, break minutes; save             | "Shifts are named fixed working times for one site."                                  |
| 3.2 | Overnight shift | Add a night shift ending the next day                                                                   | "A shift can end on the next day."                                                    |
| 3.3 | Work roster     | Pick the site and month; the employee × date grid shows the weekly schedule                             | "The roster shows each employee's plan for every date of the month."                  |
| 3.4 | Assign          | Assign shifts; select several cells; choose the night shift; Save assignment                            | "Select dates, choose one shift, OFF or the weekly schedule, and save them together." |
| 3.5 | OFF and Clear   | Assign OFF to one date; Clear (use weekly schedule) on another                                          | "OFF is an explicit day off; Clear returns the date to the weekly schedule."          |
| 3.6 | Locked cells    | Hover a recorded day and a date with a pending leave request; both cells are disabled with their reason | "Locked dates cannot be selected."          |

Not shown (not implemented): hour-count and freelance shift modes, break windows, rotations/repeat patterns, auto-OT, retroactive recalculation, leave overlays on the grid.
