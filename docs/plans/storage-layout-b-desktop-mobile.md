# Storage layout B — desktop / mobile implementation plan

Date: 2026-09-30

Status: Production frontend implementation B แล้วเสร็จ; tests/typecheck/lint/build ผ่าน. Browser QA matrix และภาพหลักฐานยังต้องยืนยันก่อนนำขึ้น production.

## ผลลัพธ์ที่ต้องการ

ใช้ B เป็นหน้า workspace สำหรับอาคาร: เลือกชั้น → ดูแผนผัง → เลือกจุดจัดเก็บ → ดูรายละเอียดหรือแก้ไข. Desktop ให้แผนผังเป็นพื้นที่หลัก มีแถบชั้นขนาดเล็กด้านซ้ายและรายละเอียดด้านขวา. Mobile ใช้แผนผังเต็มความกว้าง สลับไปดูรายการได้ และเปิดรายละเอียดจุดจัดเก็บเป็น bottom sheet.

Feedback ในภาพระบุว่าแถบเลือกชั้นและการ์ดชั้นกว้างเกินไป. จึงลด rail จาก 190px เป็น 128px (ประมาณ 33%) และลด padding/thumbnail ของการ์ด. ไม่ลดขนาดจุดบนแผนผังเพื่อชดเชยพื้นที่ rail.

Prototype ที่ใช้อ้างอิง: `src/components/storageLayouts/_prototype/index.html`, เปิด `http://127.0.0.1:3188/?variant=B`. B เป็นค่าเริ่มต้น; A/C เก็บไว้เปรียบเทียบ. ข้อมูลทั้งหมดเป็นตัวอย่าง. หน้า production ใช้ React components และข้อมูลจริงแล้ว; prototype เก็บเป็น design reference และไม่มี variants/switcher ในหน้าจริง.

## Desktop และ tablet

| ความกว้าง viewport ใน prototype | รูปแบบ                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| มากกว่า 1150px                  | Rail 128px, การ์ดประมาณ 107px รวมกรอบ, thumbnail สูง 45px, inspector ลอยด้านขวา 260px, รายการด้านล่าง |
| 851–1150px                      | Rail 112px, inspector 235px; ให้พื้นที่จุดจัดเก็บจริงไม่ถูก inspector บัง                             |
| 581–850px                       | แถบชั้นแนวนอนเหนือ toolbar; inspector อยู่ใต้แผนผัง; รายการด้านล่าง                                   |
| ไม่เกิน 580px                   | Mobile map/list และ bottom sheet ตามรายละเอียดถัดไป                                                   |

- Header แยกข้อมูลอาคารและสถานะออกจากงานของชั้น. “ภาพรวมอาคาร” เปิดมุมมองอาคารเดิม; “จัดการอาคาร” ใช้ settings/status flow เดิม.
- Rail มีชื่อชั้น, พื้นที่ใช้ได้, thumbnail ขนาดเล็ก, จำนวนจุดจัดเก็บ และความสูงชั้น. Production ต้องแสดงทุกชั้นจากข้อมูลจริงและเลื่อนใน rail ได้เมื่อมีหลายชั้น. การ์ดเป็นปุ่มที่มี `aria-pressed`.
- ปุ่ม “แก้ไขผัง” ใช้กับชั้นที่เลือก. คงไว้ใกล้ตัวเลือกชั้นและแสดงตามสิทธิ์.
- Toolbar แยก 2D/3D, zoom, fit และตัวเลือกแสดงผล. Fit คงการเลือกจุดเดิม.
- Inspector มีรหัส, ชื่อ, ชั้น, สถานะ, ขนาด, ความสูง, พื้นที่ และสินค้าที่จัดเก็บ. แก้ไข/QR/เก็บถาวรใช้ flow จริงเดิม.
- Floating inspector อยู่ในตำแหน่งที่จองพื้นที่ไว้ให้ชัดเจน. คำนวณพื้นที่ fit ของแผนผังหลังหักพื้นที่ inspector และ legend; ไม่ใช้ margin อย่างเดียวจนเกิดการบังจุดจริงบนผังอื่น.
- ใช้ชื่อและรหัสอาคารจริงทุกตำแหน่ง รวมชื่อยาว; prototype FG1 เป็นเพียงตัวอย่าง.

## Mobile design

