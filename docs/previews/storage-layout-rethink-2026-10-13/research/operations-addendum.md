# ภาคผนวก: งานจัดเก็บ/ย้ายสต็อก (สำหรับพรีวิว storage layout)

อ้างอิงโค้ดในเครื่องเท่านั้น: `MoveScreen.tsx`, `PlacementEditor.tsx`, `PalletScreens.tsx` (`PalletLoader`, `PalletDetailScreen`, `LocationOnlyPalletDetail`), `unitNextAction.ts`, `StorageZonesPanel.tsx`, `lib/storageLayouts/{locationSelectors,storageKit}.ts`, `convex/finishedGoods/workflow.ts` ข้อมูลทั้งหมดในพรีวิวเป็นข้อมูลสาธิต ไม่มีการเขียนจริง ไม่มีการสแกน QR จริง

## 1. กฎเดิมที่พรีวิวต้องไม่ข้าม

จัดเก็บหน่วยใหม่ (pallet `AWAITING_PLACEMENT` → `RESERVED` → `STORED`)
- `reserve`: ต้องวัดขนาดแล้ว, ปลายทางไม่มี `unmeasuredPalletCount` (`LOCATION_GEOMETRY_UNKNOWN`), มี support, สภาพจัดเก็บไม่ขัด, ไม่ทับซ้อน การจองซ้ำจะแทนที่ placement เดิม
- `verifyDestination`: ต้องเป็น `RESERVED`; รหัส QR หรือรหัสพิมพ์ (MANUAL) ต้องตรงกับ location/position
- `confirmStored`: ต้องยืนยันปลายทางโดยผู้ใช้คนเดียวกัน (`DESTINATION_NOT_VERIFIED`) ไม่มีช่องติ๊กแทนการยืนยัน; ถ้าซ้อนบนพาเลทต้องใส่รหัสพาเลทด้านบน + ติ๊กยืนยัน
- `cancelReservation`: placement → `RELEASED`, หน่วยกลับเป็น `AWAITING_PLACEMENT` (ทำไม่ได้ถ้า `STORED`)

ย้ายหน่วยที่จัดเก็บแล้ว (move `RESERVED` → `IN_TRANSIT` → `COMPLETED`)
- เข้าได้เฉพาะ `STORED` + placement แบบมีพิกัด + ไม่มีพาเลทซ้อนด้านบน (`PALLET_SUPPORTING_STACK`) + มีสิทธิ์จัดการ (`MoveLoader`)
- `reserveMove`: สร้าง target placement `RESERVED`; source ยัง `STORED`; ห้ามตำแหน่งเดิม (`MOVE_UNCHANGED`); ตรวจ source ไม่เปลี่ยน (`MOVE_SOURCE_CHANGED`)
- `startMove` (รับของ): ต้องติ๊กยืนยัน; จะสแกน/พิมพ์รหัสพาเลทหรือใช้ ACKNOWLEDGEMENT ก็ได้
- `verifyMoveDestination` (ไม่บังคับ): ทำได้หลัง `IN_TRANSIT` เท่านั้น; ถ้ารหัสไม่ตรงจะล้างผลยืนยันเดิม
- `completeMove`: ต้องติ๊กว่าวางแล้ว + (ยืนยันปลายทาง หรือ ACKNOWLEDGEMENT) → target `STORED`, source `RELEASED`
- เฉพาะเจ้าของงานย้ายทำต่อได้ (`activeMove.isOwner`) คนอื่นเห็นแบบอ่านอย่างเดียว

## 2. จุดเชื่อม UI ที่มีอยู่จริง

