# ตรวจคู่มือ HR ภาษาไทย — 20 หน้า

วันที่: 2026-10-10

สถานะ: ผ่านการตรวจโดยผู้จัดทำและผู้ตรวจอิสระครบ 20 หน้า ผู้ตรวจอิสระเรนเดอร์และเปิด PDF ทีละหน้าจากไฟล์ที่ freeze แล้ว ไม่พบข้อบกพร่องที่ต้องแก้ ดู [รายงานตรวจอิสระ](hr-user-guide-th-independent-audit-2026-10-10.md)

## สิ่งที่ตรวจจริง

ภาพทั้ง 20 ภาพมาจากแอปจริงหลัง UI ปรับปรุง ผ่าน native T3 preview ขนาด 1280 × 800 เท่านั้น เปิด sidebar เพื่อให้เห็นชื่อเมนู HR และเลื่อนหน้าเว็บตามปกติเมื่อจำเป็น เก็บต้นฉบับแบบ byte-identical ใน `assets/source` และกรอบหมายเลขใน `assets/annotated` ไม่มีการครอป ซูม หรือสร้างภาพหน้าจอด้วย AI

แต่ละรายการใน `pages.json` เก็บ route/state จริง เวลาเก็บภาพ SHA-256 ต้นฉบับ ขนาดภาพ คำสั่ง DOM ชื่อปุ่มและกรอบ ตลอดจนผลตรวจขั้นตอนและ hash ของ source code ที่เกี่ยวข้อง `captures.json` เก็บ DOM เต็ม ณ ขณะถ่ายเพื่อเทียบปุ่มกับภาพได้

PDF ใช้ Noto Sans Thai พร้อม shaping และ ActualText เพื่อให้สระ/วรรณยุกต์แสดงถูกและค้นข้อความได้ ขนาดหน้า 1200 × 1040 จุด แต่ภาพคงอัตราส่วนเดิม 1280:800 ผู้จัดทำเรนเดอร์และเปิดดูภาพทุกหน้าแยกกัน ตรวจหัวเรื่อง ขั้นตอน ผลที่ควรเห็น กรอบ และระยะขอบทุกหน้า ไม่ใช้เพียง contact sheet

รอบจัดหน้าพบหน้าสามขั้นตอนชิด footer จึงเพิ่มความสูงหน้า; พบ glyph ลูกศรและ Command ที่ฟอนต์ไม่รองรับจึงใช้ตัวคั่น `>` และ `Command+K`; เพิ่มเงื่อนไขพนักงานที่ใช้งานและเชื่อมบัญชีในหน้าสิทธิ์; แยกหมายเลขฉบับในภาพออกจากคำสั่งทั่วไป เมื่อแก้สองหน้าสุดท้าย เรนเดอร์ PDF ทั้งเล่มอีกครั้ง เปิดตรวจหน้า 14/15 ใหม่ และยืนยันว่าอีก 18 ภาพเรนเดอร์มี hash เดิมทุกหน้า

`verify.py` ผ่านครบ: 20 หน้า, ภาพ PDF ตรงกับไฟล์กรอบทุกพิกเซล, ไฟล์ต้นฉบับ hash เดิม, ภาพและกรอบคงขนาด, ไม่มีพิกเซลเปลี่ยนนอกขอบเขตกรอบ/หมายเลข, เป้าหมายไม่อยู่นอก viewport, ข้อความไทยทุกประโยคค้นได้, ฟอนต์รองรับทุกตัวอักษร, ไม่มีขั้นตอนที่ซ้ำทั้งประโยค, และลิงก์ไฟล์ HTML ครบ

HTML ตรวจใน native preview ทั้ง desktop 1280 × 800 และ mobile 390 × 844: ภาพทั้ง 20 โหลดครบและอัตราส่วนถูกต้อง ข้อความทุก article อยู่ภายในหน้าจอ ไม่มี horizontal overflow ฟอนต์โหลด และสารบัญครบ 20 ปลายทาง ทดลองกดสารบัญ AI บนมือถือสำเร็จ ภาพตรวจอยู่ในรายงาน JSON; การแก้คำอธิบายหมายเลขฉบับสองหน้าครั้งสุดท้ายไม่เปลี่ยนภาพ CSS หรือโครงสร้าง HTML

## ผลรายหน้า

ระดับการตรวจขั้นตอนแยกชัดเจน: LIVE_PERSISTED คือ QA กดบันทึกข้อมูลใหม่และเปิดกลับมาตรวจ; LIVE_NAVIGATION/READ คือเปิดอ่านหรือนำทางจริง; FORM/VALIDATION_AND_INTEGRATION คืออ่านฟอร์มจริงและตรวจผลเขียนด้วย automated integration โดยรักษาข้อมูลเดิม

