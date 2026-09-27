# คู่มือทดสอบคลัง Top Gold

## สถานะข้อมูลทดสอบ

สินค้า `TG-DEMO-BOX-01 — Demo Paper Carton` มี 4 pallet ที่ยังไม่ได้วางใน location รวม 108 cartons

| Pallet | Lot | จำนวน | สถานะ | จุดทดสอบที่แนะนำ |
| --- | --- | ---: | --- | --- |
| P-000001 | TG-DEMO-LOT-01 | 48 cartons | Awaiting placement | TG-A-F01-Z01 — Receiving and QC |
| P-000002 | TG-DEMO-LOT-02 | 20 cartons | Awaiting placement | TG-A-F01-Z02 — Pallet Storage A |
| P-000003 | TG-DEMO-LOT-02 | 20 cartons | Awaiting placement | TG-A-F01-Z02 — Pallet Storage A |
| P-000004 | TG-DEMO-LOT-02 | 20 cartons | Awaiting placement | TG-A-F01-Z03 — Dispatch Staging |

ใช้ [รายการ CSV](../../data/top-gold-demo/unplaced-pallets.csv) และ [ฉลาก pallet](../../output/pdf/top-gold-demo-pallet-qr-and-barcode-labels.pdf) คู่กันเมื่อทดสอบ

## ก่อนเริ่ม

1. เข้าสู่ระบบด้วยบัญชี Top Gold และเลือกคลัง `TG-DEMO · Top Gold Demo Warehouse`
2. พิมพ์ฉลาก pallet หรือเปิด PDF บนอุปกรณ์เครื่องที่สอง
3. เปิดหน้า **Finished goods → Scan Packages**
4. การทำงานในแอปใช้ **QR ทางขวาของฉลาก** เพราะ QR มีรหัสเฉพาะที่ระบบออกให้ ส่วน Code 128 ทางซ้ายเป็นรหัส pallet ที่อ่านได้ด้วยเครื่องสแกน

## ทดสอบการนำ pallet เข้าตำแหน่ง

ทำทีละ pallet เพื่อให้เห็นสถานะเปลี่ยนชัดเจน

1. ในหน้า Scan Packages ให้สแกน QR ของ pallet เช่น `P-000001`
2. ตรวจสอบว่าหน้าจอแสดงรหัส pallet, สินค้า, lot และจำนวนถูกต้อง
3. สแกน QR ของ location ที่ต้องการจากไฟล์ `location-qr-labels.csv`
4. ตรวจสอบ location ที่เลือกก่อนยืนยัน
5. ยืนยันการจัดเก็บ แล้วกลับไปหน้า **Finished goods**
6. ตรวจสอบว่า pallet นั้นไม่แสดงสถานะ `Awaiting placement` และยอด Stored units เพิ่มขึ้น

## ลำดับทดสอบที่แนะนำ

1. วาง `P-000001` ที่ `TG-A-F01-Z01` เพื่อทดสอบขั้นตอนรับสินค้า
2. วาง `P-000002` และ `P-000003` ที่ `TG-A-F01-Z02` เพื่อทดสอบหลาย pallet ในตำแหน่งเดียว
3. วาง `P-000004` ที่ `TG-A-F01-Z03` เพื่อทดสอบจุดเตรียมส่ง

## ตรวจสอบผล

- หน้า Finished goods: จำนวน `Awaiting storage` ต้องลดลงตามจำนวน pallet ที่ยืนยันแล้ว
- หน้า Buildings & spots → อาคาร `TG-A`: คอลัมน์ Stored ของ location ที่ใช้ต้องเพิ่มขึ้น
- เปิดรายละเอียด pallet: ต้องแสดง location ล่าสุดและสถานะจัดเก็บแล้ว

## หากต้องเริ่มใหม่

ข้อมูลทั้งหมดเป็น demo data อย่าล้างทีละรายการระหว่างทดสอบ หากต้องรีเซ็ตทั้งชุดให้ใช้ขั้นตอน cleanup ที่ระบุใน `data/top-gold-demo/README.md` ก่อนนำเข้าข้อมูลจริง
