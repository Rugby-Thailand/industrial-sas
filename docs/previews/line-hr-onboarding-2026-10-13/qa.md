# Preview verification

Checked 13 October 2026 using the T3 browser. Provider/authentication operations are sample local state transitions. No live LINE message or production write was made.

| Flow exercised                                                 | Observed result                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Fresh OA credentials → webhook → inbound/reply test → activate | All three readiness checks true before activation; channel active afterwards                                        |
| EMP-002 invitation → add friend → own account confirmation     | Employee binding becomes connected and default HR assistant becomes available                                       |
| Wrong employee identity and expired invitation                 | Both refused with specific recovery copy; blocked employee binding remained blocked                                 |
| Template editing and live Card                                 | Draft changes preview; save creates version 2 while prior publication retains version 1                             |
| Dirty navigation and explicit Cancel                           | Dialog preserves draft; discard consumes editor entry; next Back returns to Bot, Forward to list; `?rev=2` retained |
| Immediate publication                                          | Selected employee recipients created; connected accepted, blocked marked blocked, app notices present               |
| Scheduled publication                                          | Scheduled recipients pending and hidden from employee feed; simulated send time publishes                           |
| Employee detail and acknowledgment                             | Only own recipient row updated; opening and acknowledgment remain separate                                          |
| Duplicate acknowledgment                                       | Exactly one receipt message persisted; subsequent tap reports already acknowledged                                  |
| Bot question → human handoff → HR reply                        | Thread enters human mode and the HR response appears in that employee's LINE mockup                                 |
| Event notification to unlinked employee                        | App notice published, LINE status remains unlinked                                                                  |
| Quiet hours for connected employee                             | LINE status quiet, app notice published; simulated queue release transitions to accepted                            |
| Repeated sample HR event                                       | Same event key does not create another publication                                                                  |
| Employee/HR draft retention                                    | Corrected input/submit handling; drafts restored after page/employee changes and full reload for both compose forms |
| Chat/HR submission after draft fix                             | Both messages persisted without URL navigation; successful sends cleared only their own compose draft               |
| Dark appearance                                                | Browser toggle changes canvas from rgb(246, 247, 249) to rgb(23, 25, 30); returns to light                          |
| Desktop and mobile card editor/chat/tracking                   | No page-wide overflow at measured 1440px and 390px widths                                                           |

JavaScript syntax check (`node --check app.js`) passed. Formatting is applied to preview-owned source. No production/navigation gate was run because production routes/source are unchanged.

The Impeccable detector was run once against this artifact: it flagged the phone's tinted elevation shadow. The shadow was changed to neutral black with a vertical offset. This report does not claim a second detector pass.

Review captures: `.impeccable/review/desktop.png`, `mobile.png`, `employee-mobile.png`, `tracking-desktop.png`. Captured in the T3 browser via DOM-to-PNG rendering in same-origin viewport frames after fonts loaded. Native `preview_snapshot` failed on the client. Internal horizontal scroll offsets may not be represented by the DOM renderer; visual findings must be checked against actual browser/source behavior. No screenshots of the real production app are claimed.

After the review fixes, all four views were recaptured. Actual browser measurements for the corrected controls in the two 390px views were at least 48px high, with no page-wide overflow. The corrected chat/reply forms were exercised again through input events and native form submission; each draft was also restored across a full page reload. These checks cover the local preview, not provider authentication or LINE delivery.
