# TopGold scan performance experiment

วันที่ 2026-10-16 — ผู้ใช้ขอให้ Kiro ทดสอบแต่ละวิธี รายงาน accuracy และ speed แล้ววิเคราะห์ final solution งานนี้เก็บ benchmark และข้อเสนอ ไม่มีการเปลี่ยน production scanner

**ผู้ใช้ยืนยันระหว่างงาน: เน้นเปิดกล้องมือถือสแกนหน้างาน ทั้ง Android และ iPhone** จึงใช้ผลรูปนิ่งเลือก decoder/ROI ก่อน และต้องเพิ่ม frame replay ที่ความละเอียดใกล้กล้องเพื่อเทียบ JS ปัจจุบันกับ hinted JS/WASM worker โดยระบุว่า desktop replay ไม่ใช่ผลกล้องมือถือจริง

## ข้อมูลและ baseline

- Manifest 166 รายการ แต่มีต้นฉบับจริง 163 ไฟล์ / 153 SHA-256 ไม่ซ้ำ: พื้นที่ 59 และ Package 94 ภาพ
- ไฟล์ 83, 86, 104 ไม่มีอยู่จริง ไม่รวมเป็น decoder failures
- 20 ภาพขนาด 3472×4624 หรือกลับแนว รวม 16,054,528 pixels เกินเพดาน worker 16,000,000; ต้องรายงาน preflight rejection แยกจาก decode miss
- ตรวจ hash ของต้นฉบับทั้งหมดแล้วตรงกับ manifest; ไม่แก้ต้นฉบับ ตัว decoder รัน local และไม่เรียก API OCR/AI extraction ระหว่าง benchmark ส่วน Kiro ตรวจภาพตัวอย่างเพื่อจัดทำ labels แยกจาก decoder
- ค่าพื้นที่/JOB จาก manifest เป็น provisional labels; บางค่าเคยได้จาก decoder จึงยังไม่ใช่ independent ground truth เต็มชุด
- สินค้าและ QR ไม่มี payload ground truth เต็มชุด ต้องเรียกผลว่า decode yield จนกว่าจะตรวจต้นฉบับ; ห้ามใช้ผล decoder เป็นเฉลยของตัวเอง

## การทดลองที่มอบหมาย Kiro

ใช้ Kiro CLI `claude-opus-5.5 --effort high` หลังตรวจ availability แล้ว คำสั่ง/ข้อจำกัดอยู่ใน `docs/reviews/assets/topgold-scanning-2026-10-16/kiro-task.md`

| กลุ่ม                                 | คำถามที่ต้องตอบ                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Production baseline                   | ระบบจริงอ่านอะไรได้ ใช้เวลารวม worker/init เท่าไร ปฏิเสธภาพ/timeout กี่รูป                      |
| Full-frame multiscale                 | 1600/3000 pixels ช่วยเวลาเท่าไร เสียหรือได้ payload ใดบ้าง                                      |
| Generic ROI + native-resolution crops | detector ที่มีอยู่ช่วยภาพ ticket/product และภาพเอียงได้หรือไม่ เมื่อรวมต้นทุน detect แล้ว       |
| Fast then hard cascade                | ขั้นตอนราคาถูกก่อน แล้วค่อย ROI/deskew/rescue ช่วยลด p95 โดยยังรักษารหัสครบ/ความกำกวมได้หรือไม่ |

ทดลอง options/preprocessing เพิ่มเฉพาะที่จำเป็นและมี hypothesis เช่น `tryHarder:false` fast pass เทียบ `true`; คง checksum และ scanline ปกติ ไม่เพิ่ม exhaustive filters ที่ยังไม่มีหลักฐาน ประเมิน warm worker แยกจาก per-image cold worker ไม่ปนผล latency

## วิธีวัดและการตัดสินใจ

1. Decoder รับเพียง opaque id และ pixels ไม่มีชื่อไฟล์/expected codes; ให้ scorer ฝั่งแยกเทียบผล
2. รันแบบ sequential เพื่อไม่ให้ CPU contention ทำให้ผลแต่ละวิธีเทียบไม่ได้; บันทึก browser/platform/version/run order/timeouts และ cold/warm boundaries
3. รายงาน per-image exact match ของ JOB/location เทียบ provisional labels, wrong/multiple candidates, no-read, rejected input, timeout และ review-required
4. แยก complete ticket yield (พบ JOB + product) จาก JOB recall; QR yield แยกจากความถูกต้องของ field; image ที่เป็น product label ไม่มี JOB เป็นอีกกลุ่ม
5. ความเร็วใช้ p50/p95 รวม failures และรายงาน success-only เพิ่มได้ ต้องแยก warm decoder time ออกจาก cold worker end-to-end; ไม่ใช้ `elapsedMs` ใน production เพียงตัวเดียว เพราะเริ่มหลัง WASM init
6. ทำ timing ซ้ำบน subset ที่กำหนดชัดเจนและ negative controls ตามที่ทำได้; ทุก variant ต้องมี raw results และ reproduce command
7. สรุป incremental wins/losses; ห้ามยอมรับ false identity เพื่อให้ตัวเลข recall สูงขึ้น; minLineCount 1 ต้อง review

## ขอบเขตที่ต้องทดสอบเพิ่มก่อนใช้จริง

- กล้องสดบนมือถือเป้าหมาย: autofocus, time-to-first-correct-read, main-thread long tasks, fps, torch, cancellation, battery/thermal
- ข้อมูลใหม่ที่ไม่ใช้ปรับวิธีและ independent ground truth โดยเฉพาะสินค้า/QR/หลายรหัสในภาพเดียว
- AI อ่านฟิลด์เต็มเอกสาร: field-level exact match สำหรับวันที่/จำนวน/ชื่อ เทียบเวลา provider และ network แยกจากการอ่าน barcode; รอบนี้ไม่มี external AI benchmark

## Deliverables

- Dataset audit และ per-image JSON/CSV: `docs/reviews/assets/topgold-scanning-2026-10-16/`
- Local harness: `scripts/topgold-scan-benchmark/`
- Kiro experiment report: `docs/reviews/topgold-scanning-kiro-2026-10-16.md`
- Primary-source architecture findings: `docs/research/scanning-decoder-options-2026-10-16.md`
- Parent final assessment จะระบุทั้งผลที่วัดจริงและงานถัดไปที่ยังไม่ถูกวัด แยกกันอย่างชัดเจน