| จุด | คอมโพเนนต์/ฟังก์ชัน | บทบาทในพรีวิว |
|---|---|---|
| แถวหน่วยในจุดจัดเก็บ | `StorageZonesPanel` รายการ `zone.placements`: ปุ่ม Eye → `palletPath`, ArrowRightLeft → `/move` (เฉพาะ `STORED` หรือมี `moveState`) | ปุ่ม "ย้าย"/"ดำเนินการย้ายต่อ" ในแผงตำแหน่งที่เลือก |
| ป้ายสถานะ | `PlacementStatusBadge` + `placementStatusKey` (MoveTarget / MoveSource / MoveInTransit / Reserved / Stored) | ใช้ชุดสถานะเดียวกันในแผนที่และรายการ |
| ตัวเลขต่อตำแหน่ง | `locationInventory` / `storageLocationSummary` (นับ unit ไม่ซ้ำ, `incomplete`) | ฟังก์ชันนับตัวเดียวจาก dataset เดียว |
| หน่วยไม่มีพิกัด | `LocationOnlyInventory` (ไม่มีปุ่มย้าย) | แสดงแยกหัวข้อ ไม่มี action |
| เลือกปลายทาง | `MoveSelection` → `recommendMove` + `DestinationPicker` + `PlacementEditor moving` | ขั้น "เลือกปลายทาง" |
| ทำงานย้าย | `ActiveMove` (progress 3 ขั้น, Acknowledgement, `DestinationScanner`, dialog cancel/return/issue) | ขั้นรับของ/วาง/ยกเลิก/คืน |
| จัดเก็บหน่วยใหม่ | `PalletLoader view="storage"` → `Recommendations` → `PlacementEditor` → `PalletDetailScreen` (verify + confirm) | flow "จัดเก็บ" |
| ทางเข้าจากรายการ | `unitNextAction` (Choose storage / Continue placement / Continue move) | ป้ายปุ่มในคิว "รอจัดเก็บ" |
| ล็อกการแก้ผัง | `occupiedChangeBlocked` (นับ placements รวม RESERVED + unmeasured) | โหมดแก้ไขผังต้องเคารพ hold ของงานจัดเก็บ/ย้าย |

## 3. ทางเข้างาน 3 แบบ (ใช้ search/แผนที่/รายการ และตำแหน่งที่เลือกร่วมกัน)

1. ค้นหาและดูสต็อก (ค่าเริ่มต้น): แผงตำแหน่งแสดงตัวเลข, หน่วย, สถานะ ไม่มีปุ่มเขียน
2. จัดเก็บและย้าย: แผงเดิมเพิ่ม action ต่อหน่วย ("ย้าย", "ดำเนินการย้ายต่อ") และคิว "รอจัดเก็บ" ด้านข้าง; ขณะเลือกปลายทาง แผนที่ไฮไลต์เฉพาะตำแหน่งที่เข้าเงื่อนไข ตำแหน่งที่ไม่เข้าเงื่อนไขแสดงเป็นจาง พร้อมเหตุผลที่อ่านได้
3. แก้ไขผัง: ของอีก session; ตำแหน่งที่มี hold/สต็อกล็อกการแก้ขนาด/ความสูง/สภาพ พร้อมข้อความ "มีหน่วยหรือการจองอยู่"

การสลับงานไม่ล้าง flow ที่ค้างอยู่: งานย้ายที่ `RESERVED`/`IN_TRANSIT` เป็นสถานะของข้อมูล ไม่ใช่สถานะของหน้า (แบบเดียวกับ `activeMove`) จึงแสดงแถบ "มีงานย้ายค้าง · ดำเนินการต่อ" ทุกโหมด

## 4. Flow สาธิต

ย้าย (U-1001 จาก A-01)
1. เลือก A-01 → หน่วย U-1001 → "ย้าย" (ฉบับร่าง ยังไม่เปลี่ยนข้อมูล)
2. เลือกปลายทางที่เข้าเงื่อนไข (A-03) → ทบทวน "จาก/ไป" → "จองตำแหน่งนี้" → move `RESERVED`
3. "ยืนยันรับของแล้ว" (ติ๊ก) → `IN_TRANSIT` ("ยืนยันรหัสพาเลท" เป็นทางเลือก ใช้ช่องพิมพ์ชื่อ "รหัสสาธิต" ไม่ใช่กล้อง)
4. (ทางเลือก) พิมพ์รหัสปลายทาง `A-03`; ถ้าไม่ตรงให้ล้างผลยืนยัน
5. ติ๊ก "วางตามตำแหน่งแล้ว" → "ยืนยันย้ายเสร็จ" → ตัวเลขทุกจุดเปลี่ยนพร้อมกัน + toast "เปลี่ยนเฉพาะข้อมูลสาธิตในเบราว์เซอร์"

