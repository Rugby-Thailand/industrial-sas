# ส่งมอบ HR และคู่มือภาษาไทย — ผลตรวจขั้นสุดท้าย

วันที่ 10 ตุลาคม 2026 (Asia/Bangkok)

**ผ่านการตรวจตามขอบเขตงาน**: ลดขั้นตอนและข้อความกฎบนหน้า HR, ตรวจการใช้งานทุกเส้นทาง HR บน desktop และ mobile, ตรวจ Search/AI ไปยังหน้าย่อย และจัดทำคู่มือภาษาไทย 20 หน้าพร้อมตรวจแต่ละหน้าโดยผู้ตรวจอิสระ หลังแก้ข้อบกพร่องที่พบ ชุดตรวจรวมและ production build ผ่านบน source ชุดสุดท้าย

เปิดใช้งานแอปได้ที่ [HR](http://localhost:3100/th/hr/review) และอ่าน [คู่มือเว็บ](http://localhost:3181/) ได้ทันทีบนเครื่องนี้ [ดาวน์โหลดคู่มือ PDF](../../output/pdf/hr-user-guide-th.pdf)

## การแบ่งงานและหลักฐาน

| ขั้นตอน                                                            | ผู้รับผิดชอบ                                               | ผลและหลักฐาน                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| วางขอบเขต ลดขั้นตอน และกำหนดข้อยอมรับ                              | Coordinator / Codex                                        | [แผนงาน](../plans/hr-ui-simplification-claude-codex-2026-10-10.md) และ [route/state matrix](../../output/hr-simplification-qa/coverage-plan.md)                                                                        |
| Implement และแก้ข้อบกพร่อง                                         | Sub-agent `claude_hr_implementation` เรียก Claude CLI จริง | [รายงาน implementation](hr-ui-simplification-claude-implementation-2026-10-10.md); 9 CLI stages; focused checks 47 files / 368 tests ผ่าน                                                                              |
| ตรวจ source และการใช้งานจริง                                       | Sub-agent `hr_feature_qa` / Codex                          | [รายงานตรวจฟีเจอร์](hr-ui-simplification-codex-audit-2026-10-10.md), [ผลราย route](../../output/hr-simplification-qa/final-route-matrix.json), [live workflows](../../output/hr-simplification-qa/live-workflows.json) |
| สร้างคู่มือและตรวจทุกหน้าหลังสร้าง                                 | Sub-agent `hr_usage_manual`                                | [รายงานผู้จัดทำ](hr-user-guide-th-verification-2026-10-10.md) — 20 หน้า ผ่าน                                                                                                                                           |
| ตรวจคู่มือแยกจากผู้จัดทำ                                           | Sub-agent `hr_manual_audit`                                | [ผลรายหน้า 1–20](hr-user-guide-th-independent-audit-2026-10-10.md) และ [page review JSON](../../output/hr-manual-independent-audit/page-review.json) — ทุกหน้า ผ่าน                                                    |
| Final audit, whole checks, build, preservation และ HTML รอบสุดท้าย | Coordinator / Codex                                        | หลักฐานในรายงานนี้; source และคู่มือยังตรงกับชุดที่ผ่านการตรวจ                                                                                                                                                         |

รายงาน implementation และเอกสารเตรียม QA เก็บสถานะ ณ เวลาที่เขียนไว้ รายงานฉบับนี้บันทึกผล combined checks หลัง source freeze ครั้งสุดท้ายและปิดสถานะที่เคยรอผล

## สิ่งที่ใช้ง่ายขึ้น

- **ตรวจคำขอ:** เวลาเดิมเทียบเวลาที่ขอแก้อยู่ในตารางเดียว ตามด้วยเหตุผลและปุ่มตัดสินใจ ช่องหมายเหตุเปิดเมื่อจำเป็น ประวัติและรายละเอียดเปิดอ่านเพิ่มได้ โดยไม่ทำข้อมูลที่กรอกไว้หาย
- **วันนี้:** เวลาเข้าออกและปุ่มลงเวลาอยู่ก่อนรายละเอียดกะ ผลบันทึกอยู่ใกล้ปุ่ม ไม่ต้องอ่านกฎหลายชุดก่อนทำงาน
- **งวดเวลา:** แสดงสถานะของฉบับที่กำลังดูและงานถัดไปชัดเจน งวดที่ยังติดรายการให้ไปตรวจรายการนั้น งวดพร้อมให้ปิด ส่วนฉบับปิดแล้วให้ดาวน์โหลด CSV ตามหมายเลขฉบับ
- **ตั้งค่า:** วันหยุดและสิทธิ์อยู่ในงานหลัก นโยบาย/รูปแบบ CSV เปิดอ่านเพิ่มได้ Search ที่ชี้มาส่วนนี้เปิดรายละเอียดและพาไปยังเป้าหมาย
- **Search/AI:** ค้นหน้าและส่วนย่อยได้ AI เลือกพนักงานและพาไปส่วนตารางงานจริง การเปิดปลายทางรักษาโฟกัส และ Escape/ปิดกล่องคืนโฟกัสให้ปุ่มค้นหาตามปกติ

## ข้อบกพร่องที่พบและตรวจซ้ำ

| ข้อบกพร่อง                                                     | การแก้และผลตรวจ                                                                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: ออกจาก Today ระหว่างคำสั่งลงเวลายังไม่ตอบได้               | เพิ่ม pending guard ที่มีอยู่ในระบบ; independent consequence test ล้มเหลวก่อนแก้และผ่านหลังแก้ พร้อมตรวจคู่เวลาเข้าออกใหม่จริง                                                          |
| P1: ร่างงวดใหม่และคำสั่งสร้างงวดถูกทิ้งระหว่างนำทาง            | เพิ่ม dirty/pending guard และ deliberate discard reset; independent 2 tests ผ่าน                                                                                                        |
| P1: ร่างวันหยุดลำดับสองหลังบันทึกครั้งแรกไม่มี guard           | reset เฉพาะ write ที่บันทึกเสร็จเมื่อแก้ช่องใหม่; independent guard ผ่าน และทดสอบร่างครั้งสองจริง โดยยังรักษา retry ของ uncertain response                                              |
| P1: Direct/AI schedule target ได้ focus แต่ยังอยู่นอก viewport | เปลี่ยน explicit deep-link scroll เป็น immediate; direct load, reload และ actual AI choice เข้าถึง employee/schedule ที่ถูกต้องและเห็นเป้าหมายใน viewport                               |
| P2: Search ปิดกล่องแล้วแย่ง focus กลับจาก section ปลายทาง      | suppress close autofocus เฉพาะ destination ที่ยอมรับ; 3 real Dialog tests ผ่าน และ 2 destination cases ล้มเหลวเมื่อถอด fix; native Normal Search/AI/Escape/close button ผ่านหลัง freeze |
| ขนาดปุ่มลงเวลา desktop ต่ำกว่าที่กำหนด                         | ปรับเฉพาะปุ่มเป็น 56px บน desktop และคง 48px บน mobile; ไม่เปลี่ยน shared Button                                                                                                        |

ข้อสงสัย URL employee หลัง Save ไม่เกิดซ้ำใน final controlled Save/Edit/Cancel และการสร้างพนักงานทดสอบใหม่ จึงไม่เพิ่ม routing fix จากข้อสงสัยที่ยืนยันไม่ได้

## ตรวจทุกเส้นทาง HR

ตรวจทั้ง 1280×800 และ 390×844 ใน native T3 preview รวม editor/dialog/สถานะย่อยของแต่ละ route ปุ่มหลักบน mobile สูงอย่างน้อย 48px ไม่มี page-wide horizontal overflow; ตารางที่ต้องเลื่อนแนวนอนอยู่ภายในบริเวณตารางที่มีชื่อกำกับ

| Route                | สิ่งที่ตรวจจริง                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/th/hr/today`       | เวลาและสถานะ ปุ่ม/ผลบันทึก คู่เวลาใหม่หลัง reload; mobile; representative English/dark                                                                        |
| `/th/hr/time`        | ช่วงวันที่ รายการ/ลิงก์รายวัน mobile และช่วงวันที่ไม่มีข้อมูล                                                                                                 |
| `/th/hr/time/:date`  | เวลาเดิม/เวลาใช้จริง ประวัติ correction form และ required validation                                                                                          |
| `/th/hr/profile`     | ข้อมูลพนักงาน สถานที่ หัวหน้าและกะบน desktop/mobile                                                                                                           |
| `/th/hr/review`      | Pending comparison/employee reason, Return validation/cancel, exception disposition, locked notice, disclosures, queue/record ที่ pane 1061px และ mobile Back |
| `/th/hr/employees`   | List/new/edit, required validation, Save/reopen/Cancel URLs, schedule direct/AI target, dirty draft navigation guard                                          |
| `/th/hr/periods`     | List/create/date validation; actual bounded period creation                                                                                                   |
| `/th/hr/periods/:id` | Draft/close confirmation/closed/historical version/invalid version/revision; actual CSV downloads                                                             |
| `/th/hr/settings`    | Holidays/access/policy, disclosure/focus; actual add/delete ของ holiday fixture และ reload                                                                    |

Search เพิ่ม keyboard open/Enter/Escape/close, normal section destination, actual AI employee selection, mobile dialog, unsaved editor → Search → Keep editing ที่รักษาข้อความเดิม และตรวจ runtime errors ของ flow ไม่มี error ที่พบในผลตรวจสุดท้าย รายละเอียด viewport/DOM/ภาพและข้อจำกัดอยู่ในรายงาน QA

## ขอบเขตการเขียนข้อมูลที่พิสูจน์จริง

QA ใช้ UI จริงบันทึกคู่เวลาใหม่ของ Local Tester วันที่ 10 ต.ค., สร้างพนักงานทดสอบที่ inactive/unlinked และมีช่วงจ้างงานจำกัด, บันทึกกะ, รับรองวันทดสอบเป็น WORKED 480 นาที, สร้าง/ปิดงวด v1, เปิด revision v2 พร้อมเหตุผลแล้วปิด และดาวน์โหลดฉบับเก่าอีกครั้ง

CSV v1 ขนาด **545 bytes** มี UTF-8 BOM/CRLF และยังเหมือนเดิมทุก byte หลังปิด v2: SHA-256 `1cc1da04bce5f4925b45436794eefc87819b8aa14c69a25adef51e6a2bc058cc` ([หลักฐาน CSV](../../output/hr-simplification-qa/exports/verification.json))

เพิ่มและลบเฉพาะ holiday fixture วันที่ 3 ก.พ. แล้ว reload ยืนยันว่าหายไป และวันหยุดเดิม 2 ต.ค./23 ก.ย. ยังอยู่ ไม่สลับสิทธิ์บัญชีจริง และไม่รับรอง/ส่งกลับ/ส่ง correction ของข้อมูล pending เดิมใน live DB กรณีเขียนเหล่านั้นใช้การอ่าน/validation ของ UI จริงร่วมกับ isolated component/integration tests ซึ่งตรวจ reason, permission, stale version, idempotency, overnight date และ history immutability ไม่อ้างว่าได้กดทุก mutation ใน browser

## คู่มือที่ตรวจแล้ว

คู่มือมี 20 งาน ตั้งแต่ลงเวลา ขอแก้เวลา ตรวจคำขอ จัดการพนักงาน/กะ สร้างและแก้งวด ดาวน์โหลด วันหยุด/สิทธิ์ ไปจนถึง Search และ AI แต่ละหน้าใช้ภาพเต็ม viewport **1280×800** หนึ่งภาพ มีกรอบและเลขชี้ปุ่ม 1–3 ขั้นตอนภาษาไทยสั้น ๆ พร้อมผลที่ควรเห็น ไม่มีคำสั่งซ้ำทั้งประโยคจากทั้งหมด 48 ขั้นตอน

ผู้จัดทำและผู้ตรวจอิสระเปิดภาพเรนเดอร์ PDF ทุกหน้าทีละหน้า ตรวจข้อความไทย รูป ปุ่ม หมายเลข แถวคำสั่งและ footer ผู้ตรวจอิสระยืนยันภาพต้นฉบับตรงกับ native capture, ภาพใน PDF ตรงกับ annotated PNG, พิกเซลนอกกรอบ/หมายเลขไม่ถูกแก้ และไฟล์ HTML/ลิงก์ทั้งหมดครบ Root ตรวจ HTML ชุดสุดท้ายซ้ำบน desktop/mobile: 20 ภาพโหลดครบ 20 anchors ถูกต้อง ฟอนต์โหลด ไม่มี overflow ([หลักฐาน HTML](../../output/hr-simplification-qa/root/manual-final-html-review.json))

ภาพไม่มีการครอปหรือซูม การเลื่อนมาที่ฟอร์มเป็นการเลื่อนหน้าเว็บก่อนถ่ายตามปกติ ภาพต้นฉบับดาวน์โหลดได้จากทุกหน้า คำสั่งระบุทางเข้าและสภาพหน้าที่จำเป็น เช่น ต้องเลือก pending record หรือเปิด employee editor ก่อน

PDF ที่ส่งมอบ SHA-256: `19d92ccffad1c41fe2425cb4f85c846281810233f517e984ffc14fb87a459669` PDF/HTML/pages/captures ทั้งสี่ยังคง hash เดิมหลังตรวจขั้นสุดท้าย ([freeze proof](../../output/hr-simplification-qa/root/manual-final-freeze.json)) การแก้ callback focus ของ Search ไม่เปลี่ยน labels/layout จึงไม่ต้อง rebuild คู่มือที่ผ่านการตรวจแล้ว

## Final checks และ source preservation

- **`pnpm check` ผ่าน exit 0**: TypeScript, ESLint `--max-warnings=0`, **165 test files / 1,504 tests** ([log](../../output/hr-simplification-qa/root/check-final-focus.log), [exit](../../output/hr-simplification-qa/root/check-final-focus-exit.txt))
- **`NEXT_DIST_DIR=.next-build pnpm build` ผ่าน exit 0**: compile, TypeScript และ static generation ครบ 45 routes ([log](../../output/hr-simplification-qa/root/build-final-focus.log), [exit](../../output/hr-simplification-qa/root/build-final-focus-exit.txt)) Dev ใช้ `.next-preview` แยกกันและยังทำงาน
- ตรวจ **21 task-owned files** ตรงกับ final implementation hashes หลัง check/build ([final source freeze proof](../../output/hr-simplification-qa/root/source-freeze-verification-final.json)) และเปรียบเทียบ protected source/config กับ snapshot ก่อนรอบนี้ **209/209 ไม่เปลี่ยน** ([independent preservation proof](../../output/hr-simplification-qa/root/protected-final-focus-verification.json))
- การเปลี่ยน `deepLink.ts` เป็น exception ที่อนุญาตจาก reproduction จริง เปลี่ยนเฉพาะ explicit target scroll; backend authorization, resolver/AI provider, guard infrastructure, router/history logic และ historical calculations ไม่ถูกแก้ในรอบนี้ รายละเอียดการเปลี่ยนทั้งหมดอยู่ใน [exact patch](../../output/hr-simplification-implementation/hr-pass.patch) และ [manifest](../../output/hr-simplification-implementation/task-owned-changes.json)
- ไม่ commit/push/deploy และ **ยังไม่เปิด PR** ตามคำสั่ง Dev3100, local backend3320 และคู่มือ3181 ถูกเปิดไว้ให้ตรวจต่อ

ผลนี้ครอบคลุม source ชุดสุดท้ายและ local workflows ที่ระบุ ไม่ใช่ผลตรวจ deployment ภายนอกหรือการยืนยันว่าได้เขียนทุก mutation กับข้อมูลเดิมจริง
