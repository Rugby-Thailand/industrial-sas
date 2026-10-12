# แผนปรับ UX UI จากภาพมือถือ

วันที่ 13 ตุลาคม 2026 · สถานะ: Kiro ทำ implementation ครบ; Codex ตรวจและแก้ finding แล้ว เตรียม PR และรอ automated checks ก่อน merge รวม 9 รูป 17 ข้อ ข้อที่เคยรอยืนยันได้รับคำตอบแล้ว

ปรับรายการอาคาร ผังจัดเก็บ รายละเอียดตำแหน่ง sidebar เมนูภาษา รายงานการใช้งาน AI Search และหน้าสแกนตำแหน่งให้ใช้งานบนมือถือได้ชัดเจนขึ้น ลดข้อความและปุ่มที่ซ้ำ วางคำสั่งใกล้ข้อมูลที่เกี่ยวข้อง และขยายภาพกล้อง **สีแดงหมายถึงเอาออก สีเขียวหมายถึงเพิ่มหรือปรับ** ผู้ใช้อนุมัติให้ลงมือแก้ UI โดย Kiro ให้ Codex ตรวจ แล้วเปิด PR และ merge

กลุ่มผู้ใช้คือผู้ใช้งานระบบจัดเก็บและ HR บนมือถือ โหมดการออกแบบคือ Operate โดยใช้หน้าตา typography สี และ component เดิมเป็นฐาน ภาพอ้างอิงเป็น dark mode; เมื่อเริ่มพัฒนาต้องตรวจทั้ง light และ dark mode รวมภาษาไทยและอังกฤษ

ผลตรวจล่าสุดอยู่ใน [verification.md](./verification.md), [Codex Standards review](./codex-standards-review.md) และ [Codex Spec review](./codex-spec-review.md)

## Worktree และภาพต้นฉบับ

- Worktree: `/Users/macbook/.codex/worktrees/mobile-ux-ui-plan/industrial-sas`
- Branch พัฒนา: `codex/mobile-ux-ui` (branch ของแผนเดิม: `codex/mobile-ux-ui-plan`)
- ฐาน implementation: `origin/main` ที่ commit `11c8c2cc65173e252b2464150cccdda092b0235d`
- ฐานที่ใช้ตอนวางแผนและ audit รอบแรก: `733c6acad348f1c024ef033f9d6ae8300e45e363`
- ภาพต้นฉบับอยู่ใน [images](./images/) และมีขนาดไฟล์กับ SHA-256 ใน [images.json](./images.json) เพื่อเช็กว่าภาพยังครบและไม่ถูกแก้ไข
- Checkout เดิมมีงานที่ยังไม่ commit หลายส่วน รวม sidebar และ navigation งานเหล่านั้นไม่ได้ถูกคัดลอกเข้า worktree นี้ ก่อนเริ่ม implementation ต้องเทียบกับงานล่าสุดในส่วนที่เกี่ยวข้อง

| ภาพ                                                                                         | หน้าจอ               | ข้อกำหนด                                                          |
| ------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| [1 — 1000035422.jpg](./images/1000035422.jpg)                                               | อาคารและผังตำแหน่ง   | ปุ่มตั้งค่า/แก้ไข และแถบรายละเอียดที่บังผังหลังเลือกตำแหน่ง       |
| [2 — 1000035419.jpg](./images/1000035419.jpg)                                               | รายละเอียดจุดจัดเก็บ | เอาขนาดซ้ำ หัวข้อซ้ำ และปุ่ม X ภายในออก                           |
| [3 — 1000035416.jpg](./images/1000035416.jpg)                                               | Sidebar              | เปิด sidebar อีกครั้งแล้วเลื่อนไปยังเมนูที่เลือกอยู่              |
| [4 — 1000035412.jpg](./images/1000035412.jpg)                                               | การใช้งาน AI         | ย้าย Export จากแถวตัวกรองลงมาข้างหัวข้อรายละเอียดการใช้งาน        |
| [5 — 1000035410.jpg](./images/1000035410.jpg)                                               | Search               | เอาข้อความอธิบายยาวและ Open page ที่ซ้ำออก; ตรวจตำแหน่งปุ่ม X     |
| [6 — 1000035407.jpg](./images/1000035407.jpg)                                               | รายการอาคาร          | เอาคำอธิบายใต้หัวข้อออก และย้ายปุ่มเพิ่มอาคารไปด้านขวาของแถวค้นหา |
| [7 — 1000035404.jpg](./images/1000035404.jpg)                                               | เมนูภาษา             | เพิ่มธงหน้ารายการ Thai และ English                                |
| [8 — Screenshot_20261012_222003_Chrome.jpg](./images/Screenshot_20261012_222003_Chrome.jpg) | กล้องสแกนตำแหน่ง     | ขยายภาพกล้องและลดปุ่มเลือกภาพเต็มแถวเป็นไอคอน                     |
| [9 — Screenshot_20261012_221830_Chrome.jpg](./images/Screenshot_20261012_221830_Chrome.jpg) | ภาพที่ AI อ่านไม่ได้ | ย้ายคำสั่งอ่านภาพเดิมซ้ำด้วย AI ไปกลางภาพ และถอด control ที่วงแดง |

## รายการปรับตามภาพ