จัดเก็บ (U-1005 จากคิวรอจัดเก็บ)
1. "เลือกจุดจัดเก็บ" → เลือก A-02 → "จองตำแหน่งนี้" → `RESERVED`
2. ต้องพิมพ์รหัสปลายทางให้ตรงก่อน (ไม่มีทางเลือกติ๊กแทน) → ปุ่ม "ยืนยันว่าจัดเก็บแล้ว" จึงเปิดใช้งาน → `STORED`

ไม่รวมการซ้อนพาเลทใน flow สาธิต; แสดงเฉพาะสถานะล็อกของ U-1002

## 5. โมเดลสถานะในพรีวิว (in-memory ชุดเดียว)

```ts
type Location = { id; code; floor; slots: number; geometryKnown: boolean; condition: "ANY" | "COLD" };
type Unit = { id; code; product; qty; status: "AWAITING_MEASUREMENT" | "AWAITING_PLACEMENT" | "RESERVED" | "STORED";
  placementId?: string; supportsUnitId?: string };
type Placement = { id; unitId; locationId; mode: "GEOMETRIC" | "LOCATION_ONLY";
  status: "RESERVED" | "STORED" | "RELEASED"; verified: boolean; moveRole?: "SOURCE" | "TARGET" };
type Move = { id; unitId; sourcePlacementId; targetPlacementId;
  status: "RESERVED" | "IN_TRANSIT" | "COMPLETED" | "CANCELLED" | "RETURNED";
  destinationVerified: boolean; issue?: string };
type Ui = { task: "lookup" | "operate" | "edit"; selectedLocationId?: string;
  draft?: { kind: "move" | "store"; unitId: string; targetLocationId?: string } };
// history: Snapshot[] สำหรับ "ย้อนการสาธิต" และ "รีเซ็ตข้อมูลสาธิต"
```

ทุกตัวเลขคำนวณจาก `placements` ที่ไม่ใช่ `RELEASED` (นับ unit ไม่ซ้ำ ตาม `storageLocationSummary`) ห้ามมีตัวนับแยก ปลายทางที่เข้าเงื่อนไขต้อง `geometryKnown`, สภาพตรง และ `slots` > placements ที่ active ระบุใน UI ว่า "ตรวจแบบจำลองช่อง; ระบบจริงตรวจขนาด ความสูง และการทับซ้อนใน PlacementEditor"

ข้อมูลตัวอย่าง (สมมติทั้งหมด):

| หน่วย | สินค้า | สถานะเริ่ม | ตำแหน่ง | ใช้สาธิต |
|---|---|---|---|---|
| U-1001 | สินค้าสาธิต ก ×40 | STORED | A-01 | flow ย้าย |
| U-1002 | สินค้าสาธิต ข ×24 | STORED (รองรับ U-1003) | A-02 | ย้ายไม่ได้ — ต้องย้ายพาเลทด้านบนก่อน |
| U-1003 | สินค้าสาธิต ข ×24 | STORED (ซ้อนบน U-1002) | A-02 | ย้ายได้ |
| U-1004 | สินค้าสาธิต ค ×10 | STORED, LOCATION_ONLY | B-01 | ไม่มีปุ่มย้าย |
| U-1005 | สินค้าสาธิต ก ×40 | AWAITING_PLACEMENT | — | flow จัดเก็บ |
| U-1006 | สินค้าสาธิต ง ×12 | AWAITING_MEASUREMENT | — | "ต้องวัดขนาดก่อน" |

ตำแหน่ง: A-01 (2 ช่อง), A-02 (3 ช่อง, U-1002 นับเป็น 1 ช่องเพราะซ้อน), A-03 (1 ช่อง ว่าง), B-01 (`geometryKnown=false`), C-01 (COLD ไม่ตรงสภาพ) ยอดเริ่มต้น: จัดเก็บ 4, จอง 0, รอจัดเก็บ 1, รอวัด 1

