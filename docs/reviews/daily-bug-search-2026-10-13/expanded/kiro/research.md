# Expanded bug research (Kiro) — 13 ตุลาคม 2026

ตรวจ working tree ปัจจุบัน (HEAD `733c6aca` + งานที่ยังไม่ commit ของผู้อื่น) โดยไม่แก้ production code, test เดิม, config, navigation inventory หรือรายงานเดิม สิ่งที่เขียนทั้งหมดอยู่ในโฟลเดอร์นี้เท่านั้น

**สรุป:** พบ **11 ข้อใหม่ที่ยืนยันได้** (P1 ×1, P2 ×6, P3 ×4) ทำซ้ำได้จริงด้วย probe 10 ข้อ ส่วน KIRO-08 ยืนยันด้วย runtime บางส่วนร่วมกับเอกสาร Convex อย่างเป็นทางการ ไม่นับซ้ำกับ DAILY-01..03 ใน [README ฉบับก่อน](../../README.md) และไม่ได้เติมรายการให้ถึงเป้า 12–18 ข้อ เพราะ candidate ที่เหลือไม่มีหลักฐานพอ (ดูหัวข้อสมมติฐานที่ตัดทิ้ง)

ระดับหลักฐาน:

- **Runtime reproduced** — probe เรียก registered Convex handler จริงใน `convex-test` (in-memory) หรือ render component จริง และ assertion ของพฤติกรรมที่ควรเป็นล้มบน source ปัจจุบัน
- **Source + doc** — เห็นได้จาก source และเอกสารทางการ แต่ไม่สามารถรันส่วนที่ขึ้นกับ runtime ภายนอก (Convex subscription) ได้
- **Hypothesis** — ไม่ได้นำมานับเป็น finding

## ตารางจัดอันดับ

| อันดับ | ID      | P   | ความมั่นใจ | หมวด                  | หัวข้อ                                                                                          | หลักฐาน               |
| ------ | ------- | --- | ---------- | --------------------- | ----------------------------------------------------------------------------------------------- | --------------------- |
| 1      | KIRO-01 | P1  | สูง        | HR lifecycle / period | แก้วันเริ่ม/สิ้นสุดงาน แล้วเวลาทำงานที่บันทึกไว้หายจากงวดและ CSV โดยไม่มีคำเตือน                | Runtime               |
| 2      | KIRO-02 | P2  | สูง        | Attendance schedule   | แก้ตารางงาน/วันหยุดย้อนหลัง ทำให้วันขาดงานหายและเกิด exception ปลอม                             | Runtime               |
| 3      | KIRO-08 | P2  | กลาง-สูง   | Shared async / Convex | หน้า Today และค่า today ไม่อัปเดตเมื่อเวลาผ่านไป ข้ามวันแล้วไม่มีปุ่มลงเวลาเข้า                 | Runtime บางส่วน + doc |
| 4      | KIRO-04 | P2  | สูง        | Authorization / scope | HR admin ที่จำกัดคลัง A เพิ่ม/ถอนสิทธิ์ HR ของสมาชิกคลัง B ได้                                  | Runtime               |
| 5      | KIRO-03 | P2  | สูง        | Authorization / HR    | HR admin รับรองเวลาของตัวเองได้ โดยยกเลิกการเชื่อมบัญชีก่อน                                     | Runtime               |
| 6      | KIRO-05 | P2  | สูง        | Period / bounds       | มีประวัติพนักงานในคลังเกิน 99 รายการ งวดและคิวตรวจของ admin ใช้ไม่ได้อีก แม้คนที่ยังทำงานมีน้อย | Runtime               |
| 7      | KIRO-10 | P2  | สูง        | Draft protection      | ฟอร์มพนักงานที่ยังไม่บันทึกถูกล้างเงียบ ๆ เมื่อ admin อีกคนบันทึก record เดียวกัน               | Runtime (UI)          |
| 8      | KIRO-07 | P3  | สูง        | Corrections           | ฟอร์มขอแก้เวลาตัดวินาที ด้านที่ไม่ได้แก้จึงถูกแสดงว่า “เปลี่ยน” และเวลาเลื่อน                   | Runtime               |
| 9      | KIRO-06 | P3  | กลาง-สูง   | Attendance state      | รับรองคำขอแก้ระหว่างกะที่ยังเปิดอยู่ แล้วพนักงานลงเวลาออกไม่ได้                                 | Runtime               |
| 10     | KIRO-09 | P3  | สูง        | AI Search grounding   | “งวด 1-15 ต.ค.” ที่ไม่ระบุปีและยังไม่จบงวด ถูกตีความเป็นปีที่แล้ว                               | Runtime               |
| 11     | KIRO-11 | P3  | สูง        | Period UI             | รายการ “วันที่ยังเปิด” ตัดที่ 200 แถวโดยไม่แจ้ง exception ท้ายรายการจึงไม่แสดง                  | Runtime (UI)          |

เกณฑ์จัดอันดับ: ความรุนแรงต่อข้อมูลหรือสิทธิ์ก่อน แล้วจึงดู reach/ความถี่ และความมั่นใจ ความยากในการแก้ไม่ใช้ลดระดับข้อที่ทำให้ข้อมูลสูญหาย KIRO-07 อยู่เหนือ KIRO-06 แม้เป็น P3 เหมือนกัน เพราะเกิดกับคำขอแก้เวลาเกือบทุกครั้ง (เวลาจาก server มีวินาทีเสมอ)

