# แผนพอร์ตการลากซ้อนพาเลทอัตโนมัติ

สถานะ: พอร์ตและตรวจใช้งานจริงแล้ว — รายละเอียดและขอบเขตการทดสอบอยู่ที่ `artifacts/automatic-stacking-2026-09-06/results.md`

ต้นทาง: `/Users/macbook/Development/industrial-sas-pallet-stacking` (`codex/pallet-stacking`, port 3102)
ปลายทาง: `/Users/macbook/Development/industrial-sas-storage-planner` (`codex/storage-planner`, port 3100)

## ขอบเขตที่ตกลง

พอร์ตการลากขึ้น–ลงฐานอัตโนมัติทั้งหน้าจัดเก็บใหม่และหน้าย้าย ใช้การควบคุม 2D/3D เดิม เอา select Z และช่องกรอก Z ที่ปิดใช้งานออก แสดง Z และชื่อฐานเป็นข้อมูลที่ระบบคำนวณ

**ยังไม่พอร์ตกฎน้ำหนัก/รับน้ำหนัก** ตามข้อกำหนดก่อนหน้า แม้ต้นทางจะมีกรณีน้ำหนักเกินเป็นสีแดง รอบนี้จะใช้เหตุผลจากขนาด ความสูง การทับซ้อน การอนุญาตให้ซ้อน จำนวนชั้น และการล็อกฐานเท่านั้น น้ำหนักที่เป็นข้อมูลการวัดเดิมไม่เปลี่ยน

คงระบบ FG, preparation batch, การแบ่ง 4 → 2, การตัด retired units, การซ้อนเฉพาะ PALLET และ workflow ตรวจรหัส/จอง/ย้าย/คืนต้นทางที่พอร์ตเสร็จแล้ว ไม่ merge ทั้ง branch หรือเขียนทับ workflow.ts ทั้งไฟล์

## พฤติกรรมหน้าจอ

| การกระทำ | ภาพและระดับ Z | การยืนยัน |
| --- | --- | --- |
| เลือกจุดจัดเก็บหรือระดับชั้นวางจากการ์ดเดิม | ใช้พื้น/ชั้นวางนั้นเป็นฐานอ้างอิง | ยังไม่จอง |
| ลาก footprint ทับพาเลทรองรับ แม้ทับเพียงบางส่วน | ยกขึ้นบนฐานที่ทับและสูงที่สุด ภายในพื้น/ชั้นวางเดียวกัน | ตรวจเงื่อนไขแยกจากการเลือกระดับ |
| ฐานรองรับได้ครบและข้อกำหนดผ่าน | สีผ่านการตรวจสอบ พร้อมชื่อฐานและ Z | เปิดปุ่มตรวจสอบ/จอง |
| วางเหลื่อม ฐานเล็ก เพดานต่ำ ชนพาเลทอื่น ฐานไม่อนุญาตซ้อน เกินจำนวนชั้น หรือฐานถูกล็อก | อยู่ระดับบนฐาน เป็นสีแดง พร้อมเหตุผล ไม่ปรับ X/Y ให้ดูเหมือนวางได้เอง | ปิดทั้ง Use this position, Confirm/Review และ Reserve |
| ลากออกจากฐานจนไม่ทับกัน | กลับลงพื้นหรือชั้นวางอ้างอิง ตรวจการชนใหม่ | เปิดได้เฉพาะเมื่อวางได้จริง |
| แตะเฉพาะขอบ โดยไม่มีพื้นที่ทับกัน | ไม่ยกขึ้น | ตรวจตำแหน่งบนฐานอ้างอิงตามปกติ |
| หมุน 90°, ใช้ปุ่มลูกศร หรือแก้ X/Y | คำนวณฐานใหม่เหมือนลากเมาส์ | ใช้เงื่อนไขชุดเดียวกัน |
| จองสำเร็จ | ใช้ Z ที่ backend คำนวณ และล็อกฐาน | ตรวจรหัสพาเลทและยืนยันการวางจริงตาม flow เดิม |

การลากเปลี่ยนเฉพาะภาพตัวอย่าง ไม่มีการย้ายสินค้า เปลี่ยนจำนวน หรือสร้าง reservation จนกดจอง กล้องและการลากต้องไม่กระตุกหรือเริ่มใหม่เมื่อฐานเปลี่ยน

## สิ่งที่ตรวจพบในต้นทาง