| หน้า | งาน                       | ปุ่ม / ขั้นตอน / หลักฐาน                                       | ภาพ PDF       |
| ---- | ------------------------- | -------------------------------------------------------------- | ------------- |
| 01   | ลงเวลาวันนี้              | PASS — LIVE_PERSISTED                                          | PASS ทีละหน้า |
| 02   | ดูเวลาและคำขอ             | PASS — LIVE_NAVIGATION                                         | PASS ทีละหน้า |
| 03   | ขอแก้เวลา                 | PASS — LIVE_FORM_AND_INTEGRATION                               | PASS ทีละหน้า |
| 04   | ตรวจโปรไฟล์และกะงาน       | PASS — LIVE_READ                                               | PASS ทีละหน้า |
| 05   | เลือกงานที่ต้องตรวจ       | PASS — LIVE_NAVIGATION                                         | PASS ทีละหน้า |
| 06   | รับรองคำขอแก้เวลา         | PASS — LIVE_FORM_AND_INTEGRATION                               | PASS ทีละหน้า |
| 07   | ส่งกลับให้พนักงานแก้ไข    | PASS — LIVE_VALIDATION_AND_INTEGRATION                         | PASS ทีละหน้า |
| 08   | ตรวจวันที่เวลาไม่ครบ      | PASS — LIVE_PERSISTED                                          | PASS ทีละหน้า |
| 09   | เปิดรายการและเพิ่มพนักงาน | PASS — LIVE_PERSISTED                                          | PASS ทีละหน้า |
| 10   | แก้ข้อมูลพนักงาน          | PASS — LIVE_PERSISTED                                          | PASS ทีละหน้า |
| 11   | ตั้งกะและวันทำงาน         | PASS — LIVE_PERSISTED                                          | PASS ทีละหน้า |
| 12   | สร้างงวดเวลา              | PASS — LIVE_PERSISTED                                          | PASS ทีละหน้า |
| 13   | ตรวจและปิดงวด             | PASS — LIVE_PERSISTED                                          | PASS ทีละหน้า |
| 14   | เลือกฉบับและดาวน์โหลด     | PASS — LIVE_DOWNLOAD                                           | PASS ทีละหน้า |
| 15   | เปิดแก้งวดที่ปิดแล้ว      | PASS — LIVE_PERSISTED                                          | PASS ทีละหน้า |
| 16   | เพิ่มและลบวันหยุด         | PASS — LIVE_PERSISTED_ADD_DELETE (หลักฐานเพิ่มเติมหลัง freeze) | PASS ทีละหน้า |
| 17   | ตรวจสิทธิ์ใช้งาน HR       | PASS — LIVE_READ_SOURCE_BINDING                                | PASS ทีละหน้า |
| 18   | อ่านนโยบายและรูปแบบไฟล์   | PASS — LIVE_READ                                               | PASS ทีละหน้า |
| 19   | ค้นหน้าและหน้าย่อย        | PASS — LIVE_NAVIGATION                                         | PASS ทีละหน้า |
| 20   | ให้ AI พาไปจุดที่ต้องแก้  | PASS — LIVE_PROVIDER_AND_NAVIGATION                            | PASS ทีละหน้า |

## หลักฐานการใช้งานและขอบเขตการทดสอบ

QA บันทึกคู่เวลาเข้าออกใหม่ของวันที่ 10 ต.ค. แล้วโหลดกลับมาตรวจ, สร้างพนักงาน HR-QA-20261010 ที่มีช่วงการจ้างงานเพียง 2 ก.พ. 2026, บันทึกกะจันทร์ 08:30–17:30 พัก 60 นาที, รับรองวันทดสอบเป็นทำงาน 8 ชั่วโมง, สร้างและปิดงวด v1, เปิดร่าง v2 แล้วปิด, และดาวน์โหลดทั้งสองฉบับ โดย CSV v1 ขนาด 545 bytes พร้อม UTF-8 BOM ยังเหมือนเดิมทุก byte หลังมี v2

Search ปกติ “วันหยุด” กดผลจริงแล้วเปิด `/th/hr/settings?section=holidays` พร้อม focus `hr-settings-holidays` ส่วน AI ใช้ query จริง “แก้กะ วิภา” และเลือก EMP-DEMO-002 การทดสอบสุดท้ายทั้ง direct load, reload และ actual AI choice เปิด employee editor ถูกคนและ focus `hr-focus-schedule`; scroll 547.5 และกรอบตารางงาน 0–374.5 อยู่ครบภายใน viewport