| ID    | ภาพและสี      | การปรับ                                                                                                                                                 | เกณฑ์ตรวจรับ                                                                                                                                                                | สถานะ                                                                    |
| ----- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| UX-01 | 1 แดงและเขียว | ลบปุ่มไอคอน sliders เดิมจากแถวคำสั่ง แล้วเพิ่มไอคอนปากกาทันทีหลังชื่อตึกเพื่อเปิดฟอร์มแก้ไขอาคารเดิม                                                    | มีไอคอนแก้ไขเพียงหนึ่งตำแหน่งหลังชื่อตึก ชื่อยาวขึ้นบรรทัดใหม่ได้โดยไอคอนอยู่ต่อจากชื่อ มีชื่อ accessible และเปิดฟอร์มเดิมได้                                               | ยืนยันแล้วจากผู้ใช้                                                      |
| UX-02 | 1 แดง         | เอาแถบชื่อพื้นที่และ “รายละเอียดจุดจัดเก็บ” ที่พาดบนผังออกเฉพาะมือถือ ตาม useStorageLayoutMobile (viewport ≤580px)                                      | เลือก area/location → ปิด sheet → แตะรายการเดิมแล้วเปิดอีกครั้ง โดยไม่ยกเลิกเลือกหรือเปลี่ยน zoom/pan; desktop และ compact workspace ที่ไม่ใช่มือถือยังเปิดรายละเอียดซ้ำได้ | ระบุชัดจากภาพ; ต้องปรับ selectArea คู่กับการลบแถบ                        |
| UX-03 | 2 แดง         | เอาขนาดออกจากคำอธิบายของ mobile sheet โดยสร้างชื่อแสดงผลจาก label ที่มีขนาดฝังอยู่ เฉพาะ suffix ที่ตรวจตรงกับ width/depth และหน่วยของพื้นที่            | ขนาดแสดงครั้งเดียวในแถวข้อมูล ชื่อส่วนอื่นและเลขลำดับยังครบ ไม่เปลี่ยนชื่อที่บันทึกไว้; format ที่ไม่รู้จักใช้ชื่อเดิมเป็น fallback                                         | ระบุชัดจากภาพ; ต้องตรวจรูปแบบ label ก่อนพัฒนา                            |
| UX-04 | 2 แดง         | ซ่อนหัวข้อชื่อพื้นที่ที่ซ้ำในเนื้อหา mobile sheet ของ selectedArea                                                                                      | ชื่อพื้นที่ยังอยู่ในคำอธิบายของ sheet; desktop inspector และรายละเอียดในตารางยังมีหัวข้อเดิม                                                                                | ระบุชัดจากภาพ; จำกัดการซ่อนตาม host                                      |
| UX-05 | 2 แดง         | เอา X สำหรับยกเลิกการเลือกในเนื้อหา mobile sheet ออก เหลือปุ่มปิด sheet ด้านบน                                                                          | ปิด sheet แล้ว selection ยังอยู่ แตะ area/location เดิมเพื่อเปิดซ้ำได้; desktop ยังยกเลิกการเลือกได้ตามเดิม                                                                 | ระบุชัดจากภาพ; ปุ่มทั้งสองทำหน้าที่ต่างกัน                               |
| UX-06 | 3 เขียว       | เปิด mobile sidebar อีกครั้งแล้วเลื่อน active item ให้อยู่ในพื้นที่ที่มองเห็น หาก navigation รุ่นจริงมีกลุ่มพับให้เปิดกลุ่มของ active item              | เลื่อน SidebarContent ครั้งเดียวต่อการเปิดหลัง activeHref/สิทธิ์พร้อม ไม่เลื่อนหน้าเบื้องหลัง ไม่ย้าย focus และไม่ดึงตำแหน่งระหว่างผู้ใช้เลื่อน                             | ระบุชัดจากภาพ; ต้องเทียบ navigation รุ่นที่มีอยู่จริง                    |
| UX-07 | 4 แดงและเขียว | ย้าย Export จากแถวตัวกรองไปข้างหัวข้อ “รายละเอียดการใช้งาน”                                                                                             | ใช้ exportCsv/scope เดิม ช่วงวัน ตัวกรอง timezone และ busy guard ตรงรายงาน ชื่อ accessible ระบุขอบเขตไฟล์จริง                                                               | พบ source ที่ตรงภาพใน candidate branch; รอยืนยัน build จาก URL           |
| UX-08 | 5 แดง         | เอาย่อหน้า “Ask AI sends your typed text…” ออกจาก Search ตามวงแดง คำสั่งนี้แทนที่ข้อกำหนด disclosure เดิมในแผนก่อนหน้า                                  | พื้นที่เหนือผลลัพธ์กระชับ และ Ask AI ยังทำงานตาม flow เดิม ปรับ tests ของ disclosure ให้ตรงคำสั่งล่าสุด                                                                     | ยืนยันขอบเขตจากคำสั่งสีแดง ไม่ต้องถามซ้ำ                                 |
| UX-09 | 5 แดง         | เอาข้อความ “Open page” ที่ซ้ำใต้ผลลัพธ์แต่ละรายการออก                                                                                                   | ผู้ใช้แตะทั้งแถวหรือใช้ปุ่มลูกศรและ Enter เปิดผลลัพธ์ได้ และแถวที่เลือกยังเห็นชัด                                                                                           | ระบุชัดจากภาพ                                                            |
| UX-10 | 5 เขียว       | จัดปุ่ม X ให้อยู่กึ่งกลางแนวตั้งกับหัวข้อ Search โดยปรับเฉพาะ Search                                                                                    | title กับ close มี center-y ตรงกันทั้งไทย/อังกฤษ ตรวจชื่อยาวและคีย์บอร์ด; dialog อื่นและการคืน focus คงพฤติกรรมเดิม                                                         | ยืนยันแล้วจากผู้ใช้                                                      |
| UX-11 | 6 แดง         | เอาคำอธิบาย “Plan buildings, floors, and QR-addressable storage spots.” ใต้หัวข้อรายการอาคารออก                                                         | หัวข้อหน้าอยู่ชัดเจนและพื้นที่ก่อนรายการอาคารกระชับขึ้นทั้งไทยและอังกฤษ                                                                                                     | ระบุชัดจากภาพ                                                            |
| UX-12 | 6 แดงและเขียว | ย้าย New building จากใต้หัวข้อไปเป็นปุ่ม + Building ข้างขวานอกกรอบช่องค้นหา มี action เดียวในทั้งมุมมองอาคารและทุกตำแหน่ง                               | ปุ่มแยกจาก input ไม่ทับ clear search แสดงหนึ่งปุ่มต่อมุมมอง เปิดฟอร์มเดิมได้; ชื่อสั้นใช้ translation key ใหม่โดยชื่อหน้า New building คงเดิม                               | ยืนยันแล้วจากผู้ใช้: นอกกรอบค้นหา                                        |
| UX-13 | 7 เขียว       | เพิ่มธงไทยและสหราชอาณาจักรหน้าชื่อภาษาในเมนู โดยธงมี aria-hidden และ textValue เป็นชื่อภาษา                                                             | มีธง ชื่อ และ active state; typeahead กับชื่อ option ยังใช้ชื่อภาษา และเปลี่ยนภาษาแล้วรักษา route/query/hash                                                                | ระบุชัดจากภาพ                                                            |
| UX-14 | 8 เขียว       | ขยาย barcode live preview ในขั้นค้นหาพื้นที่ของหน้า Scan ใบ Job ให้ใช้ความกว้างมากขึ้นและจำกัดความสูงตาม viewport โดยคง aspect ratio และ object-contain | เห็นทั้งเฟรมที่ decoder อ่าน ภาพไม่ยืดหรือถูก crop กรอบเล็งกับปุ่มเข้าถึงได้ทั้งแนวตั้ง/แนวนอน; scanner ใน flow อื่นใช้ค่าเดิม                                              | ยืนยันหน้าจอจากผู้ใช้: Scan ใบ Job → ค้นหาพื้นที่                        |
| UX-15 | 8 แดงและเขียว | เอาปุ่มเลือกภาพเต็มแถวและข้อความบนปุ่มออก ใช้ IconButton ImagePlus ที่เดิมใต้ preview ชิดซ้าย โดยคงข้อความอธิบายใต้ปุ่ม                                 | เลือกภาพได้ มีชื่อ accessible และ touch target ตามระบบเดิม ไม่มีปุ่มซ้ำ; ไม่ลบข้อความอื่นที่ไม่ได้ระบุชัดในภาพ                                                              | ระบุชัดเรื่องรูปแบบ; ตำแหน่งเริ่มต้นอิงไอคอนในภาพ 9                      |
| UX-16 | 9 แดง         | เอาปุ่ม “ลองอ่านอีกครั้ง” เต็มแถวและไอคอนเปิดกล้องถ่ายใหม่ด้านล่างที่วงแดงออก เพิ่ม retry กลางภาพตาม UX-17                                              | อ่านซ้ำจากกลางภาพได้ ยังเลือกภาพใหม่และเข้ากล้องจากคำสั่งที่เหลือใน flow ได้; ไม่มี control ที่วงแดง                                                                        | ความหมาย UX-17 ยืนยันแล้ว พบว่าไอคอนล่างเป็นเปิดกล้องใน candidate source |
| UX-17 | 9 เขียว       | เพิ่มปุ่มลูกศรวนกลางภาพเพื่ออ่านภาพเดิมซ้ำด้วย AI                                                                                                       | มีชื่อ accessible “อ่านภาพเดิมซ้ำด้วย AI” กดครั้งเดียวเรียก extract หนึ่งครั้งใช้ภาพเดิมและ crop เดิม การแตะภาพทั่วไปไม่เรียก AI; ขณะอ่านป้องกัน retry ซ้ำและมี Cancel      | ยืนยันแล้วจากผู้ใช้                                                      |

