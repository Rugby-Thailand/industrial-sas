# แผน final: Shared UI และ HR self-service

วันที่ 12 ตุลาคม 2026 · ผู้รับผิดชอบหลัก: root agent · Branch: `codex/ui-hr-final-20261012`

ผู้ใช้อนุญาตให้เริ่มทำงานด้วย Agent และ Agent ย่อย และอนุญาตให้ merge คืนนี้เมื่อทำเสร็จและผ่านการตรวจ ไม่ต้องขออนุญาต merge ซ้ำ การอนุญาตนี้ไม่ใช่การเปิดใช้นโยบายบริษัทแทน HR หรือการเติมข้อมูลพนักงานจริงโดยคาดเดา

## ผลลัพธ์ที่ต้องได้

1. UI ที่ทำหน้าที่เดียวกันใช้ component และพฤติกรรมเดียวกัน: warehouse icon อยู่ในช่องเดียว ไม่มีกรอบซ้อน; Search และ AI Search ใช้ anatomy เดียวกัน; badge อ่านได้ทั้งสอง theme; ตัวเลขจำนวนชิดขวา; เก็บ workflow ของ catalogue, scan และ floor เดิมให้ครบ
2. Employee home, holidays, attendance, request history และ shortcut customization ใช้ข้อมูลจริงที่ server ตรวจสิทธิ์แล้ว รวมงานที่ทำก่อนหน้าเข้ากับ `main` ล่าสุด
3. HR Settings เริ่มด้วย Thailand preset ที่มีค่าเริ่มต้น ไม่ใช่แบบฟอร์มว่าง HR แก้ให้สิทธิดีกว่าได้ ระบบตรวจขั้นต่ำและสิทธิเดิมทั้ง client และ server
4. ระบบลาใช้ policy version, opening balance ที่ตรวจแล้ว และ ledger ที่ตรวจย้อนหลังได้ รวม submit, review, return/resubmit, cancellation และ attendance integration
5. Announcements มี HR publication, audience, versioned read และ notification จริง ไม่ใช้ข้อความหรือ notification จำลองจาก preview
6. Payslips เป็น private import จากไฟล์ต้นทาง มี validation และ publication ชัดเจน พนักงานเห็นเฉพาะของตน การเปิดดู/ดาวน์โหลดตรวจ identity และ fresh verification ฝั่ง server
7. เปิด workflow แต่ละส่วนได้เฉพาะหลัง HR ตรวจและ Activate policy ที่ถูกต้อง พร้อม backend capability ที่ใช้งานได้ การ merge code ไม่ Activate ให้บริษัทโดยอัตโนมัติ

## แหล่งอ้างอิงและกติกา

- [แผน UI adoption](design-sheet-system-adoption-2026-10-11.md), [แผน implementation เดิม](ui-consistency-and-hr-implementation-2026-10-11.md), [HR follow-through](hr-production-follow-through-2026-10-11.md) และ `docs/designs/hr-employee-self-service-2026-10-11/preview/app.js` เป็น scope และ acceptance; production component, permissions และข้อมูล server เป็น authority ของระบบจริง
- [Thailand preset](thailand-hr-policy-defaults-2026-10-11.md) และ [หลักฐานกฎหมาย](../references/thailand-hr-policy-evidence-2026-10-11.md) แยก legal minimum จาก suggested company setting; ใช้ maternity 120/60 ตามกฎหมายปัจจุบัน
- อ่าน `AGENTS.md` และ guide ใน Next ที่ติดตั้งก่อนแก้ app code ใช้ shared fields, panels, navigation, locale และ HR write/idempotency เดิม
- ใช้ worktree แยกจาก `origin/main` ล่าสุด เก็บงาน runtime/search และงานอื่นที่ค้างใน working tree เดิม ไม่ commit `.env`, credential, employee/pay data หรือ log ที่มีข้อมูลละเอียดอ่อน
- Policy draft, active version และ request snapshot แยกกัน Policy ใหม่ไม่เปลี่ยนการลาในอดีตหรือ frozen attendance revision; transaction retry ใช้ operation ID เดิม

## ค่าเริ่มต้นที่อนุมัติให้ทำ