ลำดับหน้าจอ: breadcrumb/workspace → ชื่ออาคาร/สถานะ/ข้อมูลย่อ → แท็บแผนผังและรายการ → ชั้นที่เลือก/แก้ไขผัง → toolbar → แผนผัง → สรุปจุดที่เลือก.

### แผนผัง

- ซ่อน sidebar ภายในพื้นที่หน้าจอแคบ โดยใช้ shell mobile/navigation ของแอปเดิมตอน implement.
- Header ย่อ action ภาพรวม/จัดการอาคารเป็น icon button พร้อม accessible name และ tooltip ตามระบบเดิม.
- แท็บ **แผนผัง / รายการ** กินความกว้างเท่ากัน; แสดงจำนวนจุดในแท็บรายการ. สลับแท็บแล้วคงชั้น, selection, search/filter และ zoom ของชั้นเดิม.
- ตัวเลือกชั้นเป็นแถบแนวนอน. อาคารหลายชั้นใช้ปุ่มชั้นที่เลื่อนได้และเลื่อนชั้นที่เลือกให้เห็น; ปุ่มแก้ไขผังอยู่ด้านขวาและไม่เลื่อนหายไปกับชั้น.
- Toolbar ใช้ icon สำหรับ fit/แสดงผล. ปุ่มต้องมีชื่อที่ screen reader อ่านได้. ภาพรวมยังเลือก 2D/3D ได้.
- แผนผังไม่มี inspector ซ้อนทับ. สรุปจุดอยู่ใต้ผัง มีรหัส, ชื่อ, สถานะ/จำนวนพาเลท และปุ่มรายละเอียด.
- ขนาดช่องเล็กขึ้นอยู่กับ geometry จริง. เพิ่ม zoom/pan ตาม renderer เดิม และให้รายการเป็นทางเลือกที่แตะได้ง่าย; ไม่ขยาย hit area ซ้อนกันจนเลือกช่องผิด. ปุ่มและรายการ production มี touch target อย่างน้อย 44px.

### รายละเอียดจากด้านล่าง

- การแตะจุดบนแผนผังหรือรายการเปิด bottom sheet ทันที. หน้าเริ่มต้นหรือการคืน selection จาก URL แสดงเพียงสรุป ไม่เปิด sheet เอง.
- Sheet แสดงรายละเอียดชุดเดียวกับ desktop, มีปุ่มปิด, scroll ภายใน และปุ่มแก้ไขด้านล่าง. Prototype จำกัดความสูง 76dvh; production ใช้ `SheetContent side="bottom"` และ safe-area inset.
- ปิดด้วยปุ่ม, backdrop หรือ Escape แล้วคง selection/zoom. คืน focus ให้จุดหรือแถวที่เปิด sheet; หากจุดนั้นหายไป คืนให้ตัวเลือกชั้นหรือแท็บ.
- Sheet อ่านข้อมูลอย่างเดียวไม่ทำให้ floor draft กลายเป็น dirty. การแก้ไขเปิด editor เดิมหลังปิด sheet เพื่อไม่ซ้อน modal; cancel กลับสู่ selection เดิม.
- การเปลี่ยนชั้นที่ได้รับอนุญาตจาก navigation guard ปิด sheet และใช้ selection scope ของชั้นใหม่. การเปลี่ยน breakpoint ต้องไม่ทิ้ง backdrop/focus lock ไว้บน desktop.

### รายการ

- ใช้แถวแบบ compact สองคอลัมน์: รหัสและขนาดด้านซ้าย, สถานะและจำนวนพาเลทด้านขวา. ไม่มี horizontal scroll.
- คง search, filter, sort, pagination และ action เพิ่มจุดจาก component จริง. เพิ่มจุดตามชั้นที่เลือกและสิทธิ์เดิม.
- แตะแถวเปิด sheet โดยใช้ selected ID เดียวกับแผนผัง. กลับแท็บแผนผังแล้ว highlight จุดเดิม.
- Filter ที่ตัดจุดที่เลือกออกใช้ policy เดิมของ `FloorLocationTable`; ปิด sheet และแสดงสถานะยังไม่ได้เลือกอย่างสอดคล้องกัน.

## จุดเชื่อมกับโค้ดปัจจุบัน

ตรวจจาก working tree วันที่ข้างต้น ซึ่งมีงานอื่นแก้ `FloorMap`, `FloorLocationTable`, translations และ backend อยู่แล้ว. Re-read ก่อน implement และเก็บงานเหล่านั้นไว้.