UX-01 ยืนยันให้ลบปุ่มเดิมและเพิ่มไอคอนปากกาหลังชื่อตึก UX-10 ยืนยันให้ปุ่ม X อยู่กึ่งกลางแนวตั้งกับหัวข้อ Search หลัง audit ผู้ใช้ยืนยัน UX-12 ให้ + Building อยู่ข้างขวานอกกรอบค้นหา และ UX-17 ให้ปุ่มลูกศรวนกลางภาพอ่านภาพเดิมซ้ำด้วย AI ภาพ 8/9 เป็นขั้นค้นหาพื้นที่ในหน้า Scan ใบ Job ไม่มีการเพิ่มฟังก์ชันหมุนภาพในงานนี้

## ผล audit และการปรับแผน

Kiro (`claude-opus-5.5`, high) เปิดตรวจพิกเซลครบ 9 ภาพและเทียบกับ source/tests พบว่าแผนครอบคลุมเครื่องหมายทั้งหมด แต่มีข้อสมมติเกี่ยวกับ workflow และ component ที่ต้องแก้ อ่าน [รายงาน Kiro ฉบับเต็ม](./kiro-audit.md), [คำขอตรวจ](./audit/kiro-request.md) และ [หลักฐานการอ่านภาพ](./audit/kiro-image-evidence.json)

รายงานเป็นข้อค้นพบต่อแผนก่อนปรับและก่อนผู้ใช้ยืนยัน UX-17 ส่วนแผนฉบับนี้รวมการตรวจและการตัดสินใจล่าสุด งานที่ระบุ source ได้ชัดเริ่มได้เมื่อเทียบฐานล่าสุดแล้ว; UX-07 และ UX-14–17 ต้องหาหน้ารายงาน/หน้าสแกนที่ตรงกับภาพ ส่วน UX-06 ต้องตรวจ navigation รุ่นจริง ไม่มีงานแก้ UI ในรอบ audit นี้