---

## KIRO-01 (P1) — แก้วันจ้างงานแล้วเวลาทำงานที่บันทึกแล้วหายจากงวดและ CSV

- **หมวด:** HR lifecycle / period finalization · **ความมั่นใจ:** สูง · **Runtime reproduced**
- **หลักฐาน:**
  - [convex/hr/setup.ts:292-302](../../../../../convex/hr/setup.ts#L292) ป้องกันเฉพาะการย้ายคลังเมื่อมีวันบันทึก (`EMPLOYEE_SITE_LOCKED`) ส่วน `employmentStartDate`/`employmentEndDate` ([setup.ts:337](../../../../../convex/hr/setup.ts#L337)) บันทึกได้โดยไม่ตรวจวันที่บันทึกไว้แล้ว
  - [convex/model/hr/period.ts:131](../../../../../convex/model/hr/period.ts#L131) `if (!isEmployedOn(...)) continue;` ข้ามทุกวันนอกช่วงจ้าง รวมถึงวันที่มี clock-in/out, certification หรือคำขอแก้ที่รออยู่
  - [convex/hr/periods.ts:476](../../../../../convex/hr/periods.ts#L476) `closeBlocker` เห็นเฉพาะแถวที่สร้างจากข้อมูลนี้ จึงไม่มีอะไรขวาง
- **Trigger:** พนักงานลงเวลา 5 ต.ค. 08:30–17:30 จากนั้น HR แก้วันเริ่มงานเป็น 6 ต.ค. (เช่น แก้ให้ตรงสัญญา) หรือใส่วันสิ้นสุดก่อนวันทำงานจริงวันสุดท้าย แล้วสร้าง/ปิดงวด 3–5 ต.ค.
- **ผลจริง (probe):** `saveWritten: true`; วันที่บันทึกยังมี `clockInAt/clockOutAt`; preview `blocker: null`, `workedMinutes: 0`; ปิดงวดสำเร็จ; CSV มี 3 แถวของพนักงานอื่น และ `csvHasEmp001: false`
- **ที่ควรเป็น:** ไม่ทิ้งเวลาที่บันทึกแล้วจาก payroll export โดยเงียบ ควรปฏิเสธการแก้ (แบบเดียวกับ site lock) หรือแสดงวันเหล่านั้นเป็น exception ที่ขวางการปิดงวด ขัดกับ HR-051 “do not silently truncate period calculations” และ HR-041 ที่กำหนดให้ปิดงวดจากข้อมูลที่เชื่อถือได้
- **ขอบเขต:** draft preview, close, frozen rows, CSV และ review queue (ใช้ `buildPeriodRows` เดียวกัน) หลังปิดแล้วข้อมูลใน version จะถูก freeze ถาวร
- **เหตุผลของระดับ P1:** ต้องมี HR แก้ข้อมูล ซึ่งเป็นงานปกติ (แก้ typo วันเริ่มงาน หรือบันทึกวันลาออก) ผลคือเวลาทำงานจริงหายจากไฟล์จ่ายเงินโดยไม่มีสัญญาณเตือน และกู้ได้เฉพาะเมื่อมีคนสังเกตแล้วเปิด revision
- **แนวทางแก้:** ใน `saveEmployee` ให้ refuse/confirm เมื่อมี `hrAttendanceDays` (มีเวลา, certification หรือ pending correction) นอกช่วงจ้างใหม่ หรือให้ `buildPeriodRows` แสดงวันที่บันทึกนอกช่วงจ้างเป็น EXCEPTION `RECORDED_OUTSIDE_EMPLOYMENT`
- **Verify:** `pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/kiro/vitest.config.mts hr-backend -t KIRO-01`
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำ

## KIRO-02 (P2) — แก้ตารางงาน/วันหยุดแล้วเปลี่ยนวันในอดีตที่ยังไม่มี record

- **หมวด:** Attendance dates/schedules · **ความมั่นใจ:** สูง · **Runtime reproduced**
- **หลักฐาน:** วันที่ไม่มี `hrAttendanceDays` ใช้ plan สดจากตารางงานและวันหยุด _ปัจจุบัน_ ทุกครั้ง: [convex/model/hr/period.ts:133-140](../../../../../convex/model/hr/period.ts#L133) (`day?.plan ?? planFor(...)`), [convex/hr/shared.ts:329](../../../../../convex/hr/shared.ts#L329) `livePlan` ไม่มี effective date ของตารางงาน ([setup.ts](../../../../../convex/hr/setup.ts) เก็บ `schedule` ค่าเดียวต่อพนักงาน)
- **Trigger:** พนักงานตาราง จ.–ศ. ไม่มาวันจันทร์ 5 ต.ค. (MISSING_RECORD) วันที่ 7 ต.ค. HR เปลี่ยนตารางเป็น อ.–ส. “ตั้งแต่นี้ไป” หรือเพิ่มวันหยุดย้อนหลังวันที่ 5
- **ผลจริง (probe):** คิวตรวจก่อนแก้: `2026-10-05:EXCEPTION:MISSING_RECORD`; หลังเปลี่ยนตาราง: วันที่ 5 หายไป และมี `2026-10-03:EXCEPTION:MISSING_RECORD` (เสาร์ที่ผ่านมาซึ่งตอนนั้นไม่ได้อยู่ในตาราง) โผล่ขึ้นมาแทน; กรณีเพิ่มวันหยุด คิวว่าง (`[]`) การลบวันหยุดในอดีตใช้ root cause เดียวกันในทิศตรงข้าม คือทุกคนจะมี MISSING_RECORD ใหม่
- **ที่ควรเป็น:** วันขาดที่ยังไม่ได้ตัดสินต้องยังเห็นได้จนกว่าจะมี disposition (HR-033 “An absence remains identifiable”; A7 “prevents close until explicitly reviewed”) และการเปลี่ยนตารางไม่ควรสร้างวันขาดย้อนหลังให้วันที่พนักงานไม่ได้ถูกกำหนดให้ทำงาน
- **ขอบเขต:** draft period, review queue, personal history และ day detail ของทุกคนที่ถูกแก้ตาราง รวมถึงทุกคนในคลังเมื่อแก้วันหยุด
- **เหตุผลของระดับ P2:** การเปลี่ยนตารางกลางงวดเป็นงานปกติ ผลคือ absence หายโดยไม่มีผู้ตัดสิน (นับ `absentDays` ต่ำกว่าจริงหลังปิด) ไม่ถึง P1 เพราะกระทบวันที่ยังไม่มี record และต้องเกิดก่อนปิดงวด ข้อความนโยบายใน UI ระบุว่า “Edits do not change already-recorded days” ซึ่งตรงกับโค้ด แต่ไม่ได้บอกว่าวันที่ยังไม่บันทึกจะเปลี่ยน
- **แนวทางแก้:** เก็บตารางงานแบบมี `effectiveFrom` (หรือ materialize plan ของวันในอดีตก่อนเปลี่ยนตาราง/วันหยุด) และให้การแก้วันหยุดในอดีตแสดงผลกระทบหรือต้องยืนยัน
- **Verify:** `... hr-backend -t KIRO-02`
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำ (การแก้ตารางและวันหยุดใช้ root cause เดียวกัน จึงรวมเป็นข้อเดียว)

## KIRO-08 (P2) — query ที่ขึ้นกับเวลาไม่ถูกรันใหม่เมื่อเวลาผ่านไป

- **หมวด:** Shared async / reactive data · **ความมั่นใจ:** กลาง-สูง · **Runtime บางส่วน + เอกสาร Convex**
- **หลักฐาน:**
  - `orgClock` ใช้ `Date.now()` ภายใน query ([convex/hr/shared.ts:66-71](../../../../../convex/hr/shared.ts#L66)) และถูกใช้ใน `self.today`, `access.current` (`today`), `periods.preview` (`closeBlocker` [periods.ts:314-316](../../../../../convex/hr/periods.ts#L314)) และ `review.queue`
  - เอกสาร Convex Best Practices “Don’t use `Date.now()` in queries” (https://docs.convex.dev/understanding/best-practices/#date-in-queries) ระบุว่า “The query is not re-run when `Date.now()` changes … it might return stale results”
  - ฝั่ง client ไม่มี timer หรือ `visibilitychange` ที่ทำให้ subscribe ใหม่: ค้นใน `src/` ด้วย `setInterval|visibilitychange|useNow` ไม่พบ (มีเพียง timeout ที่ไม่เกี่ยวข้อง)
  - [src/features/hr/TodayScreen.tsx:75-77,219](../../../../../src/features/hr/TodayScreen.tsx#L75): `nextAction: NONE` ทำให้ไม่ render ปุ่ม และ [ReviewScreen.tsx:102](../../../../../src/features/hr/ReviewScreen.tsx#L102), [HistoryScreen.tsx:114-116](../../../../../src/features/hr/HistoryScreen.tsx#L114), [PeriodsScreen.tsx:186](../../../../../src/features/hr/PeriodsScreen.tsx#L186) ใช้ `access.today` ค้างเป็นค่าเริ่มต้น
- **Trigger:** ลงเวลาออก 12 ต.ค. แล้วเปิดหน้า Today ทิ้งไว้ (เช่น แท็บหรือ PWA ที่ค้างข้ามคืน) เช้าวันที่ 13 กลับมาใช้หน้าเดิม
- **ผลจริง:** probe ใช้ฐานข้อมูลเดิมโดยไม่มีการเขียน: 23:50 ได้ `['2026-10-12','CLOCKED_OUT','NONE']`, 08:20 วันถัดไปได้ `['2026-10-13','NOT_CLOCKED_IN','CLOCK_IN']` แปลว่าคำตอบเปลี่ยนเพราะเวลาเพียงอย่างเดียว และตามเอกสาร Convex subscription จะไม่รันใหม่ หน้าจอจึงยังแสดงวันที่ 12 แบบ “เสร็จแล้ว” และไม่มีปุ่ม Clock in จนกว่าจะ reload หรือมีข้อมูลที่ query อ่านเปลี่ยน หลังพ้นกำหนดของวันที่ยังเปิด หน้าจอยังแสดง CLOCKED_IN/Clock out ขณะที่ server ตอบ `HR_OPEN_DAY_EXPIRED` ส่วน preview ของงวดค้างที่ `PERIOD_INCLUDES_FUTURE` หลังข้ามวันสุดท้ายของงวด
- **ที่ควรเป็น:** สถานะและ action ตรงกับวันทำการปัจจุบัน (HR-020 “Show the organization's current local date … one next clock action”)
- **ข้อจำกัด:** ไม่ได้รัน Convex server จริง จึงไม่ได้ยืนยันว่า websocket reconnect (เช่นหลัง device sleep) ทำให้ query รันใหม่หรือไม่ ซึ่งอาจลดอาการในบางอุปกรณ์ แต่ใช้แก้กรณีหน้าจอที่เปิดค้างโดยเชื่อมต่ออยู่ตลอดไม่ได้
- **เหตุผลของระดับ P2:** reach สูงในกลุ่มพนักงาน แต่แก้ได้ด้วย reload และ mutation คำนวณใหม่จากเวลาจริงเสมอ จึงไม่บันทึกข้อมูลผิด
- **แนวทางแก้:** ส่ง business date หรือ minute bucket จาก client เป็น argument ตามที่ Convex แนะนำ และให้ client เปลี่ยนค่าเมื่อข้ามนาที/วันหรือเมื่อแท็บกลับมา visible หรือใช้ scheduled function เปลี่ยน state ที่อ่านจาก DB
- **Verify:** `... hr-backend -t KIRO-08` (ผ่าน: แสดงว่าคำตอบเปลี่ยนตามเวลาเท่านั้น) ร่วมกับ scenario ใน dev จริง: เปิด Today ข้ามเที่ยงคืนโดยไม่ reload
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำกับ DAILY-01 (DAILY-01 พิสูจน์แล้วว่า query ที่ดึงใหม่ถูกต้อง ปัญหานี้คือ query ไม่ถูกดึงใหม่)

## KIRO-04 (P2) — HR admin ที่จำกัดคลังจัดการสิทธิ์ HR ของทั้งองค์กรได้

- **หมวด:** Tenant/warehouse isolation · **ความมั่นใจ:** สูง · **Runtime reproduced**
- **หลักฐาน:** [convex/hr/setup.ts:506-545](../../../../../convex/hr/setup.ts#L506) `accessMembers` แสดงสมาชิก active ทุกคน และ [setup.ts:547-611](../../../../../convex/hr/setup.ts#L547) `setMemberAccess` ตรวจเพียงว่าสมาชิก active (`ctx.members.get`) โดยไม่ใช้ `siteScope` ขัดกับ docstring ต้นไฟล์ ([setup.ts:1-6](../../../../../convex/hr/setup.ts#L1)) ที่ระบุว่าทุก member “re-validated against … the administrator's site scope”
- **Trigger:** HR admin ที่เป็น `WAREHOUSE_SCOPED` เฉพาะ ALPHA ถอน `HR_SUPERVISOR` ของหัวหน้าที่อยู่เฉพาะ BRAVO
- **ผลจริง (probe):** `outOfScopeMemberListed: true`, `revoke: true` และหัวหน้า BRAVO เรียก `review.queue` ไม่ได้อีก (`ok: false`)
- **ที่ควรเป็น:** admin ที่จำกัดคลังจัดการได้เฉพาะสมาชิกในขอบเขตของตน หรือการจัดการ role ระดับองค์กรต้องใช้ `ORG_WIDE`
- **ขอบเขต:** grant/revoke `HR_EMPLOYEE`/`HR_SUPERVISOR` ทั้งองค์กร และการเปิดเผยรายชื่อ/role ของสมาชิกนอกขอบเขต การ grant เพียงอย่างเดียวไม่เปิดข้อมูลคลังอื่น เพราะ `reviewBlocker` ยังต้องการ reporting line
- **เหตุผลของระดับ P2:** ต้องมี admin ที่มีสิทธิ์ HR อยู่แล้ว แต่ก้าวข้ามขอบเขตคลังและตัดงานตรวจของคลังอื่นได้
- **แนวทางแก้:** กรองสมาชิกด้วย membership scope (`membershipWarehouses` ⊆ scope ของ admin) หรือ refuse เมื่อ `scopeMode !== ORG_WIDE`
- **Verify:** `... hr-backend -t KIRO-04`
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำ

## KIRO-03 (P2) — HR admin รับรองเวลาของตัวเองได้โดยยกเลิก link ชั่วคราว

- **หมวด:** HR authorization/linking · **ความมั่นใจ:** สูง · **Runtime reproduced**
- **หลักฐาน:** [convex/hr/shared.ts:211](../../../../../convex/hr/shared.ts#L211) ใช้ link ปัจจุบันเท่านั้น (`employee.userId === scope.actorUserId`) และ [setup.ts:335](../../../../../convex/hr/setup.ts#L335) ให้ admin แก้ `userId` ของ record ตัวเองได้
- **Trigger:** HR admin ที่มี employee record ของตัวเองมีวันขาดที่ต้องตัดสิน
- **ผลจริง (probe):** `disposeDay` ตรง ๆ ได้ `SELF_REVIEW`; ยกเลิก link (`written: true`) แล้ว dispose เป็น WORKED 08:30–17:30 ได้ (`written: true`); link กลับได้ (`written: true`); `certifiedBySelf: true`
- **ที่ควรเป็น:** HR-001/HR-033 และตาราง role ระบุว่า HR admin “No self-certification of their own attendance” แม้จะเปลี่ยนการเชื่อมบัญชีชั่วคราว
- **ขอบเขต:** `disposeDay`, `decideCorrection` และทุก reviewer path ที่ใช้ `reviewBlocker` หากใช้กลไกเดียวกันกลับด้าน admin ที่ไม่มี record จะ link บัญชีตัวเองเข้ากับ record ของคนอื่นแล้วลงเวลาแทนได้ ซึ่งขัด HR-011 แต่ไม่ได้นับเป็นข้อแยก
- **เหตุผลของระดับ P2:** insider ที่มีสิทธิ์สูง และมี audit `hr.employee.save` เหลือไว้ แต่ business invariant ถูกข้ามได้ใน 3 คำสั่ง
- **แนวทางแก้:** ห้าม actor เปลี่ยน `userId` ของ record ที่ link กับตัวเอง หรือห้ามเชื่อมบัญชีตัวเอง ให้ admin คนอื่นทำ หรือให้ `reviewBlocker` ตรวจประวัติ link/actor ของ event ในวันนั้น
- **Verify:** `... hr-backend -t KIRO-03`
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำ

## KIRO-05 (P2) — เพดาน 99 คนนับประวัติพนักงานทั้งหมดของคลัง ไม่ใช่คนที่จ้างในงวด

- **หมวด:** Period finalization / bounds · **ความมั่นใจ:** สูง · **Runtime reproduced**
- **หลักฐาน:** [convex/hr/shared.ts:428-429](../../../../../convex/hr/shared.ts#L428) `take(MAX_SITE_EMPLOYEES + 1)` แล้ว `return null` _ก่อน_ กรองช่วงจ้าง; [review.ts:77-78](../../../../../convex/hr/review.ts#L77) ทำแบบเดียวกันใน queue ของ admin; ไม่มีการลบพนักงาน (HR-010 “Do not hard-delete employees with history”)
- **Trigger:** คลังที่มี record พนักงานเก่า (ลาออก/inactive) 100 รายการ และพนักงานปัจจุบัน 2 คน
- **ผลจริง (probe):** `periods.create` ได้ `PERIOD_TOO_LARGE / EMPLOYEES` และ `review.queue` ของ HR admin ได้ `LIMIT_EXCEEDED`
- **ที่ควรเป็น:** pilot bound คือ “at most 50 employees per site period” (spec บรรทัด 20) และข้อความ UI “Up to 50 employees … per period” เมื่อคนในงวดมี 2 คนจึงควรสร้างงวดได้
- **เหตุผลของระดับ P2:** เมื่อถึงเกณฑ์จะ block ถาวร เพราะลบ record ไม่ได้ คลังที่ turnover สูงจะปิดงวดหรือ export ไม่ได้อีก และ HR ไม่มีทางแก้ใน UI
- **แนวทางแก้:** อ่านเฉพาะพนักงานที่ช่วงจ้างทับงวด (index ตาม `warehouseId` + `employmentEndDate`/status หรือ paginate) แล้วจึงตรวจเพดาน 50
- **Verify:** `... hr-backend -t KIRO-05`
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำ

## KIRO-10 (P2) — editor ที่ key ตาม version ล้าง draft ที่ยังไม่บันทึกโดยไม่ถาม

- **หมวด:** Draft/pending protection · **ความมั่นใจ:** สูง · **Runtime reproduced (UI)**
- **หลักฐาน:** [src/features/hr/EmployeesScreen.tsx:377](../../../../../src/features/hr/EmployeesScreen.tsx#L377) `key={\`${employee.id}:${employee.version}\`}`ทำให้`EmployeeForm`remount เมื่อ live query ได้ version ใหม่ การ unmount ยกเลิก`useDraftGuard`([draftGuard.ts](../../../../../src/components/providers/draftGuard.ts) cleanup`register(id, null)`) จึงไม่มี prompt pattern เดียวกันอยู่ที่ [DayScreen.tsx:84](../../../../../src/features/hr/DayScreen.tsx#L84) (`detail.revision`) และ [ReviewDetail.tsx:116,123,130](../../../../../src/features/hr/ReviewDetail.tsx#L116) (source-demonstrated)
- **Trigger:** admin A เปิดแก้พนักงานและพิมพ์ชื่อใหม่ ระหว่างนั้น admin B (หรือแท็บอื่น) บันทึกพนักงานคนเดิม
- **ผลจริง (probe):** หลัง query เปลี่ยนจาก v4 เป็น v5 ได้ `typedStillThere: false`, ช่องชื่อกลับเป็น `Somsak` และ `promptShown: false`
- **ที่ควรเป็น:** Back navigation contract กำหนดว่า “require consent before discarding that surface's own unfinished form” และ A14 ระบุ “draft retained” ควรเก็บ draft แล้วแจ้งว่า stale (server มี `EMPLOYEE_STALE` อยู่แล้ว)
- **เหตุผลของระดับ P2:** เกิดเมื่อมีผู้แก้พร้อมกัน ข้อมูลที่หายเป็น draft ที่ยังไม่ส่ง ไม่ใช่ข้อมูลที่บันทึกแล้ว
- **แนวทางแก้:** key ตาม `employee.id` อย่างเดียว เมื่อ version เปลี่ยนขณะ dirty ให้คง draft และแสดง banner “มีการแก้จากที่อื่น” ส่วน editor ที่สะอาดให้รับค่าใหม่ ใช้ policy เดียวกันกับ DAILY-03
- **Verify:** `pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/kiro/vitest.config.mts hr-ui -t KIRO-10`
- **ซ้ำกับ root cause อื่น:** เกี่ยวข้องแต่ไม่ซ้ำกับ DAILY-03 DAILY-03 คือ editor สะอาดไม่รับ version ใหม่ (`useState` ค่าเริ่ม) ข้อนี้คือ editor ที่มี draft ถูก remount ทิ้ง ซึ่งเป็นกลไกตรงข้ามคนละ component

## KIRO-07 (P3) — ฟอร์มแก้เวลาตัดวินาที ด้านที่ไม่ได้แตะจึงกลายเป็น “เปลี่ยน”

- **หมวด:** Attendance corrections · **ความมั่นใจ:** สูง · **Runtime reproduced**
- **หลักฐาน:** [src/features/hr/TimeSideField.tsx:36](../../../../../src/features/hr/TimeSideField.tsx#L36) prefill เป็น `HH:MM`; [CorrectionForm.tsx](../../../../../src/features/hr/CorrectionForm.tsx) ส่งทั้งสองด้านเสมอเมื่อมีค่า; [ReviewDetail.tsx:307-308](../../../../../src/features/hr/ReviewDetail.tsx#L307) เทียบ instant แบบ ms; [DispositionForm](../../../../../src/features/hr/ReviewDetail.tsx#L493) prefill แบบเดียวกัน
- **Trigger:** clock-in 08:30:45 และ clock-out 17:30:10 พนักงานขอแก้เฉพาะเวลาออกเป็น 18:00
- **ผลจริง (probe):** `proposedStartAt` เร็วกว่า `originalStartAt` 45 วินาที (`deltaSeconds: 45`) ผู้ตรวจจึงเห็นช่อง Clock in เป็น “changed” แม้พนักงานไม่ได้แก้ และช่วงที่รับรองยาวขึ้นได้ถึง 59 วินาที (worked minutes อาจเพิ่ม 1 นาที)
- **ที่ควรเป็น:** ด้านที่ไม่ได้แก้ต้องคงเวลาเดิม และไม่ถูกแสดงว่าเปลี่ยน (HR-030 “Do not modify original clock events”, ข้อมูลที่ผู้ตรวจเห็นต้องตรงกับคำขอ)
- **เหตุผลของระดับ P3:** ผลต่อเวลาไม่เกิน 1 นาทีต่อวัน แต่เกิดเกือบทุกคำขอ และให้ข้อมูลผิดแก่ผู้ตรวจ
- **แนวทางแก้:** ส่ง `undefined` สำหรับด้านที่ไม่ได้แก้ (track dirty ต่อด้าน) หรือส่ง instant เดิมเมื่อค่าไม่เปลี่ยน และให้ UI เทียบระดับนาที
- **Verify:** `... hr-backend -t KIRO-07`
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำ

## KIRO-06 (P3) — รับรองคำขอแก้ระหว่างกะที่ยังเปิด ทำให้ลงเวลาออกไม่ได้

- **หมวด:** Attendance state machine · **ความมั่นใจ:** กลาง-สูง · **Runtime reproduced**
- **หลักฐาน:** [DayScreen.tsx:70-74](../../../../../src/features/hr/DayScreen.tsx#L70) อนุญาตฟอร์มเมื่อ `status !== "UPCOMING"` ซึ่งรวม IN_PROGRESS; [convex/hr/review.ts:388](../../../../../convex/hr/review.ts#L388) certify ตั้ง `open: false`; [self.ts](../../../../../convex/hr/self.ts) `selfState` เห็นวันที่มี `clockInAt` และไม่ open จึงเป็น `CLOCKED_OUT`
- **Trigger:** clock-in 09:00 แล้วขอแก้ตอน 10:05 ว่าเข้างาน 08:00 ฟอร์มบังคับให้ใส่เวลาออกที่ไม่อยู่ในอนาคต จึงใส่ 10:00 หัวหน้ารับรองตอน 10:10 และพนักงานลงเวลาออกตอน 17:30
- **ผลจริง (probe):** `statusWhenSubmitted: IN_PROGRESS`; clock-out ได้ `HR_NOT_CLOCKED_IN`; Today เป็น `CLOCKED_OUT / NONE` เวลาออกจริงไม่ถูกบันทึก และวันนั้นถูกปิดที่ 10:00
- **ที่ควรเป็น:** ไม่รับคำขอหรือการรับรองที่ปิดกะที่ยังเปิด หรือคงกะไว้จนลงเวลาออก (HR-021 ห้ามสร้างเหตุการณ์ที่ไม่มีจริง และวันที่ยังเปิดต้องจบด้วยเวลาออกหรือการตัดสิน)
- **เหตุผลของระดับ P3:** ต้องมีลำดับเหตุการณ์เฉพาะ และกู้ได้ด้วยคำขอแก้ครั้งใหม่
- **แนวทางแก้:** refuse `submitCorrection`/certify เมื่อวันยัง IN_PROGRESS หรือให้ certify คง `open` ไว้ถ้าไม่มี clock-out เดิม
- **Verify:** `... hr-backend -t KIRO-06`
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำ

## KIRO-09 (P3) — ช่วงวันที่ไม่ระบุปีที่ยังไม่จบ ถูกตีความเป็นปีที่แล้ว

- **หมวด:** AI Search grounding · **ความมั่นใจ:** สูง · **Runtime reproduced**
- **หลักฐาน:** [convex/model/search/dates.ts:150-153](../../../../../convex/model/search/dates.ts#L150) เลือก “latest past occurrence” ของวันสิ้นสุด และ [dates.ts:243](../../../../../convex/model/search/dates.ts#L243) ใช้ปีของวันสิ้นสุดเป็นปีของช่วง; [resolveIntent.ts](../../../../../src/lib/search/resolveIntent.ts) `resolvePeriod` ค้นด้วยช่วงนั้นตรง ๆ
- **Trigger:** วันที่ 13 ต.ค. 2026 พิมพ์ “ส่งออกงวด 1-15 ต.ค.” เมื่อมี draft งวด 1–15 ต.ค. 2026
- **ผลจริง (probe):** อ่านได้ `2025-10-01..2025-10-15 (inferredYear)`, ค้น `periodsByRange('2025-10-01','2025-10-15')` และผลเป็น `NO_MATCH` หากมีงวดของปีที่แล้ว ระบบจะเสนองวดปี 2025 ให้ยืนยัน
- **ที่ควรเป็น:** ช่วงที่ครอบวันนี้หรือเริ่มก่อนวันนี้ควรเป็นปีปัจจุบัน ข้อจำกัด “ห้ามอนาคต” เหมาะกับการขอแก้เวลาวันเดียว ไม่เหมาะกับงวด
- **เหตุผลของระดับ P3:** inferred year ไม่ถูกเปิดอัตโนมัติ (ต้องยืนยัน) จึงไม่เกิดการกระทำผิดเอง แต่คำค้นทั่วไปของ HR ได้ผลผิด
- **แนวทางแก้:** สำหรับ RANGE ให้เลือกปีที่ `from ≤ today` ล่าสุด (หรือทั้งสองปีเป็นตัวเลือก) และเก็บกฎ end ≤ today ไว้กับ self-correction
- **Verify:** `pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/kiro/vitest.config.mts ai-dates`
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำ

## KIRO-11 (P3) — รายการวันที่ยังเปิดของงวดตัดที่ 200 แถวโดยไม่แจ้ง

- **หมวด:** Period UI / bounds · **ความมั่นใจ:** สูง · **Runtime reproduced (UI)**
- **หลักฐาน:** [src/features/hr/PeriodDetailScreen.tsx:889-895](../../../../../src/features/hr/PeriodDetailScreen.tsx#L889) `open.slice(0, 200)` และไม่มีข้อความ “มีอีก N รายการ” (ไม่มี key ข้อความนี้ใน `messages/en.json` `Hr.period`) แถวเรียงตามรหัสพนักงานแล้วตามวันที่ ทำให้ UPCOMING ของคนแรก ๆ ดัน exception ของคนท้าย ๆ ออกไป
- **Trigger:** งวด 1–31 ต.ค. ดูวันที่ 13 ต.ค. มี 12 คนที่ยังเหลือวัน UPCOMING คนละ 18 วัน (216 แถว) และพนักงานคนที่ 13 มี MISSING_RECORD
- **ผลจริง (probe):** มี 217 แถวที่ยังเปิด แต่แสดง 200 และ `exceptionListed: false`
- **ที่ควรเป็น:** spec HR-020/HR-051 กำหนด bounded list แบบบอกว่าไม่ครบ (“explicit incomplete/limit errors”) และ comment ใน component เองระบุว่า “Days still open are the work list”
- **เหตุผลของระดับ P3:** totals ยังแสดงจำนวนที่ถูก และปุ่ม Review ไปยัง exception แรกได้ แต่รายการงานไม่ครบโดยไม่บอก
- **แนวทางแก้:** แสดง EXCEPTION ก่อน UPCOMING และเพิ่ม notice/“แสดงเพิ่ม” เมื่อเกิน bound
- **Verify:** `... hr-ui -t KIRO-11`
- **ซ้ำกับ root cause อื่น:** ไม่ซ้ำ

---

## สมมติฐานที่ตรวจแล้วตัดทิ้ง

| สมมติฐาน                                                                           | เหตุที่ตัด (หลักฐาน)                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI route ถูก CSRF / ใช้ token ข้าม tenant                                          | [authenticate.ts](../../../../../src/lib/ai/authenticate.ts) ตรวจ Origin, `authorizedParties`, `iss/sub/org` ตรงกับ session; JSON body ต้องผ่าน preflight; `proxy.ts` ส่ง `/api/*` ผ่าน `clerkMiddleware`                                                   |
| Elysia response schema ไม่ครอบคลุม code จาก action                                 | `searchResponse` มี AI_UNAVAILABLE/TIMEOUT/UNREADABLE/QUERY_INVALID/RATE_LIMITED และทุก field ของ `GroundedIntent` รวม `NO_CLOCK`                                                                                                                           |
| CSV formula injection                                                              | [csv.ts](../../../../../convex/model/hr/csv.ts) `formulaSafe` ครอบคลุม `= + - @ \t \r \n` และ fullwidth; holiday CSV ใน `selfService.ts` ก็ neutralize                                                                                                      |
| อ่านข้าม tenant ด้วย ID ปลอม                                                       | `tenantDb.readOwned` ตรวจ `orgId` ทุก get/patch/delete ([tenantDb.ts:327-398](../../../../../convex/lib/tenantDb.ts#L327))                                                                                                                                  |
| `useRequestIdentity` (storage/FG) มีปัญหาแบบ DAILY-01                              | key ของ request คือ `JSON.stringify(payload)` เช่นใน [StorageLayoutScreens.tsx:407](../../../../../src/features/storageLayouts/StorageLayoutScreens.tsx#L407) payload ใหม่จึงได้ ID ใหม่ และไม่ replay ผิดคำสั่ง                                            |
| ปิดงวดเชื่อ preview / export draft ได้                                             | `close` คำนวณใหม่และเทียบ fingerprint; `exportCsv` อ่านเฉพาะ `hrPeriodVersions` ที่ปิดแล้ว                                                                                                                                                                  |
| รหัสพนักงานซ้ำจาก race                                                             | Convex mutation เป็น serializable และ OCC จะ retry ทำให้เห็น `sameCode`                                                                                                                                                                                     |
| ปิดคลังแล้วพนักงานยังลงเวลาได้แต่ HR แก้ไม่ได้                                     | ไม่มี mutation ใน app ที่เปลี่ยน warehouse เป็น INACTIVE (ค้น `convex/` แล้วพบแค่ seed/import) จึงยังเป็นเพียง hypothesis                                                                                                                                   |
| Quota AI ถูกใช้แม้ query ไม่ผ่าน `validQuery`                                      | เกิดจริงตามลำดับ preflight แต่ผลกระทบเล็กมาก (query ยาว 1 ตัวอักษร) จึงไม่นับเป็นบั๊กที่มีผลต่อผู้ใช้                                                                                                                                                       |
| error code ไม่มีคำแปล (`PREFERENCES_STALE`, `PAGE_SIZE_INVALID`, `YEAR_INVALID` …) | สคริปต์เทียบ `fail()` กับ `Hr.errors` พบว่าขาดจริง แต่ `PREFERENCES_STALE` มี UI เฉพาะ ([ShortcutCustomizeScreen.tsx:442](../../../../../src/features/hr/ShortcutCustomizeScreen.tsx#L442)) ส่วน code ที่เหลือมาจาก input ที่ UI ไม่ส่ง จึงไม่มีผลต่อผู้ใช้ |
| DAILY-01/02/03                                                                     | baseline ยังมีอยู่ใน source ปัจจุบัน (`useHrWrite.ts` เก็บ ID ใน session storage แต่คำสั่งใน ref; Link กลับ Today; `useState` ค่าเริ่ม) จึงไม่นับซ้ำ                                                                                                        |

## คำสั่งที่รันและผล

| คำสั่ง                                                                                            | ผล                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run --config <kiro>/vitest.config.mts scratch-dates` (ไฟล์สำรวจชั่วคราว ลบแล้ว) | 1 passed; พิมพ์ผลอ่านวันที่ เช่น `16-31 ต.ค.` → 2025                                                                                                                                    |
| `pnpm exec vitest run --config <kiro>/vitest.config.mts hr-backend --reporter=verbose`            | **8 failed / 1 passed**, exit 1 (KIRO-01..07 ล้มตามคาด; KIRO-08 ผ่าน เพราะเป็น probe แบบ documenting) → `evidence/hr-backend.log`                                                       |
| `pnpm exec vitest run --config <kiro>/vitest.config.mts ai-dates --reporter=verbose`              | **1 failed**, exit 1 → `evidence/ai-dates.log`                                                                                                                                          |
| `pnpm exec vitest run --config <kiro>/vitest.config.mts hr-ui --reporter=verbose`                 | รอบแรกล้มเพราะ probe ตั้งค่าผิด (ไม่มี intl wrapper ตอน rerender / ชื่อ heading) และรอบสอง fixture มี key ซ้ำ หลังแก้แล้วได้ **2 failed** พร้อมหลักฐานที่ถูกต้อง → `evidence/hr-ui.log` |
| `pnpm exec tsc -p <kiro>/tsconfig.probes.json` (+ `--listFilesOnly` ยืนยันว่าตรวจ 4 ไฟล์ใน kiro)  | exit 0 → `evidence/probes-tsc.log`                                                                                                                                                      |
| `pnpm exec eslint <kiro>/*.probe.ts <kiro>/*.probe.tsx <kiro>/vitest.config.mts`                  | exit 0 → `evidence/probes-eslint.log`                                                                                                                                                   |
| `curl -H 'Accept: text/markdown' https://docs.convex.dev/understanding/best-practices.md`         | ได้หัวข้อ “Don’t use `Date.now()` in queries” ที่อ้างใน KIRO-08                                                                                                                         |
| `node -e` เทียบ `fail("…")` ใน `convex/hr/*.ts` กับ `messages/{en,th}.json` `Hr.errors`           | ขาด 7 code (ดูตาราง rejected)                                                                                                                                                           |

`<kiro>` = `docs/reviews/daily-bug-search-2026-10-13/expanded/kiro` probes ใช้ config แยก จึงไม่เพิ่มเข้าชุดทดสอบปกติ ไม่ได้รันทั้ง suite หรือ build ไม่ได้เปิด server/browser ไม่ได้อ่าน `.env` และไม่ได้แตะข้อมูล local/production ข้อมูลทั้งหมดเป็น in-memory `convex-test` fixture

## ไฟล์ในโฟลเดอร์นี้

- `research.md` — รายงานนี้
- `findings.json` — ข้อมูล findings แบบมีโครงสร้าง
- `hr-backend.probe.ts`, `ai-dates.probe.ts`, `hr-ui.probe.tsx` — probes
- `vitest.config.mts`, `tsconfig.probes.json` — config แยกสำหรับ probes
- `evidence/*.log` — ผลการรันดิบ