| รายการ                                                | ค่าเริ่มต้น                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Annual leave                                          | 6 วันทำงานที่ได้รับค่าจ้างต่อปี เมื่อทำงานครบ 1 ปี; service-anniversary grant เป็น company default                                                                                                      |
| Sick leave                                            | ลาได้ตามที่ป่วยจริง; แยก employer-paid allowance 30 วันทำงาน/ปีจากสิทธิลา                                                                                                                               |
| Necessary personal leave                              | อย่างน้อย 3 วันทำงานที่ได้รับค่าจ้าง/ปี                                                                                                                                                                 |
| Maternity                                             | 120 วันรวมวันหยุด/ครรภ์; employer-paid 60 วัน                                                                                                                                                           |
| Spouse childbirth / qualifying continued newborn care | 15 วันตามเงื่อนไขกฎหมาย; spouse ได้ค่าจ้างเต็ม, continued newborn care 50%; preset เสนอ 15 scheduled working days เป็น company benefit ที่คุ้มครองกว่า ไม่อ้างว่าเป็น statutory counting interpretation |
| Other statutory leaves                                | Sterilization, military call-up และ qualifying training ตามเงื่อนไขของแต่ละประเภท ไม่ลดเป็น generic finite balance                                                                                      |
| Holiday / weekly rest                                 | HR ยืนยันปฏิทินจริงอย่างน้อย 13 traditional holidays รวม Labour Day และ rest ตามตารางที่ใช้จริง                                                                                                         |
| Carryover                                             | ไม่ล้างวันคงเหลืออัตโนมัติ; ยืนยันข้อตกลง/transition ก่อนกำหนด expiry                                                                                                                                   |
| Review / cancellation                                 | Supervisor ตาม scope, HR fallback, ห้าม self-review; pending ถอนเองได้; approved ขอ cancellation แล้ว reviewer ยืนยัน; started/closed-period ใช้ audited adjustment                                     |
| Announcement                                          | HR publisher, audience ในองค์กรปัจจุบัน, เลือก site ได้; read receipt ปกติ, acknowledgment off, in-app notices                                                                                          |
| Payslip                                               | Own published statements; provider fresh verification 5 นาทีเป็น suggested setting; private download ที่หมดอายุสั้น; ไม่สร้าง PIN ของเงินเดือนเอง                                                       |

## แบ่งงานและ ownership

| ชุดงาน                                    | Agent / เจ้าของไฟล์                                             | สิ่งที่ต้องส่งมอบ                                                                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W01 Latest-main integration / shared UI   | `shell_adoption_final`; Agent ย่อยตรวจ workflow เมื่อ slot ว่าง | รวม conflict โดยเก็บทั้งการปรับล่าสุดและ icon/field fix; tests ของ controls/search/catalogue/scan/floor; evidence ของ density/focus/contrast                                      |
| W02 Policy + leave backend                | `hr_policy_leave_delivery`                                      | Pure preset/validator, policy draft/save/activate, schema module, employee account reconciliation, immutable ledger, requests/review/cancel, scoped queries, integration tests    |
| W03 Policy + leave frontend               | Agent ย่อยของ W02                                               | Settings/Activate feedback, balance/request/review UI, loading/empty/error/uncertain, draft guards, Thai/English; รวม HR home/history conflict กับล่าสุด                          |
| W04 Remaining employee reads              | root; มอบ Agent เพิ่มเมื่อ slot ว่าง                            | Employee frozen-period version/list/detail, summary/export จาก frozen rows จริง; request date/search/status filter ที่ค้นทั้ง server scope                                        |
| W05 Announcement + notifications          | root หรือ lead ที่ได้ slot ถัดไป                                | Private drafts, explicit audience/publication/version, employee feed/detail/read, durable inbox, scope/idempotency tests, HR/employee UI                                          |
| W06 Imported payslips                     | root หรือ lead ที่ได้ slot ถัดไป                                | Strict source contract/import validation, private immutable publication, owned metadata/detail/download, provider capability + server verification, UI และ sensitive-access tests |
| W07 Shared integration / review / release | root                                                            | Schema registry/generated API, permissions/navigation/messages, full checks, browser evidence, PR link, CI และ merge เมื่อทุก release gate ผ่าน                                   |

Leads ต้องแตกงานที่อิสระให้ Agent ย่อยตาม slot และแจ้ง file ownership ก่อนแก้ไฟล์ ทุก Agent ทำจน scope เสร็จ แก้ test ที่ตัวเองทำให้เสีย ส่ง API contract และหลักฐานกลับมา ไม่ส่งแค่แผนหรือ mock success ไฟล์ shared (`schema`, locales, navigation, API refs, public contract fixtures) ให้ root รวมเพียงคนเดียว; schema ใช้ module fragments เพื่อลดการชนกัน

## ลำดับและ API/data contract