| Finding                                       | การตัดสินใจในแผนฉบับปรับ                                                                                                                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 การปิด/ยกเลิกเลือกและเปิดรายละเอียดซ้ำ     | จำกัดการลบแถบและ X ในเนื้อหาที่ viewport ≤580px ตาม mobile hook; เปลี่ยนการแตะ area เดิมให้เปิด sheet โดยคง selection/zoom/pan ช่วง compact workspace ที่ไม่ใช่มือถือรักษาทางเปิดซ้ำเดิม                                                                                    |
| F2 ขนาดฝังใน label                            | รับข้อค้นพบเรื่องแหล่งข้อมูล แต่ไม่รับข้อสรุปว่าแก้การแสดงผลด้วย UI ไม่ได้ ใช้ชื่อแสดงผลที่ตัดเฉพาะ suffix ขนาดเมื่อพิสูจน์ว่าตรงกับ width/depth และหน่วยจริง ไม่แก้ข้อมูลที่บันทึกไว้ ไม่ตัดตัวเลขทั่วไป หาก format ไม่รู้จักให้ใช้ label เดิมและตรวจผ่าน editor ที่มีอยู่ |
| F3 disclosure จากแผนเก่า                      | คำสั่งล่าสุดของผู้ใช้ให้ลบย่อหน้าที่วงแดงมีลำดับเหนือแผนเก่า บันทึกว่า UX-08 แทนที่ข้อกำหนดเดิม และปรับ tests ตามนั้น ไม่เปิดคำถามเรื่องนี้ซ้ำ                                                                                                                              |
| F4–F5 preview และขอบเขตกล้อง                  | คงภาพเต็มเฟรมและ object-contain ขยายเพดานขนาดเฉพาะ instance ของหน้าสแกนในภาพผ่าน opt-in กล้อง LocationPhotoCamera สำหรับถ่ายภาพ AI อยู่นอก UX-14                                                                                                                            |
| F6 ไอคอนลูกศรวน                               | ผู้ใช้ยืนยันปุ่มกลางภาพอ่านภาพเดิมซ้ำด้วย AI แล้ว ตรวจ accessible name/handler ของไอคอนล่างใน build จริงก่อนลบ เพื่อคงทางเลือกภาพใหม่และเปิดกล้อง ย้าย retry ไปกลางภาพและคง busy guard/Cancel                                                                               |
| F7 ปุ่มเพิ่มอาคารสองมุมมอง                    | ค่าเริ่มต้นคือปุ่มข้างขวาช่องค้นหาและมี action เดียวต่อมุมมอง ทั้งอาคารและทุกตำแหน่ง ชื่อสั้นใช้ key ใหม่                                                                                                                                                                   |
| F8–F9 ปุ่มข้างชื่อและปุ่มปิด Search           | ฐาน Kiro ต้องมี title action slot หากใช้ PageHeader; candidate รุ่นใหม่มีแถวหัวข้อเฉพาะอาคารอยู่แล้ว ให้ใช้แถวนั้น โดย heading/breadcrumb เป็นข้อความตามเดิม จัดปุ่มปิดเฉพาะ Search ด้วยแถวหัวข้อเดียวกัน                                                                   |
| F10 เวอร์ชันภาพกับ source                     | ตรวจ commit/branch ของ build ที่ถ่ายภาพก่อนลงมือในส่วนที่ต่างกัน ข้อนี้เป็นงานค้นหา source ไม่ใช่คำขออนุมัติให้แก้ UI                                                                                                                                                       |
| F11–F15 ข้อความ ไอคอน ภาษา sidebar และ Export | ลบเฉพาะข้อความบนปุ่มที่วงไว้ ใช้ textValue ของภาษา เลื่อนเฉพาะ sidebar ครั้งเดียวต่อการเปิด เก็บ translation ที่มีที่อื่นใช้ และรักษาขอบเขตไฟล์ Export                                                                                                                      |

## Source ที่พบหลัง audit

Codex ตรวจเพิ่มหลัง Kiro เสร็จ พบ branch `codex/navigation-storage-ui-audit-20261012` ที่ commit `a9e1c5223672387291d2a917079fdb2fa0701c4c` ใน `/Users/macbook/Development/industrial-sas-ui-audit-20261012` มีข้อความและโครงสร้างตรงภาพทั้ง sidebar แบบกลุ่ม หน้ารายงาน AI และหน้าสแกน “เราอยู่ที่ไหน?” ไฟล์ที่ตรวจไม่มี diff บน branch นั้น รายละเอียดและ hash ของ source อยู่ใน [source-map.json](./audit/source-map.json)

แหล่งนี้เป็น candidate ที่ตรงลักษณะ UI ผู้ใช้ยืนยันว่าภาพกล้องอยู่ในขั้นค้นหาพื้นที่ของ Scan ใบ Job และตรวจพบเส้นทาง `/[locale]/finished-goods/scan` → JobScanScreen → LocationPicker ใน source ยังไม่ได้ยืนยัน commit ของ build ที่ถ่ายภาพจริง ไม่ได้คัดลอกหรือ merge โค้ดเข้า worktree ของแผน