- `palletGeometry.ts`: เพิ่ม `PlacementSurface`, `resolvePalletSupport()`; ใช้ positive overlap และเลือกฐานสูงที่สุด มี tie-break ที่แน่นอน และผูกฐานกับ `baseSupportPositionId` เพิ่มผลตรวจ `support` สำหรับวางเหลื่อม/ฐานเล็ก
- `PalletScene.tsx`: รับ `automaticSupports`, `baseSupport`, `issueMessage`; คำนวณระดับขณะเคลื่อนที่และคงกรอบกล้อง ปรับการ clamp ให้ไม่ติดฐานเก่า
- `PalletScreens.tsx`: `PlacementEditor` เก็บ requested X/Y/rotation แยกจาก resolved support คำนวณ candidate ใหม่โดยล้าง support ID เก่าก่อนใส่ฐานปัจจุบัน ส่งเฉพาะ support identity และ X/Y/rotation ไปจอง; เอา Z selector ออก
- `workflow.ts`: เพิ่ม metadata ฐานต้นทางและ `previewSupports` ที่รวมฐานถูกปฏิเสธพร้อม `blockedReason`; รายการจองได้ยังต้องผ่าน validation
- `MoveScreen.tsx`: ใช้ editor ร่วมกัน จึงต้องรักษา source-placement ID, move ID และการล็อกต้นทางของระบบปัจจุบัน
- ไม่มี schema migration ที่จำเป็นสำหรับพฤติกรรมนี้

ตรวจ source tests ล่าสุดแล้ว: **92 tests ผ่านใน 5 files** (geometry, scene, storage editor, move editor, stacking integration) ผลนี้ยืนยันเฉพาะต้นทาง ยังไม่ใช่ผลหลังพอร์ต รวมกรณีน้ำหนักของต้นทางด้วยซึ่งจะไม่พอร์ตตามมา

ฐานปลายทางก่อนงานรอบนี้: พอร์ตเดิมผ่าน 493 tests, typecheck, lint และ production build ต้องรัน baseline ใหม่ก่อนเริ่มแก้ เพราะทั้งสอง worktree ยังมี uncommitted files

## ขั้นตอน implementation และเกณฑ์ผ่านแต่ละช่วง

### 1. ล็อกชุดไฟล์ที่จะพอร์ตและทดสอบ baseline

- ใช้ snapshot/hash ที่บันทึกไว้เป็นจุดเปรียบเทียบ รวบรวมทั้ง tracked และ untracked files อีกครั้งก่อนเริ่ม
- สรุป delta รายไฟล์และแยก code ของ automatic dragging ออกจาก batch/weight/port changes
- รัน `pnpm check` ในปลายทาง เก็บผลก่อนแก้ หากมีความผิดพลาดที่เกิดก่อนพอร์ตให้ระบุแยก
- ผ่านเมื่อระบุฐาน source/destination ได้แน่นอนและ baseline ผ่าน

### 2. พอร์ตข้อมูลฐานสำหรับ preview

- เพิ่ม `PreviewSupport`, `baseSupportPositionId`, `previewSupports` แบบ additive ใน workflow ปัจจุบัน
- แยกข้อมูลที่ใช้วาดออกจาก valid recommendations: ฐานวางไม่ได้ต้องยังอยู่ใน preview พร้อมเหตุผล เพื่อไม่ให้ภาพตกลงพื้นหรือแสดงว่าว่าง
- เรียก stacking validation ของปลายทางที่ไม่มี weight rule รักษา retired filtering, PALLET-only, tenant/warehouse scope และการตัดพาเลทที่กำลังย้ายออกจากฐานของตัวเอง
- ตรวจกรณีไม่มี valid candidate เลย: ต้นทางแนบ previewSupports เฉพาะ candidate ที่ผ่าน first-fit จึงอาจไม่มีฉากให้แสดง ถ้าพบใน regression ให้คืน preview context ของจุด/ฐานที่เข้าถึงได้แยกจาก candidates โดยไม่มีสิทธิ์จองจาก context นั้น
- Backend ยังคำนวณ Z จากฐานจริงทุกครั้งที่ reserve/confirm ไม่เชื่อ Z จาก client
- ทดสอบฐานวางได้/ไม่ได้, ฐานถูกจองหรือกำลังย้าย, retired, BOX/OTHER, ชั้นวางต่างระดับและเพดานเดิม

### 3. พอร์ต resolver และฉาก 2D/3D

- พอร์ต `resolvePalletSupport()` และการตรวจ footprint/ระดับแบบ pure function
- เลือกฐานจาก footprint ที่ผู้ใช้ร้องขอ ไม่กรองฐานผิดเงื่อนไขออกก่อนเลือกระดับ
- ไม่ clamp X/Y เข้าพาเลทรองรับเล็ก ๆ โดยอัตโนมัติ; คงกฎขอบเขตและระยะ snap ของจุดจัดเก็บเดิม
- เปลี่ยนฐานแล้วคง drag pointer และขนาดกล้อง ไม่ remount editor ตาม support ID ที่เปลี่ยน
- รักษา `storageFormat` และภาพ BOX/OTHER ของปลายทาง: automatic pallet support ใช้เฉพาะ PALLET; BOX/OTHER ยังใช้พื้น/ชั้นวางและตรวจการชนตามเดิม
- ทดสอบทับเต็ม/บางส่วน/แตะขอบ, หลายฐาน, ฐานสูงเท่ากัน, ลากออก, หมุน, X/Y, keyboard, 2D/3D และความนิ่งของกล้อง

### 4. เชื่อม storage/move editor และเอา select Z ออก