## 6. Hold และตัวเลขต้นทาง/ปลายทาง (U-1001: A-01 → A-03)

| สถานะ | A-01 | A-03 | ยอดคลัง |
|---|---|---|---|
| ร่าง/ทบทวน | จัดเก็บ 1 | ว่าง (ไฮไลต์เท่านั้น) | จัดเก็บ 4 |
| move RESERVED | จัดเก็บ 1 · "ต้นทางงานย้าย" | จอง 1 · "ปลายทางงานย้าย" | จัดเก็บ 4, กำลังย้าย 1 (ไม่นับซ้ำ) |
| IN_TRANSIT | จัดเก็บ 1 · "กำลังย้าย" (ยังกันพื้นที่) | จอง 1 | เท่าเดิม |
| COMPLETED | ว่าง | จัดเก็บ 1 | จัดเก็บ 4 |

ยอดคลังนับตาม unit ไม่ซ้ำ ไม่ใช่ผลรวมรายตำแหน่ง ระหว่างงานย้าย ทั้งสองตำแหน่งต้องถือว่าถูกใช้ทั้งเพื่อการเลือกปลายทางและล็อกการแก้ผัง

## 7. การยกเลิก

- ก่อนจอง: "ยกเลิก" ล้าง draft เท่านั้น ไม่เปลี่ยนข้อมูล
- move `RESERVED`: "ยกเลิกการย้าย" → target `RELEASED`, move `CANCELLED`, source ยัง `STORED`; "เปลี่ยนปลายทาง" → ปล่อย target เดิม สร้างใหม่ และล้าง `destinationVerified`
- move `IN_TRANSIT`: ห้ามยกเลิก; มีแค่ "คืนต้นทาง" (ติ๊ก หรือพิมพ์รหัส A-01 ให้ตรง) → target `RELEASED`, move `RETURNED`; "แจ้งปัญหา" บันทึก issue โดยยังกันทั้งสองพื้นที่
- จัดเก็บ `RESERVED`: "ยกเลิกการจอง" → placement `RELEASED`, หน่วยกลับคิวรอจัดเก็บ
- ปิดแผง/สลับโหมด/เปลี่ยนชั้น: ไม่ยกเลิกงาน แสดงแถบงานค้าง
- "ย้อนการสาธิต": คืน snapshot ก่อนหน้าในเบราว์เซอร์เท่านั้น ระบุว่าระบบจริงไม่มี undo การย้ายที่เสร็จแล้ว (ต้องสร้างงานย้ายกลับผ่าน flow เต็ม)

## 8. สิ่งที่ production ต้องคงไว้เมื่อนำไปใช้จริง

- ตำแหน่งที่มี `unmeasuredPalletCount > 0` ห้ามเป็นปลายทาง (`LOCATION_GEOMETRY_UNKNOWN`) ให้แสดงเหตุผล ไม่ซ่อนตำแหน่ง
- หน่วย `LOCATION_ONLY` นับใน units/stored แต่ไม่นับพื้นที่ footprint ไม่มีปุ่มย้าย/ซ้อน/แก้ขนาด และให้ลิงก์ไปที่ `LocationOnlyPalletDetail`
- ถ้า `incomplete`/`totalIncomplete` เป็นจริง ให้แสดง "ข้อมูลไม่ครบ" ห้ามแสดง 0 หรือยอดที่เดาขึ้นเอง
- ปุ่มใหม่ต้องลิงก์ไปที่ route เดิม (`/move`, storage view) และใช้ guard ฝั่ง server เดิมทั้งหมด (owner, `requestId` idempotency, stale checks) ไม่สร้าง mutation ทางลัดจากแผนที่
- สิทธิ์อ่านอย่างเดียวต้องซ่อน action ทั้งหมด (`useCanManage`) ส่วน building ที่ ARCHIVED ปิดโหมดแก้ไข