- [SidebarNavigation.tsx](/Users/macbook/Development/industrial-sas-ui-audit-20261012/src/components/shell/SidebarNavigation.tsx): มีกลุ่ม `NavigationSubmenu` และ `activeHref` ให้ใช้จุดนี้ตรวจ UX-06
- [AiUsageScreen.tsx](/Users/macbook/Development/industrial-sas-ui-audit-20261012/src/features/aiUsage/AiUsageScreen.tsx), [UsageToolbar.tsx](/Users/macbook/Development/industrial-sas-ui-audit-20261012/src/features/aiUsage/UsageToolbar.tsx) และ [UsageBreakdown.tsx](/Users/macbook/Development/industrial-sas-ui-audit-20261012/src/features/aiUsage/UsageBreakdown.tsx): ย้าย trigger Export จาก toolbar ไปยังหัวข้อ breakdown โดยส่ง action/state เดิมจาก screen คง `usageExportScope` และ lifecycle เดิม
- [CameraFrame.tsx](/Users/macbook/Development/industrial-sas-ui-audit-20261012/src/features/finishedGoods/CameraFrame.tsx): preview รุ่นนี้จำกัดด้วย `calc(min(60dvh, 28rem) * aspect)` ไม่ใช่สูตร 320 ของฐาน Kiro ให้ปรับ presentation เฉพาะ instance ที่ตรงภาพโดยคงภาพเต็มเฟรม
- [LocationImageReader.tsx](/Users/macbook/Development/industrial-sas-ui-audit-20261012/src/features/finishedGoods/jobScan/LocationImageReader.tsx): ลูกศรวนด้านล่างเป็น `locationAiOpenCamera` ที่เปิดกล้องถ่ายใหม่ ต่างจากปุ่ม retry เต็มแถวที่เพิ่ม `attempt` ใช้ handler retry สำหรับปุ่มกลางภาพตาม UX-17 และตรวจทางเข้ากล้องที่เหลือหลังถอดไอคอนล่าง
- [StorageLayoutScreens.tsx](/Users/macbook/Development/industrial-sas-ui-audit-20261012/src/features/storageLayouts/StorageLayoutScreens.tsx): รุ่นนี้มีแถว `ชื่ออาคาร → รหัส` โดยใช้ h1 โดยตรง วางปากการะหว่างชื่อกับรหัส และถอด trigger จากแถวคำสั่งเดิมได้ ไม่จำเป็นต้องเพิ่ม API ของ PageHeader สำหรับรุ่นนี้

## จุดในโค้ดฐานเดิมและผลต่อพฤติกรรม

### รายการอาคาร

- [หน้ารายการอาคาร page.tsx](<../../../src/app/[locale]/(desktop)/master-data/storage-layouts/page.tsx>): `PageHeader` แสดง `summary={t("description")}` และปุ่ม `newBuilding` ในส่วนหัว เป็นจุดของ UX-11 และต้นทางปุ่มใน UX-12
- [StorageLayoutScreens.tsx](../../../src/features/storageLayouts/StorageLayoutScreens.tsx): `CatalogueContent` และ `StorageCatalogueFilters` จัดแถวค้นหากับตัวกรองสถานะในมุมมองอาคาร เป็นปลายทางหนึ่งของ UX-12
- [StorageLocationCatalogue.tsx](../../../src/features/storageLayouts/StorageLocationCatalogue.tsx): มุมมองทุกตำแหน่งมี toolbar/ตัวกรองของตัวเอง ต้องส่ง action เพิ่มอาคารให้ทั้งสองมุมมอง มีปุ่มเดียวต่อมุมมอง โดยใช้ route และเงื่อนไขแสดงเดิม ชื่อสั้นใช้ key ใหม่เพราะ `newBuilding` ยังเป็นชื่อหน้าเพิ่มอาคาร
- [SearchField.tsx](../../../src/components/ui/SearchField.tsx): มีปุ่มล้างค่าภายในด้านขวา ต้องจัดปุ่มเพิ่มอาคารให้มีพื้นที่ของตัวเองและไม่ทับปุ่มล้างค่า โดยเริ่มจาก composition เฉพาะหน้ารายการอาคาร

บนมือถือให้ปุ่มเพิ่มอาคารอยู่ข้างขวานอกกรอบช่องค้นหาตามที่ผู้ใช้ยืนยัน แล้วตัวกรองสถานะอยู่แถวถัดไป รักษาค่า search/status และ pagination เดิม ตรวจชื่อปุ่มไทย/อังกฤษและพื้นที่พิมพ์ที่ 360px โดยใช้ composition ของ toolbar แทนการเปลี่ยน SearchField ทุกหน้า

### ผังและรายละเอียดตำแหน่ง

- [StorageLayoutScreens.tsx](../../../src/features/storageLayouts/StorageLayoutScreens.tsx): ย้าย trigger ของ `BuildingSettingsDialog` จาก `settingsAction` เดิมไปต่อหลัง `building.name` เปลี่ยนเป็นปากกา ใช้ dialog/form และชื่อ accessible `openSettings` เดิม คงการซ่อนเมื่อ `ARCHIVED` หรือ `dirty` ปุ่ม sliders สำหรับกรองตำแหน่งข้างช่องค้นหาไม่ได้เป็นเป้าหมาย
- [PageHeader.tsx](../../../src/components/ui/PageHeader.tsx): หากยังใช้ฐานเดิม `title` เป็น string และใช้กับ breadcrumb จึงต้องมีช่อง titleAction แบบ opt-in ปุ่มอยู่นอก h1 การจัดวางหน้าอื่นคงเดิม แต่ candidate รุ่นใหม่มีแถวหัวข้อเฉพาะอาคารแล้ว ให้ใช้โครงสร้างจริงของ build แทนการเพิ่ม API ที่ไม่จำเป็น
- [FloorMap.tsx](../../../src/components/storageLayouts/FloorMap.tsx): ปุ่ม `reopenDetails` ตรงกับแถบที่วงในภาพ 1; `SheetDescription` และเนื้อหา `inspectorDetails` ของ `selectedArea` ตรงกับข้อความซ้ำและ X ในภาพ 2
- [FloorMap.module.css](../../../src/components/storageLayouts/FloorMap.module.css): ตรวจและลบเฉพาะ style ของแถบที่ไม่มีผู้ใช้หลังปรับ flow
- [LocationDetailsHost.tsx](../../../src/components/storageLayouts/LocationDetailsHost.tsx): รักษาการย้ายรายละเอียดระหว่าง desktop inspector และ mobile sheet โดยไม่ remount editor