1. **Integration:** snapshot งานเดิม, worktree จาก latest main, รวม source ตาม intent และบันทึก conflict disposition ให้ incumbent UI/runtime ปัจจุบันไม่ถอยหลัง
2. **Policy:** per-org/capability draft + immutable versions; explicit expectedVersion และ requestId; แสดง default/source/effective date; `saveDraft` ไม่เปิดสิทธิ์; `activate` ตรวจ coverage, calendar, reviewer, opening balance และ provider/storage ตาม capability
3. **Leave:** ชนิด/eligibility/pay caps แยกกัน; units เป็น integer; grant/reserve/release/consume/adjust มี unique operation evidence; preview เท่ากับ persisted charge snapshot; submit/review/cancel atomic; sick-pay หมดไม่ใช่ปฏิเสธการลาป่วยทั้งหมด
4. **Attendance:** approved whole-day leave มี request link และ immutable original; manual HR leave ไม่คิดซ้ำ; closed period ต้องสร้าง revision; employee period reads ตรวจ linked employee และคืน exact named frozen version ไม่ตีชื่อ live total ว่า frozen
5. **Requests:** cursor ต้องมี predicate/date/search scope ที่ชัดเจน ไม่กรองเฉพาะ loaded page แล้วอ้างว่า complete; exact detail ตรวจ ownership และแสดง history ครบ
6. **Announcements:** draft/scheduled/published/version/audience แยกกัน; explicit HR publish; audience ตรวจทั้ง list/detail; read receipt ผูก employee/version; material new version unread; durable notification events ใช้ org/employee/event key
7. **Payslips:** source employee identifier/period/version ต้องตรง; blank money ไม่ใช่ zero; integer satang; duplicate/unknown employee ต้อง resolve ก่อน publish; file/document private; list metadata ไม่มี salary; sensitive API/download ตรวจ scope + fresh provider evidence; ไม่เชื่อ client timestamp หรือ mask ด้วย CSS; replacements เพิ่ม version ไม่ overwrite
8. **Gates:** server ตรวจ policy/capability ทุก write และ sensitive read; disabled/unavailable มีเหตุผลและ next step; feature หนึ่งยังไม่ activate ไม่ทำให้ attendance เดิมหรือ feature อื่นใช้งานไม่ได้

## Verification ที่ต้องผ่าน

- Agent tests: domain boundaries, legal floors/eligibility, stale policy edits, idempotency/concurrency, opening balance, ownership/audience, cancellation/reversal, closed-history preservation, import validation และ verification expiry
- UI regressions: saved clock receipts/pending/uncertain retry/draft guards, same-purpose control reuse, list/detail completeness, shortcut keyboard/pointer, loading/error/empty, Thai/English และ route registry
- Root checks: formatting ทุกไฟล์ใน PR, typecheck, lint, full unit/integration/a11y suite, test discovery, public API contract/registered coverage, credential-free Convex codegen check และ production build
- Browser ใช้ T3 collaborative preview: actual app phone/desktop, light/dark, Thai/English, keyboard focus, no overflow, warehouse/search/AI fields, new HR happy path และ refusal/uncertain paths; axe ใน supported environment; ระบุ device-only checks ที่ยังไม่ได้ทำตามจริง
- ห้ามใช้ screenshot ของ specimen หรือ mocked auth มาอ้างว่า production auth/persistence ผ่าน ห้าม seed หรือ mutate production เพื่อทดสอบ

## เงื่อนไข merge คืนนี้

1. ขอบเขตของ PR ต้องเสร็จจริงและผ่าน review ไม่มี partial/mock workflow ที่เปิดให้ใช้โดยไม่ปลอดภัย ไม่มี conflict marker หรือ source ที่ย้อนการปรับล่าสุด
2. ตรวจ `origin/main` ล่าสุดและรวม conflict ใหม่ก่อน final checks; CI ของ exact PR head ต้องผ่าน required checks ห้าม bypass branch protection
3. บันทึก implemented scope, deployment/activation order และ remaining company setup อย่างชัดเจน Backend additive schema deploy ต้องก่อน UI เรียกใหม่ และ capability gate อยู่ฝั่ง server
4. สร้าง PR และ register กับ T3 thread ทันที; root ตรวจ diff อิสระและแก้ findings ก่อน merge
5. เมื่อทั้งหมดผ่าน ให้ merge ตามสิทธิ์ที่ผู้ใช้ให้แล้ว เนื่องจาก merge อาจ trigger production release ให้ติดตาม release checks และรายงาน actual PR/merge SHA/ผลตรวจ
6. ถ้ายังไม่ครบ คืนนี้ไม่ merge เพื่อให้ทันเวลาอย่างเดียว ระบุสิ่งที่ยังไม่ผ่านและทำต่อ ไม่อ้างว่างานครบหรือ merge สำเร็จ

## Execution record

