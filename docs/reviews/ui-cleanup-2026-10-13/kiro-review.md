# Kiro review — แผน UI cleanup จากภาพ 13 ต.ค. 2026

วันที่ตรวจ: 13 ตุลาคม 2026  
ขอบเขต: ตรวจภาพและแผน [`ui-cleanup-2026-10-13.md`](../../plans/ui-cleanup-2026-10-13.md) เท่านั้น ไม่ได้แก้ application code, translations, styles, tests, contracts, แผน หรือรายงานเดิม

## 1. สรุปผล

การตีความ annotation ใน UI-001 ถึง UI-008 ตรงกับภาพทั้งหมด แต่ source anchors และ baseline ในแผนอ้างอิง local `main` ที่ไม่ใช่โค้ดในภาพ ต้องแก้ส่วนนี้ก่อนเริ่มงาน

- local `HEAD` คือ `733c6aca` ซึ่งนำ `origin/main` อยู่ 2 commits และตามหลัง 62 commits โดยใช้ `origin/main` = `7a33448d` (#92) จาก ref ที่ fetch ไว้ในเครื่อง นอกจากนี้ working tree ยังมีไฟล์ที่แก้แต่ยังไม่ commit จำนวนมาก
- ภาพทั้งสามตรงกับ `origin/main` แต่ไม่ตรงกับ working tree:
  - Sidebar: ใน `origin/main` ชื่อแอปอยู่เหนือตัวเลือกคลัง ไอคอนเป็น `size-10 rounded-xl` และมีปุ่มค้นหาปุ่มเดียว ส่วน local แยก branding กับคลังเป็นสองแถว และมีปุ่ม AI Search แยก
  - QR: ข้อความ `layoutActions.qr.areaAuto` และ `layoutActions.qr.help` มีอยู่ใน `origin/main` ทั้งใน `messages/th.json:805,807`, `messages/en.json:805,807` และ `StorageZonesPanel.tsx:1271-1292`
- ข้อความในแผนที่ว่า “ไม่พบใน production `src` และ locale messages” จึงถูกเฉพาะกับ local working tree และ `HEAD` ถ้าใช้ baseline ของภาพ UI-008 เป็นงานลบจริง ไม่ใช่งานตรวจรับว่าไม่เพิ่มข้อความกลับมา

### สิ่งที่เห็นจริงในภาพ

ผมเปิดไฟล์ JPG ทั้งสามด้วย image tool และดูพิกเซลได้สำเร็จ

| ภาพ                               | annotation ที่เห็นจริง                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1000035454 (Sidebar มือถือ, dark) | วงแดงรอบกล่องไอคอนอาคารสีน้ำเงินด้านซ้ายบน และขีดแดงใต้/รอบคำว่า `Storage Planner` ซึ่งอยู่เหนือ select `TG-OPT · Top G…` ทางขวาของภาพมีปุ่ม `X` แยกอยู่ ใต้ลงมาเป็นช่อง Search ปุ่มเดียวพร้อม `Ctrl K` ไม่เห็นปุ่ม AI Search แยก และไม่มีเครื่องหมายสีเขียว                                                                                                            |
| 1000035458 (Sheet รายละเอียดจุด)  | กรอบแดงรอบ subtitle `F1-L20-6 · ชั้น 1` ใต้หัวข้อ วงเขียวรอบ badge `● ว่าง` พร้อมลูกศรชี้ไปทางขวาของ `F1-L20-6` มีขีดและลูกศรเขียวพร้อมคำว่า “Add divine line” ซึ่งน่าจะหมายถึง divider ระหว่างแถวพื้นที่/หน่วยจัดเก็บกับกล่อง “สินค้าที่จัดเก็บ” และมีเส้นเขียวขีดใต้ข้อความในกล่องพร้อมคำว่า “remove bg color” จุดเขียวเล็ก ๆ ข้างหัวข้อดูเป็นรอยหลุดที่ไม่มีความหมาย |
| 1000035459 (ส่วน QR เปิดอยู่)     | กรอบเขียวครอบ caption `QR ของจุด · สแกนแล้วเลือกจุดนี้ทันที` กับรูป QR โดยเริ่มใต้ summary `ป้าย QR (1)` และจบก่อนบรรทัด `ISAS:LOCATION:…` คำว่า “Center” อยู่ทางขวา มีวงแดงรอบย่อหน้า “พิมพ์ QR ของจุดติดที่ทางเข้าจุด … ตำแหน่งที่ทำเครื่องหมาย” และจุดเขียวใต้ “Center” ซึ่งดูเป็นรอยหลุดเช่นกัน                                                                     |

ข้อสรุปว่าภาพตรงกับ `origin/main` มาจากการเทียบ source ไม่ได้รันแอปจริง ส่วน “divine line” ตีความว่า divider และจุดเขียวเล็ก ๆ ตีความว่าเป็นรอยหลุด ทั้งสองเรื่องเป็นการอนุมาน

## 2. ตาราง UI-001 ถึง UI-008

แผนระบุ anchor เป็นชื่อ symbol ส่วนตารางนี้ใช้เลขบรรทัดจาก `origin/main@7a33448d` เพื่อให้ตรงกับภาพ

| รหัส   | การตีความ                                       | ผล                       | Anchor (`origin/main`)                                                         | การแก้แผนที่จำเป็นน้อยที่สุด                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-001 | ลบกล่อง/ไอคอนอาคาร                              | เห็นด้วย / แก้ anchor    | `c-sidebar-2.tsx:234-236`, import `:14`                                        | ไอคอนอยู่ใน identity block เดียวกับชื่อแอปและ `WorkspaceContextBar` โดย block นี้ไม่ได้แยกตามขนาดจอ และถูกซ่อนแบบ `collapsed && "sr-only"` ข้อความว่า “`Building2` ยังใช้เป็นไอคอนเมนู” เป็นจริงเฉพาะ local ในไฟล์นี้ของ `origin/main` จะไม่มีที่ใช้ `Building2` เหลือ                                                                                                                                               |
| UI-002 | ลบชื่อแอปเหนือตัวเลือกคลัง                      | เห็นด้วย / แก้ anchor    | `:238`, `const app` `:190`                                                     | ใน `origin/main` ชื่อแอปอยู่ในคอลัมน์เดียวกับ selector ไม่ได้อยู่แถวแยก หลังลบให้ selector อยู่แถวเดียวกับปุ่ม `NavigationDisclosure` (`:244`) ทันที footer ใช้ `useOrganizationName()` ไม่ได้ใช้ `app("name")` ในไฟล์นี้ จึงต้องลบตัวแปร `app` ที่ไม่ได้ใช้ออก แต่ยังคง key `App.name` เพราะ `layout.tsx:49` และ `useOrganizationName.ts:13` ยังใช้อยู่ ให้ตัดข้อความว่า local มี AI Search แยกออกจากบริบทของภาพนี้ |
| UI-003 | ลบ subtitle ที่มองเห็นได้ใน Sheet header        | เห็นด้วย / ต้องระบุเพิ่ม | `FloorMap.tsx:1032-1046`                                                       | `SheetDescription` ตัวเดียวใช้ทั้ง location (`selected?.code`) และ reserved area ให้ใช้เงื่อนไขเฉพาะ `selected` แล้วคง reserved area ไว้ตามเดิม ให้ระบุว่าจะเก็บ description แบบ `sr-only` สำหรับ location (รายละเอียดในหัวข้อ 3)                                                                                                                                                                                    |
| UI-004 | ย้าย badge สถานะมาอยู่ขวาของรหัส                | เห็นด้วย / แก้เล็กน้อย   | `StorageZonesPanel.tsx:1030-1043`, CSS `.status` `FloorMap.module.css:177-187` | badge อยู่ใน body ไม่ได้อยู่ใกล้ปุ่มปิด ให้แก้เกณฑ์เป็น “รหัสยาว wrap โดยไม่ทับ badge” แทนการบอกว่าไม่บังปุ่มปิด badge ต้องอยู่นอก `h3` (ดูหัวข้อ 3)                                                                                                                                                                                                                                                                 |
| UI-005 | เพิ่ม divider หนึ่งเส้นเหนือ “สินค้าที่จัดเก็บ” | เห็นด้วย                 | `:1044` (`.metrics`) → `:1074` (`.inventory`)                                  | ไม่ต้องแก้                                                                                                                                                                                                                                                                                                                                                                                                           |
| UI-006 | เอาพื้นหลังของกล่องสินค้าออก                    | เห็นด้วย                 | `:1074-1091`, CSS `.inventory` `:203-214`                                      | ไม่ต้องแก้ ตรวจแล้วพบว่า `.inventory` และ `.status` ใช้เฉพาะใน `StorageZonesPanel` ส่วน `FloorWorkspaceLocationList` ใช้ CSS module ของตัวเอง ทั้งในโค้ดและเกณฑ์ตรวจรับยังคงพื้นขาวและ padding ของ `QrCode` ไว้                                                                                                                                                                                                      |
| UI-007 | จัด caption และ QR หลักให้อยู่กลาง              | เห็นด้วย / แก้ถ้อยคำ     | caption `:1271-1277`, QR `:1278-1286`, value `:1287-1289`                      | caption มีอยู่จริงและอยู่ในกรอบเขียว จึงต้องจัดกลางคู่กับ QR ไม่ใช่เงื่อนไข “ถ้ามี” บรรทัดค่า QR อยู่นอกกรอบ เราตัดสินใจเองได้ว่าจะคงชิดซ้ายหรือจัดกลาง ข้อสำคัญคือต้องคง `break-all` ไว้ `QrCode` ใช้ `inline-grid` จึงต้องจัดกลางที่ wrapper โดยไม่เปลี่ยน `size` และ `padding`                                                                                                                                    |
| UI-008 | ลบย่อหน้าคำแนะนำการพิมพ์                        | แก้                      | `StorageZonesPanel.tsx:1290-1292`, key `layoutActions.qr.help`                 | เปลี่ยนจากงานตรวจรับ/ไม่เพิ่มกลับเป็นงานลบ `<p>` นี้ key ใช้ที่จุดนี้ที่เดียว จึงลบ key ทั้ง th/en ได้ ย่อหน้านี้อยู่นอก `compact &&` การลบจึงกระทบ list view บน desktop ด้วย                                                                                                                                                                                                                                        |

## 3. Acceptance และผลกระทบที่ยังขาด

- Baseline: ให้ระบุในแผนว่า implementation เริ่มจาก `origin/main` ล่าสุด ไม่ใช่จาก local working tree ที่ค้าง ต้องไม่ทับหรือย้ายการแก้ที่ยังไม่ commit ใน checkout นี้ แนะนำให้ใช้ branch หรือ worktree แยก
- ชื่อ test ใน sidebar ไม่มีใน `origin/main`: ทั้งสามชื่อที่แผนอ้าง (`keeps only menu, flag-only…`, `opens Search only after…`, `never opens Search after…`) มีเฉพาะใน working tree ให้ใช้ชื่อที่มีจริงใน `origin/main:c-sidebar-2.test.tsx`:
  - `keeps search and warehouse context inside the drawer, with only a flag in the header`
  - `closes the drawer before opening search and restores focus to the mobile menu`
  - `starts expanded with a flag-only header and exactly one disclosure inside the desktop sidebar`
  - `hands focus to the warehouse selector when the rail warehouse expands the sidebar`
- ตำแหน่ง test ของ Back: ใน `origin/main` เคส `native Back dismisses the mobile location inspector before leaving the building` อยู่ใน `StorageLayoutNavigation.test.tsx:1007` ไม่ได้อยู่ใน `StorageLayoutScreens.test.tsx` อีกสามเคสของ QR ยังอยู่ใน `StorageLayoutScreens.test.tsx`
- ผลกระทบร่วมระหว่าง desktop และมือถือ:
  - Sidebar identity block ใน `origin/main` แสดงทั้งมือถือและ desktop ที่ขยายอยู่ ถ้าลบโดยไม่ใส่เงื่อนไข desktop จะเปลี่ยนตามไปด้วย ผู้ใช้ยังไม่ได้อนุมานเรื่องนี้
  - เนื้อหา `compact` ซึ่งเป็นเจ้าของ UI-004 ถึง UI-007 แสดงทั้งใน mobile Sheet และ desktop inspector
  - UI-008 กระทบทั้ง compact และ list view
- Accessibility:
  - (UI-003) Radix Dialog ที่ติดตั้งอยู่ใส่ `aria-describedby` เฉพาะเมื่อมี Description ถ้าลบออก screen reader จะได้ยินแค่ “รายละเอียดจุดจัดเก็บ” ตอนเปิด และไม่ได้ยินรหัสกับชั้น แนะนำให้คง `SheetDescription` แบบ `sr-only` สำหรับ location ไว้ เรื่องนี้เราตัดสินใจเองได้
  - (UI-004) badge ต้องอยู่ข้าง `h3` ไม่ใช่อยู่ในนั้น เพื่อให้ heading ยังเป็นรหัสล้วน และคง `●` แบบ `aria-hidden` ไว้
  - (UI-001/002) ชื่อที่ screen reader อ่านใน drawer มาจาก `SheetTitle` แบบ `sr-only` (`mobileTitle`) จึงไม่ได้รับผลกระทบ ใน desktop rail ที่ย่ออยู่ identity block ถูกซ่อนแบบ `sr-only` แล้ว การลบจึงทำให้ screen reader ไม่อ่านชื่อแอปซ้ำอีก ข้อนี้ยอมรับได้
- QR: การจัดกลางต้องไม่เปลี่ยนขนาด 128 หรือ quiet zone 8 px และต้องไม่ทำให้กล่องยืดตาม `width:100%` เคส `unchanged square QR boxes` และ `keeps the zone QR scannable…` ครอบคลุมเรื่องนี้ ส่วนรายการตำแหน่งย่อย (`:1293-1320`) ไม่จัดกลาง
- Navigation: งานนี้ไม่เปลี่ยน state หรือ overlay owner แต่ `FloorMap.tsx` และ `c-sidebar-2.tsx` อยู่ใน inventory ให้รัน `pnpm check:navigation` และ ESLint หลังแก้ (ESLint จะจับ import `Building2` และ `app` ที่ไม่ได้ใช้) ถ้ามีการเพิ่ม conditional render ใน Sheet header ให้ตรวจ entry `FloorMap.tsx#FloorMap:inspectorVisible` และ `…:qr` ว่า targets ไม่เปลี่ยน
- สิ่งที่เห็นแต่ไม่มี annotation (ไม่จัดเข้างาน): ภาพที่ 3 มี “ยังไม่มีหน่วยที่จัดเก็บหรือจอง” สองครั้ง คือในกล่องสินค้า (`:1091`) และใต้ QR (`:1322-1327`) หลังทำ UI-006 สองบรรทัดนี้จะอยู่บนพื้นเดียวกัน ผู้ใช้ไม่ได้วงแดงไว้ จึงไม่ลบเว้นแต่ผู้ใช้สั่ง

## 4. คำถามถึงผู้ใช้

เรื่องขอบเขตที่ต้องให้ผู้ใช้ตัดสิน:

1. Desktop sidebar ต้องลบไอคอนอาคารและชื่อ `Storage Planner` ด้วยหรือไม่ ใน `origin/main` สองส่วนนี้แสดงบน desktop ที่ขยายอยู่ด้วย ถ้าตอบว่า “มือถือเท่านั้น” desktop จะคงเดิม
2. ให้ย้าย badge, เพิ่ม divider, เอาพื้นหลังออก, จัด QR กลาง และลบคำแนะนำการพิมพ์ใน desktop inspector/list ด้วยหรือไม่ ทุกจุดยกเว้น UI-003 เป็นคอมโพเนนต์ร่วม คำแนะนำคือให้ใช้ทุกขนาดจอเพื่อไม่ต้องแยกสอง layout แต่ภาพยืนยันได้เฉพาะมือถือ

เรื่อง implementation ที่เราตัดสินใจเองได้ ไม่ต้องถามผู้ใช้: เริ่มจาก baseline `origin/main`, เก็บ `SheetDescription` แบบ `sr-only`, เลือกการจัดแนวบรรทัดค่า QR, ลบ key `qr.help` ที่ไม่ได้ใช้แล้ว และวางตำแหน่ง badge ไว้นอก `h3`

## 5. ข้อจำกัด

- ตรวจภาพที่ระดับพิกเซลแล้ว แต่ไม่ได้รันแอป, browser, test suite, backend หรือ `pnpm check:navigation`
- การเทียบ `origin/main` ใช้ remote ref ในเครื่อง โดยไม่ได้ fetch ใหม่ ถ้า remote เปลี่ยนหลังจากนี้ เลขบรรทัดอาจคลาดเคลื่อน
- คำสั่ง git ที่ใช้มีเฉพาะแบบอ่านอย่างเดียว (`status`, `log`, `show`, `grep`, `diff --stat`, `rev-list`) ไม่ได้ commit, push, deploy หรือแก้ข้อมูล ส่วน working tree ยังมีการแก้ที่ไม่ได้ commit เหมือนเดิมทุกไฟล์
- ไฟล์เดียวที่เขียนคือรายงานนี้ ไม่ได้แก้ application code, translations, styles, tests, contracts, แผน หรือรายงานอื่น