ปุ่ม X ในเนื้อหาเรียก clearSelection ส่วน Close ของ sheet ซ่อนรายละเอียดและคงการเลือกไว้ จึงเป็นคนละคำสั่ง การลบตาม UX-02/05 จำกัดที่ mobile hook (viewport ≤580px) และปรับ selectArea ให้การแตะ area เดิมเปิด sheet อีกครั้งโดยไม่เรียก clearSelection/fit ส่วน desktop และ compact workspace ที่ไม่ใช่มือถือคงทางเปิดรายละเอียดและการยกเลิกเลือกเดิม

ขนาดในภาพฝังอยู่ใน selectedArea.label จริง UX-03 จึงต้องมี display-name helper ที่ตรวจเฉพาะ suffix ขนาดกับ widthMm/depthMm และหน่วยที่รองรับก่อนตัดออกจากข้อความของ sheet คงเลขลำดับและตัวเลขอื่นในชื่อ หากตรวจไม่ตรงให้ใช้ label เดิมและรายงานจุดที่ต้องแก้ชื่อผ่าน editor ปกติ ไม่มีการเปลี่ยนข้อมูลจริงอัตโนมัติ UX-04 ซ่อนหัวข้อซ้ำเฉพาะ mobile sheet โดย desktop inspector และรายละเอียดในตารางยังมีชื่อเดิม

### Sidebar

- [c-sidebar-2.tsx](../../../src/components/examples/c-sidebar-2.tsx): `AppSidebar`, `NavigationTree` และ `activeNavigationHref` ระบุหน้าปัจจุบัน
- [sidebar.tsx](../../../src/components/ui/sidebar.tsx): mobile drawer ใช้ Sheet และ `SidebarContent` เป็น scroll container

mobile drawer remount เมื่อเปิดใหม่ ให้เลื่อน active item ครั้งเดียวต่อการเปิดหลังรายการตามสิทธิ์พร้อม ใช้ scrollTop ของ SidebarContent เพื่อควบคุมเฉพาะ container หากรายการมองเห็นอยู่แล้วให้คงตำแหน่งไว้ ไม่ย้าย focus และไม่เลื่อนซ้ำหลังผู้ใช้เริ่มเลื่อน ตรวจเมื่อโหลดสิทธิ์ช้า เปลี่ยน route และเปลี่ยน organization/warehouse ฐานนี้ยังเป็น navigation แบบแบน; เปิดกลุ่มพับเฉพาะเมื่อพบว่ารุ่นจริงมีกลุ่มอยู่แล้ว

### เมนูภาษา

- [LocaleSwitcher.tsx](../../../src/components/shell/LocaleSwitcher.tsx): `LANGUAGE_FLAGS` มี 🇹🇭 และ 🇬🇧 สำหรับ trigger แล้ว แต่ `SelectItem` แสดงเพียงชื่อภาษา จึงนำธงเดิมมาใช้ในรายการตาม UX-13 ได้
- [LocaleSwitcher.test.tsx](../../../src/components/shell/LocaleSwitcher.test.tsx): ตรวจชื่อภาษา การเลือกภาษา และ navigation guard เดิม ธงใช้ aria-hidden และ SelectItem ใช้ textValue เป็นชื่อภาษา เพื่อให้ typeahead และชื่อ accessible คงเดิม

### รายงานการใช้งาน AI

ฐาน commit นี้และ checkout เดิมมี [แผน AI usage](../ai-usage-tracking-2026-10-10.md) แต่ไม่มีหน้ารายงาน หลัง audit พบหน้าที่ตรงภาพใน candidate branch ตาม source map ให้ย้ายปุ่มและ handler เดิมโดยรักษาช่วงเวลา ตัวกรอง สิทธิ์ และสถานะ exporting ไม่ต้องสร้างระบบรายงานหรือคำนวณค่าใช้จ่ายใหม่ในงานนี้

### Search

- [SearchDialog.tsx](../../../src/components/shell/search/SearchDialog.tsx): มี disclosure paragraph และ `ResultOption` แสดง `result.action` ใต้ผลลัพธ์
- [dialog.tsx](../../../src/components/ui/dialog.tsx): ปุ่มปิดของ dialog อยู่ที่ `top-3 right-3`
- [messages/en.json](../../../messages/en.json) และ [messages/th.json](../../../messages/th.json): ตรวจข้อความ `Search.aiPrivacy` และ `Search.actionOpen` รวมผู้ใช้ข้อความอื่นก่อนลบ translation

UX-10 ให้ title และ DialogClose ของ Search อยู่ในแถวที่จัดแนวกลางร่วมกัน โดยปิด default close เฉพาะ Search ถ้าจำเป็น ไม่เปลี่ยน top/right ของ dialog ที่ใช้ทั้งระบบ ตรวจ loading ของ SearchDialogLoader และการคืน focus ด้วย UX-09 ลด generic actionOpen ในผลลัพธ์ PAGE/TASK และ AI PAGE แต่เก็บ actionOpenSection/actionOpenForm/actionReviewDay และข้อมูลคำสั่งที่มีความหมายเฉพาะ รักษา combobox/listbox, active result, Enter และ IME ภาษาไทย

UX-08 ลบย่อหน้าที่วงแดงตามคำสั่งล่าสุด โดยบันทึกว่าทดแทนข้อกำหนด disclosure ในแผน HR เดิม Tests ที่บังคับย่อหน้านี้ต้องเปลี่ยนตามคำสั่งนี้ ไม่มีข้อกำหนดให้เพิ่ม dialog ยืนยันหรือข้อความใหม่แทน