- เริ่ม worktree จาก `origin/main` ที่ `c941cc0d`; working tree เดิมที่มีงานอื่นถูกเก็บไว้
- W01–W06 implement แล้ว พร้อม Agent ย่อยและ independent review; W07 กำลังตรวจ final build, full suite, browser และ exact-head CI
- มี charge preview, same-ID resubmit พร้อม immutable revisions, announcement scheduling และ excluded payslip-row receipt ตาม acceptance
- ผูก HR intent กับ canonical employee ID และเพิ่ม clock recovery ของ action/day/request ID เดิม
- Local final checks ผ่าน: `pnpm format:check`, `pnpm typecheck` (888 files), `pnpm lint`, `pnpm test` (**281 files / 3,623 tests**), `pnpm ci:test-discovery` (281 Vitest files / 13 Playwright specs), `pnpm ci:codegen`, `pnpm build`, workflow/action-pin validation และ dependency audits ทั้ง production/app/release
- Browser regressions ผ่าน: anonymous production smoke **94 tests** และ storage workspace **42 tests**; actual authenticated app ตรวจ 8 routes แบบไทย/อังกฤษ light/dark phone/desktop ไม่มี overflow/untranslated key/scoped axe violations; compiled production CSS ตรวจ **14 theme/pointer/width combinations** ผ่าน density และ focused-invalid precedence
- [Delivery และข้อจำกัด](../reviews/ui-hr-final-2026-10-12/delivery.md), [independent adoption review](../reviews/ui-hr-final-2026-10-12/design-adoption-review.md), `browser-checks.json` และ `compiled-css-checks.json` เก็บหลักฐานแยก actual app จาก synthetic/reference checks
- PR, exact-head CI และ merge/release SHA จะรายงานจาก GitHub เมื่อได้หลักฐานจริง; ไม่มี bypass และไม่ได้ Activate นโยบายแทน HR

## ตัวอย่างใช้งานและค่าเริ่มต้นที่ HR เปลี่ยนได้

บริษัทใหม่เริ่มจากแบบร่างค่าไทย เช่น พักร้อน 6 วันทำงานเมื่อทำงานครบ 1 ปี และลาป่วยตามจริง โดยจ่ายค่าจ้างไม่เกิน 30 วันทำงานต่อปี HR เปลี่ยนพักร้อนเป็น 10 วันได้ แต่ลดต่ำกว่าสิทธิตามกฎหมายหรือสิทธิที่บริษัทเคยให้สูงกว่าไม่ได้ การบันทึกแบบร่างยังไม่เปิดรับคำขอลา HR ต้องตรวจวันหยุด ผู้อนุมัติ และยอดที่เคยใช้จริงก่อนกดเปิดใช้ เช่น ได้รับ 10 วัน ใช้แล้ว 2 วัน ระบบแสดงคงเหลือ 8 วัน ไม่สร้างยอด 10 วันใหม่ทับประวัติเดิม

ประกาศเริ่มด้วยผู้รับทั้งบริษัทและไม่บังคับยืนยันรับทราบ HR เลือกสถานที่ทำงานและให้กดยืนยันได้ การเปิดอ่านกับการกดยืนยันแยกกัน ประกาศตั้งเวลาคำนวณตามเวลาไทย และพนักงานไม่เห็นเนื้อหาก่อนถึงเวลาเผยแพร่

Payslip เริ่มจากยืนยันตัวตนใหม่ภายใน 5 นาที และสิทธิ์ดาวน์โหลดไม่เกิน 60 วินาที HR ปรับเวลาที่ระบบรองรับได้ (การยืนยัน 2–15 นาที, ดาวน์โหลด 1–60 วินาที) ช่วงเวลานี้เป็นค่าแนะนำด้านความเป็นส่วนตัว ไม่ใช่ระยะเวลาที่กฎหมายไทยกำหนด หากผู้ให้บริการไม่ส่งหลักฐานยืนยันตัวตนที่เซิร์ฟเวอร์ตรวจได้ ฟีเจอร์ยังไม่เปิดใช้

นโยบาย hash เริ่มด้วย SHA-256 และตรวจ hash ต้นฉบับก่อนเผยแพร่และดาวน์โหลด ตัวอย่าง: HR นำเข้าไฟล์ `EMP001.pdf` ระบบบันทึกลายนิ้วมือของไฟล์ ถ้าไฟล์เปลี่ยนแม้เพียงหนึ่ง byte ลายนิ้วมือเปลี่ยนและระบบหยุดส่งไฟล์ HR ตั้งได้ว่าจะบังคับแนบ hash ตอนนำเข้าหรือไม่ แต่การตรวจความตรงกันของไฟล์ที่จัดเก็บยังทำเสมอ Hash ยืนยันว่าไฟล์ไม่เปลี่ยน ไม่ได้ยืนยันว่าเงินเดือนคำนวณถูกต้อง HR ยังต้องยืนยันแหล่ง payroll และการจับคู่พนักงาน