คำขอเก่า EMP-VIDEO-004 ใช้เพียงดู comparison/เปิดช่องส่งกลับแล้วกดยกเลิก ไม่มีการรับรองหรือส่งกลับข้อมูลเดิม การส่งคำขอ/รับรอง/ส่งกลับจึงตรวจ UI จริงร่วมกับ integration tests ของ command/version/reason validation ส่วนสิทธิ์สมาชิกตรวจชื่อ/สถานะ/การเชื่อม mutation และ integration โดยไม่มีการสลับสิทธิ์บัญชีจริง รายงานนี้ไม่ได้อ้างว่าได้กดเขียนทุก mutation ใน browser

หน้า 16 มีหลักฐาน live เพิ่มเติมหลัง freeze: QA บันทึกวันหยุดทดสอบ 3 ก.พ. ตรวจ draft guard ของรายการที่ยังไม่ส่ง แล้วกดปุ่ม `ลบวันหยุด วันหยุดทดสอบคู่มือ HR-QA` เพื่อลบเฉพาะ fixture ที่สร้างใหม่ หลังโหลดหน้าใหม่ fixture ไม่อยู่แล้ว และวันหยุดเดิม 2 ต.ค. / 23 ก.ย. ยังอยู่ครบ หลักฐานคือ `holidayFirstSaved`, `holidaySecondDraftGuard`, `holidayRemoved` และ `holidayRemovedReload` ใน `output/hr-simplification-qa/live-workflows.json` จึงรับรองการเพิ่ม–ลบและการคงผลหลัง reload ด้วย browser จริงได้ ภาพตัวอย่างและข้อมูลเดิมไม่เปลี่ยน ส่วน classification ใน manifest ที่ freeze ไว้เป็นหลักฐาน ณ เวลาจัดทำ และคงเดิมเพื่อรักษา hash ของชุดตรวจ

หลักฐานหลัก:

- `output/hr-simplification-qa/live-workflows.json`
- `output/hr-simplification-qa/exports/verification.json`
- `output/pdf/hr-user-guide-th-integrity.json`
- `output/pdf/hr-user-guide-th-unchanged-pages.json`
- `output/pdf/hr-user-guide-th-html-verification.json`
- `tmp/pdfs/hr-user-guide-th/rendered/page-01.png` ถึง `page-20.png`

ผู้ตรวจอิสระตรวจ artifact hash ชุดเดียวกันเสร็จแล้ว ทั้ง 20 หน้าผ่าน รายงานอิสระเก็บผลรายหน้าและหลักฐาน annotation integrity แยกจากรายงานนี้ ไม่ rebuild PDF เพื่อเปลี่ยนเพียงสถานะ metadata

การแก้ callback ใน SearchDialog ครั้งสุดท้ายปรับ focus เมื่อปิด Search เท่านั้น ไม่เปลี่ยน label, layout หรือ state ในภาพ คู่มือชุดที่ผ่านการตรวจจึงยังตรงกับ UI และไม่ต้องสร้างใหม่

ตรวจ SHA-256 ซ้ำหลังอัปเดตรายงานนี้แล้ว ทั้งสี่ artifact คงค่าเดิม:

| Artifact      | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| PDF           | `19d92ccffad1c41fe2425cb4f85c846281810233f517e984ffc14fb87a459669` |
| HTML          | `f531470ac4c4b2c3c3cc0e77c4692b028c83d3de77f58306a14b55788b733966` |
| pages.json    | `a71243b337209bd92931ff196b3b709ad353605809da95d3490a8f28d6d4abdd` |
| captures.json | `20ed0083d96ae527730398f8beb7f6bab8c83325c251eb3eca06c7847d058dff` |

## สร้างซ้ำ

Interpreter ที่ใช้: `/Users/macbook/Development/industrial-sas/output/hr-user-guide-tools/.venv/bin/python`

```sh
output/hr-user-guide-tools/.venv/bin/python docs/manuals/hr-user-guide-th/build.py
pdftoppm -png -scale-to 1600 output/pdf/hr-user-guide-th.pdf tmp/pdfs/hr-user-guide-th/rendered/page
output/hr-user-guide-tools/.venv/bin/python docs/manuals/hr-user-guide-th/verify.py
```

การ build ใหม่ต้องตรวจภาพที่เปลี่ยนและ hash ก่อนส่งมอบอีกครั้ง

## PDF artifact operation marker

ก่อนคำสั่ง authoring แรก marker ของ skill ที่ติดตั้งทำงานสำเร็จหนึ่งครั้ง (exit 0):

```sh
node /Users/macbook/.codex/plugins/cache/openai-primary-runtime/pdf/26.1007.11041/skills/pdf/container_tools/mark_artifact_operation_started.mjs --operation-kind create --expected-output-count 1 --output-format pdf
```

Script อยู่ใน path ของ skill จริง ไม่มีข้อจำกัดจาก marker path และไม่ได้ขออนุมัติเพิ่ม