### กล้องและการอ่านภาพตำแหน่ง

ขอบเขต UX-14–17 คือ **Scan ใบ Job → ค้นหาพื้นที่ (“เราอยู่ที่ไหน?”)** ในช่วงก่อนเลือก location ให้ opt-in presentation จาก call site ของ [JobScanScreen.tsx](../../../src/features/finishedGoods/jobScan/JobScanScreen.tsx) ไปยัง LocationPicker และ reader ที่ใช้ภายใน LocationPicker ใน JobScanRecords และ scanner ของขั้นอ่านใบ Job/หน้ารับสินค้าอื่นคง presentation เดิม

- [LocationPicker.tsx](../../../src/features/finishedGoods/jobScan/LocationPicker.tsx): สลับระหว่าง barcode camera และการอ่านภาพด้วย AI ต้องรักษาการหยุดกล้องเมื่อเปลี่ยนแหล่งภาพหรือปิดหน้า
- [BarcodeCameraBox.tsx](../../../src/features/finishedGoods/BarcodeCameraBox.tsx): preview ฐานเดิมใช้ `maxWidth: 320 * videoAspect` ให้ขยายเพดานตามพื้นที่ viewport โดยคง aspect ratio และ object-contain เฉพาะ instance ในขั้นค้นหาพื้นที่ของ Scan ใบ Job ผ่าน prop แบบ opt-in ค่าเริ่มต้นของ DestinationScanner, scanner อ่านใบ Job ในขั้นสินค้า และ TicketFieldScanner คงเดิม
- [useBarcodeCamera.ts](../../../src/features/finishedGoods/useBarcodeCamera.ts): decoder และ fallback อ่านทั้งเฟรม กรอบที่เห็นเป็นตัวช่วยเล็ง ภาพเต็มเฟรมต้องยังมองเห็นได้ ไม่เปลี่ยน ROI ของ decoder ในงานขยาย preview นี้
- [LocationPhotoCamera.tsx](../../../src/features/finishedGoods/jobScan/LocationPhotoCamera.tsx): เป็นกล้องถ่ายภาพสำหรับ AI และไม่ใช่ preview ในภาพ 8 จึงอยู่นอกขอบเขต UX-14
- [BarcodeImagePicker.tsx](../../../src/features/finishedGoods/BarcodeImagePicker.tsx): ปุ่ม `ImagePlus` พร้อมข้อความ `chooseBarcodeImage` เป็นปุ่มเต็มแถว ตรงกับ UX-15 หน้าสแกนตำแหน่งใช้ component ร่วมกับหน้ารับสินค้า จึงต้องกำหนดขอบเขตการปรับให้ตรงภาพที่ผู้ใช้ส่ง
- [LocationImageReader.tsx](../../../src/features/finishedGoods/jobScan/LocationImageReader.tsx): มี preview ของภาพและปุ่ม `locationAiRetry` แบบเต็มแถว เมื่อไม่มี candidate เป็นจุดเริ่มสำหรับ UX-16/UX-17

ตำแหน่งปุ่มเลือกภาพ/ปิดและลูกศรวนในภาพอ้างอิงบางจุดไม่ตรงกับฐานนี้ ต้องตรวจ accessible name และ handler ของ build จริงก่อนลบไอคอนล่าง UX-17 ยืนยันเป็นการอ่านภาพเดิมซ้ำด้วย AI ใช้ file/crop เดิม กดปุ่มหนึ่งครั้งเรียก extract หนึ่งครั้ง ระหว่าง busy ซ่อน/disable retry และคง Cancel การแตะภาพทั่วไปไม่เรียก AI ปุ่มเลือกภาพใหม่กับทางเปิดกล้องที่ยังเกี่ยวข้องคงอยู่

คำเตือน AI อ่านรหัสไม่ครบในภาพ 9 ไม่ได้ถูกวงแดง ให้คงข้อความช่วยแก้ปัญหาและทางพิมพ์รหัส/เลือกภาพใหม่ไว้

## ลำดับพัฒนาเมื่อรวบรวมภาพครบ

1. เทียบ source ของ build จริงกับ worktree; ตรวจ candidate สำหรับ UX-06/07/14–17 โดยหน้าสแกนคือขั้นค้นหาพื้นที่ใน Scan ใบ Job UX-01/10/12/17 ยืนยันแล้ว และ UX-08 ใช้คำสั่งสีแดงล่าสุด
2. ทำข้อที่เป็นอิสระ: UX-11 เฉพาะ summary ของหน้ารายการ, UX-13 ธงภาษา และ UX-08/09/10 ของ Search
3. ย้ายปากกา UX-01 เข้าแถวชื่อของ build จริง หากใช้ PageHeader ฐานเดิมจึงเพิ่ม opt-in title action slot ต่อด้วย toolbar/action เพิ่มอาคาร UX-12 ให้ทั้งสองมุมมอง
4. ปรับ selectArea/reopening และ host-specific rendering ของ UX-02/04/05 พร้อม display-name helper ของ UX-03 ที่มี guard ต่อ suffix ขนาด
5. ทำ UX-06 บน navigation รุ่นจริง และ UX-07 เมื่อพบหน้ารายงาน โดยรักษาขอบเขตไฟล์ export
6. ทำ opt-in preview UX-14 ต่อด้วย icon-only picker UX-15 ส่วน UX-16/17 ทำหลังตรวจ handler ของไอคอนเดิม โดยใช้ปุ่มกลางภาพอ่านภาพเดิมซ้ำด้วย AI ตามที่ผู้ใช้ยืนยัน