| ไฟล์ / module                                                                            | งาน                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/storageLayouts/StorageLayoutScreens.tsx` — `BuildingModelWorkspace`        | เปลี่ยน floor grid ด้านบนเป็น rail/horizontal selector, จัด header และ canvas workspace; คง query `floor`, `view`, `editing`, `editZone` และ transition guard |
| ไฟล์เดียวกัน — `FloorForm` / `FloorPlan`                                                 | ส่งเนื้อหารายละเอียดและ action เข้า workspace, คง saved/draft geometry, dirty state, impact review, pending และ editor handle                                 |
| `src/components/storageLayouts/FloorMap.tsx`                                             | แยกการจัด layout ออกจาก `MapDrawing`, วาง floating inspector โดยจองพื้นที่, เพิ่ม mobile tabs/summary/sheet, ใช้ selection/controller เดิม                    |
| `src/components/storageLayouts/FloorLocationTable.tsx`                                   | ใช้ table บน desktop และ compact rows บน mobile; คง search/filter/sort/pagination และ selected-row reveal                                                     |
| `src/features/storageLayouts/StorageZonesPanel.tsx`                                      | ใช้รายละเอียด/แก้ไขเดิมผ่าน `locationInspector` และ `locationActions`; หากต้องแยก content ให้มีแหล่งเดียวที่ desktop และ sheet ใช้ร่วมกัน                     |
| `src/features/storageLayouts/useFloorSelection.ts`                                       | คง floor-scoped selected ID; ไม่สร้าง selection ใหม่แยกกันสำหรับ map/list/sheet                                                                               |
| `src/features/storageLayouts/useWorkspaceNavigationGuard.tsx`                            | คง prompt เมื่อมี floor draft/editor ที่ยังไม่บันทึก รวม pending-save protections                                                                             |
| `src/components/ui/sheet.tsx` / `dialog.tsx`                                             | ใช้ primitive เดิมสำหรับ focus trap, Escape, backdrop และ focus return; ไม่เพิ่ม dependency สำหรับ sheet                                                      |
| `messages/th.json`, `messages/en.json` และ `src/i18n/messages.ts`                        | เพิ่ม labels ของ map/list/detail/close ตาม convention เดิม ใช้ Thai/English ครบ                                                                               |
| `src/components/storageScene/*`, `StorageZoneVisualizer.tsx`, `floorPositionGeometry.ts` | ใช้ renderer, palette และ geometry เดิม; คง reserved colors, imported positions, grouped PD locations และข้อมูล inventory ที่ไม่วัดพิกัด                      |

`FloorMap` ปัจจุบันมี toolbar, drawing, inspector และ table อยู่ด้วยกัน; มี controlled selection และช่อง `locationInspector`/`locationActions` แล้ว. ปรับ seam ที่มีอยู่ก่อนเพิ่ม controller ใหม่. `BuildingModelWorkspace` มี navigation guard และเรียก `FloorForm` ด้วย key ตามชั้น; อย่าย้าย form หรือ mount ซ้ำจนการบันทึกทำงานสองครั้ง.

## ลำดับ implementation

### 1. จัด workspace และตัวเลือกชั้น

- [x] อ่าน AGENTS.md และ installed Next.js guides ที่เกี่ยวกับ client components/CSS/routing.
- [x] สร้าง floor selector แบบ rail/horizontal ด้วยข้อมูล `floors` จริง; ส่งการเลือกผ่าน `transition()` เดิม.
- [x] จัด header, overview/settings/status action และปุ่มแก้ไขผังให้ตรง B.
- [x] แสดง rail เฉพาะ storage view; overview อาคารใช้ isometric building เดิม.
- [x] ตรวจหลายชั้น, อาคารไม่มีชั้น, archived และ viewer permissions.

จุดจบ: โครง B ใช้ข้อมูลจริงและเปลี่ยนชั้นได้ โดย draft guard ยังทำงาน.

### 2. จัดแผนผังและรายละเอียด desktop

- [x] แยก presentation ของ location detail ที่จำเป็นจาก existing inspector; reuse เนื้อหาและ action เดิม.
- [x] จัด canvas/toolbar/detail ด้วย layout mode ใน `FloorMap`; ไม่เปลี่ยน calculation ใน `MapDrawing`.
- [ ] Fit/zoom/rotation คำนึงถึงพื้นที่ inspector; ทดสอบผังสูง, กว้าง, ไม่เป็นสี่เหลี่ยม และ imported layouts.
- [x] ใช้ area/occupancy/count จาก selector จริง; ไม่คัดลอกตัวเลขหรือ status จาก prototype.
- [x] คง QR, unit selection, imported notes และการเปิด editor ผ่าน `editZone`.

จุดจบ: desktop B มีข้อมูลครบเท่าหน้าปัจจุบันและเลือกจาก map/table ได้สอดคล้องกัน.

### 3. เพิ่ม mobile map/list และ sheet

- [x] เพิ่ม mobile view state แยกจาก 2D/3D และ query `view=storage|building`.
- [x] รักษา state ของ table เมื่อสลับ map/list; ไม่ unmount table จน filter/pagination หาย. State ที่ต้องแชร์อยู่เหนือ responsive panels.
- [x] เพิ่ม selection summary และ `Sheet` แบบ controlled; เปิดจาก user selection โดยตรง.
- [x] ขณะเปิด sheet ให้ desktop inspector ไม่มี controls ที่ซ้ำใน accessibility tree; reuse เนื้อหาโดยรักษา unique IDs.
- [ ] Close/edit/floor-switch/breakpoint-change คืน focus และปลด modal lock ถูกต้อง.
- [ ] จัด compact rows, safe-area, keyboard-visible forms และ touch target.

จุดจบ: mobile ใช้งานต่อเนื่องจากการเลือกชั้นถึงดู/แก้ไขจุดได้ โดย selection ไม่หลุด.

### 4. ตรวจ regression และเก็บหลักฐาน

- [x] เพิ่ม/ปรับ behavioral tests ที่ `StorageLayoutScreens.test.tsx`, `useFloorSelection.test.ts`, `useWorkspaceNavigationGuard.test.tsx`, `FloorMap.labels.test.tsx`, `FloorLocationTable.test.tsx` และ a11y tests ที่เกี่ยวข้อง.
- [x] ทดสอบเลือกจุดจาก map/list, สลับแท็บ, ปิด sheet, focus return และเปิด editor หนเดียว; ทดสอบเปลี่ยนชั้นขณะ dirty/pending.
- [ ] ทดสอบข้อมูลหลายชั้น, empty, archived, viewer/manager, มีสินค้า, ไม่มีพิกัด, grouped/imported positions และจุดหายระหว่าง refresh.
- [ ] Browser QA ที่ 360/390/428, 768, 1024, 1280, 1440px; Thai/English และ light/dark. ตรวจไม่มี overflow และจุดจริงไม่ถูก inspector บัง.
- [x] รัน relevant tests, typecheck, lint และ build ตามผลของการแก้ไข. เพิ่ม backend tests เฉพาะเมื่อมีการเปลี่ยน contract จริง.
- [ ] เก็บ desktop/mobile map/list/sheet screenshots จากแอปจริงและอัปเดตเอกสารด้วยผลตรวจ.

จุดจบ: B ผ่าน regression และมีหลักฐานจากข้อมูลจริงก่อนนำไปใช้.

## Acceptance criteria

- Rail/card แคบลงตาม feedback แต่ชื่อชั้น, พื้นที่, จำนวนจุดและ action ยังอ่านและใช้งานได้.
- Desktop แผนผังเป็นพื้นที่หลัก; floating detail ไม่บังจุดที่ต้องเลือก.
- Mobile เลือกชั้นได้, มี map/list, ไม่มี horizontal overflow และไม่มี detail card ซ้อนทับผัง.
- Map/table/sheet ใช้ selected ID เดียวกัน; close sheet คง selection และคืน focus.
- แก้ไขผัง, แก้ไขจุด, เพิ่มจุดและจัดการอาคารใช้ flow และสิทธิ์เดิม; occupancy/version/dirty/pending safeguards ยังทำงาน.
- ข้อมูลที่ prototype ไม่มี เช่น QR, grouped locations และสินค้าที่ไม่มีพิกัด ยังแสดงได้ใน production.
- Theme tokens และ translations ของแอปเป็นแหล่งเดียว; สีเข้ม/เขียวจาก prototype ไม่ถูก hardcode ไปทับระบบ theme.

## ขอบเขตและข้อจำกัด

นี่เป็น presentation change ที่วางแผนไว้ให้ reuse backend contract ปัจจุบัน. ไม่ต้องเปลี่ยน schema เพื่อจัด rail หรือ mobile sheet. 3D ใน prototype เป็นภาพเอียงประกอบ design; production ต้องใช้ renderer จริงเดิม. Prototype มีชั้นเดียวเพื่อให้เทียบ feedback ได้ จึงต้องตรวจหลายชั้นด้วยข้อมูลจริงตอน implement.

Prototype เป็นหลักฐาน design ที่แก้ได้และ reset เมื่อ reload. เมื่อ production ผ่านตรวจแล้ว ให้เก็บ prototype ไว้บน branch สำหรับ design reference พร้อม pointer จาก implementation issue/PR และเอา variants/switcher ออกจาก production; ไม่ copy HTML prototype เป็น implementation ตรง ๆ.

## ภาพ design และผลตรวจ prototype

- [Desktop B](../../src/components/storageLayouts/_prototype/assets/b-desktop.png)
- [Mobile — แผนผัง](../../src/components/storageLayouts/_prototype/assets/b-mobile-map.png)
- [Mobile — รายการ](../../src/components/storageLayouts/_prototype/assets/b-mobile-list.png)
- [Mobile — รายละเอียดจากด้านล่าง](../../src/components/storageLayouts/_prototype/assets/b-mobile-detail.png)

ตรวจ prototype ใน Chromium วันที่ 2026-09-30:

- ไม่มี horizontal overflow ที่ 360, 390, 428, 580, 581, 768, 850, 851, 1024, 1150, 1280 และ 1440px; floating inspector ไม่ทับ bounding box ของจุดตัวอย่าง.
- Desktop rail วัดได้ 128px, card 107px; ช่วง 851–1150px rail 112px.
- Mobile 390 × 844px เห็นสรุปจุดที่เลือกภายใน viewport; comparison bar ไม่บังผัง. ตัวเลือกชั้นยังแสดงเมื่อสลับมารายการ.
- เลือกจาก map/list เปิด sheet ถูกจุด; Escape ปิดและคืน focus; sheet ไม่ intercept arrow keys เพื่อสลับ variant.
- เปิด edit จาก sheet มี modal เดียว, บันทึกตัวอย่างแล้วคง selection, search ทำงาน, labels/fit/zoom/2D/3D และ variant URL ทำงาน.
- ขยาย viewport เป็น desktop ปิด sheet และคง selection; occupied archive ยังคงถูกบล็อก.
- ไม่พบ JavaScript page errors ใน flow ที่ตรวจ; Prettier ผ่านสำหรับไฟล์ที่แก้.

ผลนี้เป็นการตรวจ standalone prototype. Production regression, real-data multi-floor QA, Thai/English และ light/dark ยังต้องทำตาม checklist ก่อนหน้า.

## ผล implementation และ verification — 2026-09-30

### สิ่งที่นำไปใช้กับหน้าจริง

- `BuildingModelWorkspace` ส่งตัวเลือกชั้นจริงเข้า `FloorMap`: rail 128px (>1150px), 112px (851–1150px), horizontal selector (≤850px). รายการชั้นเลื่อนได้และ reveal ชั้นที่เลือก; ทุกปุ่มเปลี่ยนชั้น/มุมมอง/แก้ไขผังยังผ่าน `transition()` และ navigation guard เดิม.
- Canvas และ inspector เป็น grid คนละพื้นที่ (260px/235px ตาม breakpoint). Renderer fit อยู่ใน SVG ของ canvas ซึ่งไม่รวมความกว้าง inspector จึงไม่มีจุดถูก inspector ทับ. Tablet วาง inspector ใต้ผัง; รายละเอียด scroll ภายในไม่ดันรายการลงหลายหน้าจอเมื่อมีสินค้ามาก.
- Mobile ≤580px มี map/list tabs, floor selector ทั้งสองแท็บ, compact rows, sort/filter/search/pagination และ selection summary. Map/table อยู่ mounted เมื่อเปลี่ยนแท็บเพื่อรักษา search/filter/page/zoom.
- `LocationDetailsHost` ย้ายเฉพาะ presentation ของ `StorageZonesPanel` ด้วย portal ระหว่าง inspector กับ controlled bottom `Sheet`. Panel/editor คง mounted ชุดเดียว. Sheet เปิดเฉพาะการเลือกโดยผู้ใช้; URL selection แสดงสรุป. Edit รอ `onCloseAutoFocus` ของ sheet แล้วเปิด editor ผ่าน `editZone`; cancel คง selection.
- ปิด sheet ด้วย Escape/close แล้วคืน focus; เปลี่ยนชั้น/ขยายเป็น desktop/จุดที่เลือกหาย ปิด sheet และปลด modal lock. Sheet ใช้ `85dvh`, internal scroll, safe-area padding และปุ่มแก้ไขด้านล่าง. แท็บรองรับ arrow/Home/End และ touch targets ≥44px.
- ข้อมูล QR, imported note, grouped position detail, unmeasured inventory, unit selection, archive action และ protections เดิมยังใช้ source เดิม. เพิ่ม labels ไทย/อังกฤษ และปรับ count formatting ของ labels ผังให้ผ่าน ICU convention ของ repo.
- ไม่มี schema migration/backend contract change จากงาน layout นี้. Working tree ที่มีอยู่ก่อนหน้าเก็บไว้; prototype อยู่เป็น reference.

### ผล checks

- `pnpm typecheck` — ผ่าน.
- `pnpm lint` — ผ่าน.
- `pnpm test` — **115 files / 965 tests ผ่าน** (รวม unit, a11y, property, integration และ isolation).
- `pnpm build` — ผ่าน optimized production build และ generate 29 pages.
- `git diff --check` — ผ่าน.
- เพิ่ม mobile behavioral tests 5 cases ใน `StorageLayoutScreens.test.tsx`: map + Escape/focus/zoom, list/search/tab selection, sheet→single editor→cancel, URL selection/floor scope และ refresh/removal/desktop breakpoint cleanup. Tests เดิมยังตรวจ dirty/pending/version/occupancy, permissions, grouped/imported geometry และ unmeasured inventory.
- Regression assertions ของ label tests ปรับตาม working tree เดิมที่ซ่อน detailed labels เป็นค่าเริ่มต้นและแสดงหมายเลขสั้นใน imported cells; ไม่เปลี่ยน geometry หรือ preference เดิม.

### Browser QA ที่ตรวจได้ และข้อจำกัด

ตรวจหน้าจริงที่เชื่อม **local Convex / DEMO-ANNEX** (2 ชั้น, 6 จุดในชั้น 1, inventory ที่มีตำแหน่งจริง) ผ่าน T3 collaborative preview. Viewport จริงที่เครื่องมือรายงานคือ **1169 × 731 CSS px** แม้ setting ระบุ 1280 × 800:

- ภาษาไทย/อังกฤษใน dark theme และภาษาอังกฤษใน light theme: ไม่มี document horizontal overflow; rail 128px และ inspector 260px.
- เลือกจากแผนผังแล้ว map/table/inspector แสดงจุดเดียวกัน. Map right edge 856px และ inspector left edge 868px มีช่องว่าง 12px; ไม่ overlap.
- Inspector ของจุดที่มี 16 พาเลท scroll ภายใน (สูงประมาณ 512px) แสดง inventory/QR/ตำแหน่งและ action เดิม.
- เปิดแก้ไขผ่าน `editZone` ได้ editor เดียว; cancel ล้าง `editZone`, คง map/table selection และไม่เหลือ modal/pointer lock หลัง animation จบ. การตรวจนี้ไม่ได้บันทึกหรือแก้ไขข้อมูล backend.

**ยังไม่ยืนยัน browser matrix 360/390/428/768/1024/1280/1440px ทุกภาษา/theme, mobile keyboard/safe area และ screenshots จากแอปจริง.** `preview_resize` ทั้ง freeform/preset timeout และคง viewport เดิม; `preview_snapshot`/save ล้มเหลวต่อเนื่องหลังภาพที่ตรวจได้ช่วงแรก. ทดลอง iframe เพื่อสร้าง viewport ภายในถูก `X-Frame-Options: DENY`/`frame-ancestors 'none'` ของแอปบล็อก จึงไม่ใช้วิธีนั้นต่อและไม่ปรับ security headers.

รายการเหล่านี้ยังเป็น release verification ที่ต้องตรวจต่อด้วย browser preview ที่ resize/capture ทำงานได้. ผล unit tests ของ breakpoint/modal cleanup ไม่แทนการตรวจ responsive geometry และคีย์บอร์ดใน browser จริง. **ยังไม่ได้ deploy production.**

### Local UI review profile และ screenshots — เพิ่มเติม 2026-09-30

- เปิด `pnpm dev` (Next.js :3100 + local Convex :3320) และ `pnpm dev:login`; ตรวจหน้าจริงด้วยบัญชี local demo ที่ login แล้ว.
- เพิ่ม optional `ALLOW_LOCAL_TEST_SEED=true pnpm dev:seed --storage-ui`. Seed ใช้ backend/schema เดิมและเพิ่ม fixture ตาม code แบบ idempotent; ไม่แทนที่ข้อมูลอาคารเดิม. รันซ้ำผ่าน และ ID อาคารคงเดิม.
- `UI-B-DEMO`: 4 ชั้น, 34 locations, 15 grouped positions, 10 pallets (4 stored, 4 reserved, 2 location-only/unmeasured), reserved-area colors, imported notes, QR, ชื่อยาว และ pagination 30 จุดบนชั้น 1. ชั้น 3 ว่าง; ชั้น 4 มี footprint เล็กกว่า.
- เพิ่ม `UI-B-NO-FLOORS` และ `UI-B-ARCHIVED`; เปิดหน้าจริงแล้ว empty state แสดงได้, archived ไม่มีปุ่มแก้ไขชั้น/อาคาร และไม่มี document horizontal overflow ที่ viewport จริง 1169 × 731 CSS px.
- เลือกจุดบนผังชั้น 1 แล้ว inspector/table แสดง stored/reserved/unmeasured counts; เปลี่ยนชั้น 2 และเลือก grouped location แล้วแสดง import note, 15 positions และ QR 16 รายการได้.
- `preview_snapshot`/save กลับมาทำงานและเก็บภาพจากแอปจริงแล้ว: [Desktop overview](../../output/storage-layout-b-ui/desktop-overview.png), [Map + inspector](../../output/storage-layout-b-ui/desktop-map-details.png), [Grouped/imported location](../../output/storage-layout-b-ui/desktop-grouped.png). ภาพเป็น local fixtures บน renderer จริง.
- Typecheck, ESLint สำหรับ seed/script, formatting และ `git diff --check` ผ่าน. ไม่มี backend contract หรือ schema migration เพิ่มจาก fixture นี้.
- Mobile screenshots และ browser breakpoint matrix ยังไม่ยืนยัน: `preview_resize` ยังคง timeout และไม่ได้เปลี่ยน viewport. ข้อจำกัด capture ในบันทึกก่อนหน้าคลี่คลายเฉพาะ desktop screenshots; ยังไม่ถือว่าผ่าน full release QA.

### Canvas design และลดปุ่มซ้ำ — 2026-10-01

ปรับตามภาพ reference หลังผู้ใช้ตรวจหน้าจริงแล้วพบว่ารอบแรกยังต่างจาก design:

- Workspace, rail, toolbar, canvas และ inspector ใช้ palette ของผังจาก `FloorMap.module.css` มี semantic tokens สำหรับ light/dark. Dark canvas เป็นพื้นสีเขียวเข้มลายจุด; ไม่ใช้การ์ด canvas สีเทาและเส้น grid ตารางเดิมใน 2D.
- 2D เป็นค่าเริ่มต้น. จุดทั่วไปแสดงรหัสภายใน shape พร้อมจำนวนหน่วยเมื่อพื้นที่พอ, สี empty/occupied และ selected lime. สัดส่วนมาจาก millimetres จริง; viewBox fit ตาม extents รวม reference floor. 3D และ geometry/placement selection เดิมยังใช้งานได้; ดู footprints บน 2D ผ่านตัวเลือกการแสดงผล.
- แสดง dimension ด้านบน/ซ้าย, reserved hatch ตามสีข้อมูลจริง, ทางเดินจาก reserved block จริง และ scale bar ที่คำนวณจาก geometry/zoom. ไม่มีการยืด geometry เพื่อเลียนแบบสัดส่วนของ prototype.
- Inspector ใช้รหัสจุดเป็นหัวเรื่อง ตามด้วยชื่อ/ชั้น, status, metrics 2 × 2, product summary และปุ่มแก้ไขเดียว. QR, รายการพาเลท, import note, location-only inventory และ action เก็บถาวรยังอยู่ใน disclosure เดิม/ส่วนจัดการ.
- ปุ่มหลักบนผังเหลือ 6 controls: 2D, 3D, zoom out, zoom in, fit และ display options. ตัวเลือก labels/footprints/rotate/base floor อยู่ในเมนูเดียวพร้อมชื่อ. เอาปุ่ม “จุดที่เลือก” ที่ซ้ำกับ inspector ออกจาก table toolbar; table/grid อยู่ในแผง filter. ปุ่มตั้งค่าอาคารใช้ Settings icon แทน `+` ที่ซ้ำกับเพิ่มจุด.
- เพิ่ม local `UI-B-REFERENCE`: ชั้น 12.26 × 29.93 m, 15 locations (ซ้าย 5/ขวา 10), 24 stored pallets, reserved blocks และ aisle. ใช้ backend/schema/editor จริง. Seed ซ้ำรักษา IDs และไม่เขียนทับ dimensions ของ fixture ที่มีอยู่.
- เก็บภาพจากแอปจริงหลังเทียบและปรับ: [Canvas dark](../../output/storage-layout-b-ui/canvas-desktop-dark.png), [Canvas light](../../output/storage-layout-b-ui/canvas-desktop-light.png). ตรวจ Thai/dark และ English/light ที่ viewport จริง 1169 × 731 CSS px: ไม่มี document overflow, map right 850px / inspector left 866px, inspector 260px. เมนู display ปิดด้วย Escape และคืน focus ให้ trigger ได้.
- Typecheck, lint, formatting, diff checks และ production build ผ่าน. Full suite **115 files / 966 tests ผ่าน**; relevant tests หลัง polish รอบสุดท้าย **79 tests ผ่าน**. เพิ่ม behavioral test ของ disclosure/footprints และปรับ interaction tests ให้เปิด 3D/เมนูอย่างชัดเจน.
- `preview_snapshot` มี capture ที่ล้มเหลวหรือภาพ compositor ไม่ครบเป็นช่วง ๆ; ภาพ evidence ด้านบนตรวจแล้วว่ามีผังและรายละเอียดครบ. `preview_resize` แบบ iPhone preset ยัง timeout; mobile/tablet browser matrix และ screenshots ยังค้างตาม release checklist. ยังไม่ได้ deploy production.

### ปรับ tone และตรวจ contrast — 2026-10-01

- Research จาก W3C WCAG 2.2 และวัดคู่สีเดิม พบข้อความรองบน occupied ต่ำกว่า 4.5:1 และขอบช่องใน light ต่ำกว่า 3:1. ดู [research และตาราง contrast](storage-layout-color-contrast-research.md).
- ใช้ neutral slate สำหรับ canvas/ช่องว่าง, teal สำหรับ occupied และ lime สำหรับ selected ทั้ง light/dark. แยก link text, primary fill/hover และ selected border; ปุ่มและ focus จึงใช้สีตามบริบท. เมนู display ที่ render ผ่าน portal และ mobile sheet ใช้ theme tokens ชุดเดียวกับ workspace.
- ข้อความรองบน occupied: **6.72:1 light / 5.83:1 dark**, selected text **12.52:1**, empty boundary เทียบกับ floor **3.86:1 / 6.18:1**. คง labels/counts, selection stroke และ reserved hatch เพื่อสื่อสถานะร่วมกับสี. สี reserved/imported ที่ผู้ใช้บันทึกยังคงเดิม; aisle text ใช้สีข้อความ semantic เพื่ออ่านชัด.
- ตรวจ computed SVG styles จากแอปจริงทั้ง light/dark ยืนยัน fill/stroke/text ตรง palette, selection และ inspector ยังตรงกัน และไม่มี horizontal overflow ที่ viewport 1169 × 731 CSS px. ภาพจริง: [Dark](../../output/storage-layout-b-ui/contrast-desktop-dark.png), [Light](../../output/storage-layout-b-ui/contrast-desktop-light.png).
- Typecheck, lint, production build, relevant **79 tests** และ a11y **20 tests** ผ่าน. ผล contrast นี้ครอบคลุมคู่สี semantic ที่รายงาน ไม่ใช่การรับรอง WCAG ทั้งแอป. Mobile/tablet browser matrix ที่ค้างก่อนหน้ายังต้องตรวจตาม release checklist.