- ใช้ state แยก `requested placement` กับ `resolved support`; รวม logic ที่ใช้ตอนลาก/keyboard/หมุน/แก้ X/Y
- แสดงชื่อฐาน + Z ที่คำนวณได้ใน summary ให้ชัดเจน ใช้การ์ดเลือกจุด/ชั้นวางเดิมต่อไป
- กรณีผิดเงื่อนไข: สีแดง + ข้อความภาษาไทย/อังกฤษ และปิดทุกทางที่ไปสู่การจอง ตรวจ guard ภายใน handler ด้วย
- เปลี่ยนจากพื้นไปพาเลทหรือลากกลับ ต้องล้าง support ID เก่า ไม่ส่ง ID ของทั้งสองฐานปนกัน
- รักษา request idempotency, measurement revision, expected source placement และ move replacement semantics
- คงหน้าจอ Stack on top สำหรับกำหนดข้อจำกัดและเริ่ม flow เดิม; รอบนี้ไม่เปลี่ยนหน้าดังกล่าวเป็น editor อีกชุด
- ทดสอบ payload ทั้ง `reserve` และ `reserveMove` รวม failure/retry, dirty state และ back navigation

### 5. ทดสอบรวมกับ batch และ support locks

- ยก tests จากต้นทางแบบ selective; แทน load-limit case ด้วย max-level/permission/occupied-support case
- เพิ่ม regression สำหรับ retired และหน่วย BOX/OTHER รวม product format ที่ต่างจาก saved unit format
- จองตำแหน่งซ้อนแล้วฐานต้องล็อก; ย้าย upper ออกและยืนยันจบแล้วฐานจึงปลดล็อก; pickup อย่างเดียวต้องไม่ปลดล็อก
- Cancel และ return ต้องคืน/รักษา support relationship ถูกต้อง ไม่มีการปล่อยพื้นที่ที่ยังค้างอยู่
- ผู้ใช้สองคนจองฐานเดียวกันพร้อมกันต้องสำเร็จเพียงคนเดียว; ฐานเปลี่ยนระหว่าง preview กับ reserve ต้องถูกปฏิเสธและให้โหลดข้อมูลใหม่
- Refresh/retry ไม่สร้าง reservation ซ้ำ ไม่มีการเปลี่ยนจำนวนสินค้าเพราะเปลี่ยน preview
- ยืนยัน 4 → 2 เท่ากับสอง active units รวมจำนวนเท่าเดิม และ replacement ไม่มี stacking limits ติดมาจากของเก่า
- ผ่านเมื่อ `pnpm check` ทั้งชุดผ่านหลังพอร์ต

### 6. ตรวจการลากจริงและบันทึกหลักฐานที่ port 3100

- ใช้ข้อมูล QA แยกจากสินค้าของผู้ใช้ ทดสอบลากเมาส์จริง ไม่ใช้แค่กรอก X/Y แทนการลาก
- Desktop: 2D/3D, ลากขึ้นฐาน, ลากเหลื่อมเป็นแดง, ลากออก, หมุน, กล้องไม่กระตุก, กดจองถูก support ID
- Mobile: touch/pointer drag, scroll ไม่ถูกแย่ง, ไม่ล้นจอ, ข้อความและปุ่มภาษาไทย/อังกฤษ; ตรวจการกดเลือก/ลากโดยไม่สร้าง reservation โดยไม่ได้ตั้งใจ
- Full flow: จัดเก็บ/ย้าย → preview อัตโนมัติ → จอง → ตรวจรหัส → วาง → ย้าย upper ออก → ตรวจฐานปลดล็อก
- เก็บ screenshots/video การลากจริงและผลทดสอบ แยกภาพก่อนจอง ภาพ error และภาพจบ flow
- ตรวจ console errors, refresh, navigation และ empty state; รัน build ด้วย `NEXT_DIST_DIR=.next-build pnpm build` เพื่อคง dev server 3100

## เกณฑ์เสร็จ

ลากขึ้น–ลงฐานได้ตามตำแหน่งจริงใน editor ทั้งสองหน้า ภาพ invalid ยังคงอยู่ด้านบนพร้อมสีแดง/เหตุผลและจองไม่ได้ ไม่มี Z selector ระบบล็อกฐานและ batch เดิมยังผ่านทั้งหมด และไม่ได้เพิ่มกฎน้ำหนัก

## หลักฐานสำหรับแผนนี้

`artifacts/automatic-stacking-plan-2026-09-06/`:
- `source-reviewed.tar.gz`, `destination-reviewed.tar.gz`: ไฟล์ที่เทียบ รวม uncommitted source
- `reviewed-state.json`: branch, HEAD และ SHA-256 ของแต่ละไฟล์
- `comparison-review-only.patch`: diff สำหรับ review เท่านั้น **ห้าม apply ทั้งไฟล์** เพราะรวมความต่างด้าน batch/weight ที่ต้องรักษาไว้
- `source-tests.log`: 92 tests / 5 files ผ่าน
- `source-status.txt`, `destination-status.txt`: สถานะ dirty worktrees ตอนจัดทำแผน