ก่อนเขียนโค้ดให้อ่านคู่มือ Next.js ที่เกี่ยวข้องใน `node_modules/next/dist/docs/` ตาม AGENTS.md และอ่าน craft floor ของ Impeccable ก่อนแก้ UI

## การตรวจรับหลัง implementation

- ผังมือถือ ≤580px: area/location → ปิด sheet → แตะรายการเดิมแล้ว sheet เปิด zoom/pan/selection คงเดิม ไม่มีแถบหรือ X ในเนื้อหาทับผัง ตรวจ desktop และช่วง 581–850px ว่า Hide details แล้วเปิดกลับได้
- ชื่อพื้นที่: suffix ขนาดที่ตรง width/depth ถูกซ่อนเฉพาะชื่อแสดงผล เลขลำดับ/เลขปี/ตัวเลขอื่นยังอยู่ format ที่ไม่ตรงใช้ label เดิม และข้อมูลที่บันทึกไว้ไม่เปลี่ยน
- ไอคอนอาคาร: heading มีชื่ออาคารล้วน ปากกาอยู่นอก h1 หลังชื่อเพียงหนึ่งปุ่ม ซ่อนตาม ARCHIVED/dirty หน้าที่ไม่ส่ง titleAction มี layout ตามเดิม
- Sidebar: เปิดครั้งแรก ปิดแล้วเปิดซ้ำ ไปยังหน้าที่เมนูอยู่ด้านล่าง และรอโหลดสิทธิ์; active item อยู่ในจอโดยไม่กระโดดขณะผู้ใช้เลื่อนเอง
- Search: ผลลัพธ์ 0/1/หลายรายการ ชื่อยาว ภาษาไทยที่ใช้ IME ArrowUp/ArrowDown/Enter/Escape และ Ask AI ไม่มี disclosure ที่วงแดง/ข้อความ actionOpen ซ้ำ แต่มี action เฉพาะ ตรวจ center-y ของ title/close ต่างกันไม่เกิน 1 CSS px และคืน focus ได้
- Export: ช่วงวันที่/ตัวกรองเดียวกับรายงาน สถานะกำลังส่งออก ไม่มีข้อมูล และข้อผิดพลาด โดยปุ่มไม่ส่งซ้ำระหว่างทำงาน
- รายการอาคาร: ค้นหาข้อความยาว ล้างคำค้น เปลี่ยนสถานะ ไม่มีผลลัพธ์ และเพิ่มอาคารจากปุ่มตำแหน่งใหม่ ทั้งมุมมองอาคาร/ทุกตำแหน่ง มีปุ่มเดียวต่อมุมมอง ตรวจไทย/อังกฤษที่ 360px และชื่อหน้าเพิ่มอาคารยังใช้ข้อความเดิม
- เมนูภาษา: ทั้งสองตัวเลือกมีธง ชื่อ และ active state; เปลี่ยนภาษาแล้วคง route/query/hash และใช้ navigation guard เดิม
- กล้อง: เข้าหน้า Scan ใบ Job โดยยังไม่เลือกพื้นที่ → ค้นหา/เปิดกล้อง/เลือกภาพ → อ่านตำแหน่ง → ยืนยันพื้นที่ ตรวจแนวตั้ง/แนวนอนเห็นทั้งเฟรม สิทธิ์กล้อง หมุนจอ และปิดกล้อง ปุ่มกลางภาพอ่านภาพเดิมซ้ำหนึ่งครั้งต่อ click ระหว่าง busy มี Cancel และป้องกัน retry ซ้ำ; LocationPicker ใน JobScanRecords และ scanner อื่นคงพฤติกรรมเดิม
- ตรวจมือถือกว้าง 360, 390 และ 430 CSS px พร้อมคีย์บอร์ด และ desktop ทั้ง light/dark และไทย/อังกฤษ ปุ่มไอคอนใช้ touch target และชื่อ accessible ตามระบบเดิม
- เลือก tests ของพฤติกรรมที่เปลี่ยน เช่น `FloorMap.labels.test.tsx`, `c-sidebar-2.test.tsx`, `GlobalSearch.test.tsx`, `SearchDialogLoader.test.tsx` และ `SearchDialogFocus.test.tsx`; คง desktop reopening ใน `FloorMap.workspace.test.tsx` ตรวจภาพรวมหนึ่งรอบ แก้เป็นชุด และยืนยันอีกไม่เกินหนึ่งรอบ
- ชุดที่ 2 ตรวจพฤติกรรมที่เปลี่ยนใน `StorageLayoutScreens.test.tsx`, `LocaleSwitcher.test.tsx`, `BarcodeCameraBox.test.tsx`, `BarcodeImagePicker.test.tsx` และ `LocationPicker.ai.test.tsx`; `LocationPhotoCamera.test.tsx` ไม่ต้องแก้สำหรับขอบเขตปัจจุบัน เพิ่มการตรวจ typeahead, opt-in/default scanner และหนึ่ง action ต่อหนึ่ง click

## รับภาพชุดถัดไป

เก็บภาพใหม่ใน `images/` โดยรักษาไฟล์เดิม ถ้าชื่อซ้ำใช้ชื่อใหม่ เพิ่มรายการต่อท้าย `images.json` และตารางภาพด้วย ID ถัดไป ปัจจุบันมี IMG-01 ถึง IMG-09 และ UX-01 ถึง UX-17 ชุดถัดไปเริ่ม IMG-10 และ UX-18 พร้อมระบุภาพ สี และเกณฑ์ตรวจรับ หากภาพใหม่แก้ความหมายของข้อเดิม ให้อัปเดตข้อนั้นและระบุภาพที่ใช้ตัดสินล่าสุด
