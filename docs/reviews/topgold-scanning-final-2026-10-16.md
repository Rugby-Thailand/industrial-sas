# TopGold scanning: final assessment

วันที่ 2026-10-16 — เป้าหมายที่ผู้ใช้ยืนยันคือ **เปิดกล้องมือถือสแกนหน้างาน ทั้ง Android และ iPhone** งานนี้ทดสอบและวางแนวทาง ยังไม่ได้เปลี่ยน production scanner

## Evidence and interpretation

ชุดข้อมูลมีต้นฉบับจริง 163 ไฟล์ / 153 SHA-256 ไม่ซ้ำ แบ่งเป็นพื้นที่ 59 และ Package 94 ภาพ ตรวจ hash ทุกไฟล์แล้วตรงกับ manifest เอกสาร 2 ภาพเป็นฉลากสินค้าไม่มี JOB ส่วนไฟล์ 83/86/104 ที่ manifest ระบุว่า JOB อ่านไม่ชัดไม่มีอยู่ในโฟลเดอร์ จึงไม่มีผลทดสอบจากสามภาพนี้ ดู [dataset audit](assets/topgold-scanning-2026-10-16/dataset-audit.json)

ผล JOB/location เทียบกับ **provisional labels** ของ manifest ซึ่งบางค่าได้จากการถอดรหัสก่อนหน้านี้ สินค้าใช้ได้ทั้ง decode yield และ subset ที่ Kiro ตรวจข้อความพิมพ์จากภาพ แต่ยังไม่มีผู้เชี่ยวชาญยืนยัน ground truth ครบชุด QR ไม่มี payload ground truth ครบชุด จึงห้ามเรียกอัตรา decode ได้ว่า accuracy ของ QR

ผล desktop/เฟรม replay ใช้เลือกวิธีต่อไป ไม่มีโทรศัพท์จริงเชื่อมต่อ และการย่อรูปนิ่งไม่จำลอง autofocus, motion blur ระหว่างเคลื่อนไหว, rolling shutter, exposure, การเปิดกล้อง, ความร้อน หรือพลังงานของมือถือ ผลที่วัดไม่ได้จึงไม่ถูกนับว่าผ่าน

## Mobile-sized frame replay

Kiro ถอดรหัสภาพทั้ง 153 ภาพที่ย่อแบบรักษา aspect ratio เป็น max-side 1920 และ 1080 โดยรันแต่ละวิธีบน pixels เดียวกัน มี setup แยกและ warm worker ตารางด้านล่างคือ **1920 px หนึ่งเฟรมต่อภาพ** บน desktop ไม่ใช่เวลาเปิดกล้องหรือเวลาอ่านหน้างาน ตัวเลขพื้นที่เป็น exact set รวมกรณีหลายป้าย; ผลนี้จึงเข้มกว่าการพบป้ายที่ตรงอย่างน้อยหนึ่งป้าย

| วิธีต่อเฟรม                           | พื้นที่ตรงครบ / 58 | JOB ตรง / 92 | พบคู่ JOB + สินค้า / 92 |    p50 / p95 ms |
| ------------------------------------- | -----------------: | -----------: | ----------------------: | --------------: |
| JS default (ตัวหลักของ live ปัจจุบัน) |                  0 |           40 |                       0 |    52.0 / 106.9 |
| JS ใส่ Code128/QR hints               |                  0 |           40 |                       0 |     25.5 / 81.2 |
| JS live fallback เดิม*                |                 22 |           81 |                       — | 651.8 / 1,230.7 |
| Warm WASM fast เต็มเฟรม               |                  2 |           70 |                       8 |     21.3 / 73.4 |
| Warm WASM hard เต็มเฟรม               |                 12 |           82 |                      33 |     37.1 / 89.7 |
| WASM fast เฉพาะกรอบเล็งกลางจอ         |                  0 |            0 |                       0 |      6.5 / 16.9 |
| WASM region rescue (post hoc)         |                 14 |           58 |                      43 |    71.6 / 120.5 |
| Native detector บน Mac นี้            |                 32 |           90 |                      66 |     23.9 / 32.3 |

\* Fallback เป็นผล decoder ที่ค้นครบแล้ว ไม่ใช่ผลที่ hook ส่งให้ผู้ใช้ทั้งหมด เพราะ hook ส่งต่อเฉพาะ singleton เท่านั้น จึงห้ามตีความตารางนี้เป็นความสำเร็จของ live scheduler ปัจจุบันทั้งระบบ Pair yield ไม่ใช่ product accuracy; JS primary คืนได้ครั้งละหนึ่ง symbol ส่วน WASM/native คืนหลายตัวได้

ข้อค้นพบที่ใช้ตัดสินใจ:

- `tryHarder:true` ใน worker ได้ JOB เพิ่ม 12 และคู่เพิ่ม 25 จาก fast mode โดย p50 เพิ่มประมาณ 16 ms ในรอบนี้ จึงไม่ควรตั้ง fast mode เป็นคำตอบเริ่มต้นโดยไม่มีเงื่อนไขสำหรับงานนี้
- การใส่ hints ช่วย JS latency แต่ไม่เพิ่ม recall ของ frame นี้ ต้องเปลี่ยนวิธีรับ/เลือก symbols เพื่อแก้การที่ QR/JOB เดิมบัง product result
- Fixed center ROI เร็วเพราะแทบไม่เจอรหัส ไม่ใช่ความสำเร็จ: framing ของรูปชุดนี้วาง JOB บนกระดาษ สินค้าอยู่ล่าง และป้ายพื้นที่อยู่ขอบภาพ ต้องมี full-frame recovery หรือ ROI ที่หาตามภาพ และทดสอบ framing ที่คนเล็งจริงก่อนใช้
- ย่อเหลือ 1080 ทำให้ WASM hard เหลือพื้นที่ตรงครบ 1/58 และ JOB 73/92 แม้ p95 เหลือ 30.4 ms; native เหลือพื้นที่ 22/58 และ JOB 89/92 นี่คือ trade-off ที่การดูความเร็วอย่างเดียวซ่อนอยู่
- Native ทำได้ดีที่สุดใน frame replay บน Mac นี้ แต่ engine/platform ไม่เหมือนมือถือทั้งหมด ต้องตรวจ supported formats และทดสอบ Android/iPhone จริงก่อนเลือกเป็น fast path ส่วน WASM เป็นทางหลักที่ใช้ร่วมกันได้และต้องตรวจ compatibility เพิ่ม
- Main-thread long-task p95 ในรอบแรกของ JS default ประมาณ 111 ms, fallback 165 ms ขณะที่ WASM hard/native เป็น 0 ms ที่ percentile นี้ ไม่ได้หมายความว่าจะไม่มี main-thread cost หรือ long task เลยทุกกรณี
- QR decode yield ของใบ JOB ที่ 1920: JS default/hinted 30/92, WASM fast 68/92, WASM hard 72/92 และ native 80/92 ทุก QR ที่อ่านได้ในกลุ่มนี้เท่ากับ JOB ใน provisional manifest; เป็น yield และ consistency check ไม่ใช่ accuracy ของ QR ครบชุด
- การ trace ผลผิดของ live fallback ยืนยันว่า garbage หลายค่าเป็น **Code128 จาก primary reader** เช่นภาพ 15,22,25 ที่ 1920 จึงไม่ใช่ปัญหา all-format fallback เท่านั้น การใส่ format hints หรือ checksum ไม่พอจะรับประกัน identity; ต้องตรวจ target/canonical warehouse code และจัดการ unknown/ambiguous ก่อนส่งผลเข้า workflow ดู `mobile/raw/diagnose.jsonl`

การทดลอง scheduler รอบแรก (35 ภาพ × current/proposed, 4 วินาทีต่อรอบ; pixels นิ่งผ่าน `canvas.captureStream`) ให้ผลพื้นที่ 5/16 → 1/16 และ JOB 10/16 → 13/16 เมื่อใช้ ROI-fast เป็นส่วนใหญ่ แม้ RAF gap p95 ลด 166.6 → 66.7 ms จึง **ไม่ผ่านเกณฑ์เปลี่ยนแทนของเดิม** ตัวเลข time-to-hit เป็นเฉพาะกรณีที่สำเร็จและคนละ coverage ห้ามใช้สรุป speedup แบบไม่กล่าวถึงภาพที่หายไป

Prototype ยัง grab เร็วกว่าจำนวนเฟรมจริงได้ (median 247 attempts ใน 4 วินาที) จึงต้อง gate ตามเฟรมใหม่และ cadence ก่อนนำไปใช้จริง ผล 6 รายการที่มาถึงหลัง Stop ถูกทิ้ง ไม่ได้ส่งเข้า workflow; การทดสอบนี้ยังไม่แทน terminate-on-cancel ของ production

รอบแก้ V2 เพิ่ม pixel-based region rescue ใน worker และอิง field ที่ยังขาด ได้พื้นที่ 3/16 และ JOB 13/16, พบ candidate สินค้า 10/16 เทียบกับ current 0/16, RAF gap p95 92.2 ms และ successful-hit p95 410 ms ยังเสีย location coverage เมื่อเทียบ current 5/16 จึงไม่ใช่ replacement ที่ผ่านเกณฑ์เช่นกัน เป็น post-hoc experiment บนภาพชุดเดิม ไม่มี held-out claim ชุดรันที่เผลอเลือก v1 แทน v2 ถูกแยกเป็น `live-rerun-contended.jsonl` และไม่ใช้แทนหลักฐาน V2; corrected `live2` มี `scheduler: proposedV2` 35 แถวและมี region calls จริง

Desktop WebKit 26.5 smoke ทดสอบ 2 ภาพกับ JS/WASM hard/region worker รวม 6 calls: โหลด worker และประมวลผลครบ ไม่มี decoder/page errors และ JS/WASM hard อ่าน JOB ของภาพ 50 ตรงกัน ในเครื่องนี้ไม่มี `BarcodeDetector` ทั้ง window/worker ตรวจผลได้จาก [compatibility evidence](assets/topgold-scanning-2026-10-16/webkit-smoke.json) เป็น functional smoke ไม่ใช่ผลกล้อง iPhone หรือ latency benchmark

## Static-photo results

Kiro รัน 8 variants × 153 ภาพไม่ซ้ำ โดยใช้ browser/engine จริงและ pixels ของต้นฉบับ ไม่มี expected payload ใน decoder ตารางนี้ใช้ [parent summary](assets/topgold-scanning-2026-10-16/parent-summary.json) เพื่อคง denominator รวม input errors; เวลาเป็น wall time จาก JPEG ที่มีอยู่ใน memory ไม่รวมการ fetch ไฟล์ แต่รวม bitmap/worker ตาม variant บน M1 Max / Chromium 151 ไม่ใช่เวลาโทรศัพท์

| วิธี                                | พื้นที่ตรงครบ / 58 | JOB ตรง / 92 | พบคู่ JOB + สินค้า / 92 | p50 / p95 ms |
| ----------------------------------- | -----------------: | -----------: | ----------------------: | -----------: |
| Production photo worker             |                 25 |           51 |                      47 | 598 / 14,934 |
| Production pipeline ใน warm worker* |                 26 |           58 |                      54 | 592 / 14,667 |
| Full 1600 fast                      |                  1 |           64 |                       4 |      70 / 88 |
| Full 1600 hard                      |                  7 |           78 |                      19 |     83 / 101 |
| Full 3000 hard                      |                 16 |           81 |                      37 |    139 / 232 |
| Generic ROI fast                    |                 18 |           72 |                      45 |    144 / 367 |
| Generic ROI hard                    |                 22 |           75 |                      49 |    191 / 450 |
| Cascade                             |                 23 |           85 |                      57 |    203 / 849 |

\* Warm variant เรียก production pipeline ตรงและข้าม pixel preflight จึงไม่ใช่การเปลี่ยน lifecycle อย่างเดียว เมื่อตัดภาพเกินเพดานออกเหมือนกัน 133 ภาพ cold/warm p50 เท่ากับ 694/630 ms และ p95 15,055/14,765 ms ตามลำดับ: warm-up ช่วยบางส่วน แต่ไม่แก้ต้นทุนค้นหา geometry หลายรอบ

พื้นที่ 58 คือ 59 ภาพลบภาพ 17 ที่ไม่ทราบเลขท้าย; ภาพ 2 มีสองป้ายและต้องตรงครบทั้งชุด ไม่มีรหัสเกินจึงนับ exact 92 ใบ JOB ไม่รวม product-only labels 145/146 คู่ JOB+สินค้าเป็น **decode yield** เพราะ ground truth สินค้ามีเพียง subset ไม่ใช่ accuracy ครบชุด Production มี input errors 20 ภาพ และ wrong candidate ในพื้นที่ 4 ภาพ (2,9,13,106); variants WASM ใหม่ไม่มี strict candidate ที่ผิดจาก manifest ในพื้นที่ที่วัดได้ แต่ cascade single-scanline rescue คืน garbage candidate ในภาพ 21 ซึ่งถูกติด review และไม่ถูกนับเป็น strict success ยังมี no-read/partial และ recall ไม่เท่า baseline

ข้อสรุปรูปนิ่ง: cascade เพิ่ม JOB recall และ pair yield พร้อมลด tail latency มาก แต่ยังไม่รักษา location recall เดิมทั้งหมด จึงไม่ควรแทนทุก target ด้วยตัวเดียว Full-image downscale อย่างเดียวเร็วแต่เสีย barcode เล็ก; ROI มีประโยชน์ต่อสินค้า แต่ตัว detector ที่มีอยู่ยังพลาดป้ายพื้นที่หลายภาพ ต้องแยก target และ fallback การเพิ่ม worker reuse อย่างเดียวไม่ทำให้รูปยากกลายเป็นเร็ว

## Confirmed gaps in the current app

1. **Live decoder อยู่บน main thread และอ่านภาพเต็มโดยไม่รู้ field target:** `useBarcodeCamera.ts` ใช้ `BrowserMultiFormatReader(undefined)` เว้น attempts 100 ms; fallback ใช้ JS decode ภาพเต็มและค้น crop/มุมด้วย budget 1.2 วินาที อย่างน้อยทุก 1.5 วินาที กรอบเล็งใน `BarcodeCameraBox.tsx` เป็น overlay ไม่ได้จำกัด pixels ที่ decoder อ่าน `imageTarget` ถูกส่งให้ photo picker แต่ไม่ได้ส่งให้ live hook จึงใช้ decoder แบบเดียวแม้กำลังสแกนช่อง JOB หรือสินค้า การย้ายแค่ photo worker ไม่แก้เส้นทางนี้
2. **ตัวแยกประเภท JOB ไม่ครอบคลุมข้อมูลจริง:** `classifyTicketBarcode` รับ `^FO\d{4,}$` แต่ manifest มี `FOM…` 12 ภาพ ต้องแยก payload decoding ออกจาก field routing; อ่าน bytes ถูกก็ยังใส่ช่องผิดได้ นอกจากนี้ `completeTicket` ยังค้น upper bands ต่อเพราะไม่พบ JOB ที่ classifier ยอมรับ หลายภาพจึงทำ 56 attempts แม้รหัสอยู่ในผลแล้ว Baseline 12 ภาพนี้มี median wall time 6,343 ms (รวมภาพอ่านไม่ออก); เป็นหลักฐานความสัมพันธ์และ control-flow ไม่ใช่ผล before/after การแก้ classifier ต้องยืนยันรูปแบบ JOB กับ domain ก่อนเพิ่มกฎ
3. **Photo preflight ปฏิเสธ 20 ภาพก่อน decode:** ภาพ 3472×4624 (หรือกลับแนว) มี 16,054,528 pixels เกินเพดาน worker 16,000,000 เล็กน้อย เป็นข้อจำกัดของการเลือกรูป/กู้ภาพนิ่ง มากกว่ากล้องสด 1920×1080 ที่ระบบขออยู่ ควรเตรียม working bitmap ที่จำกัดขนาดและคงต้นฉบับสำหรับ crop ไม่เพียงยกเพดานแบบไม่มีขอบเขต
4. **มี ROI detector แล้ว แต่ ticket/product ไม่ใช้:** `linearBarcodeRegions` ถูกใช้ใน WASM target `ANY`; ticket/product ยังค้นแถบตามตำแหน่งและกวาดมุม ต้องทดลอง reuse detector ก่อนเสนอสร้างใหม่
5. **Photo worker เริ่มใหม่ทุกภาพ:** `readBarcodeImage` สร้าง/terminate worker ต่อไฟล์ ขณะที่ `elapsedMs` เริ่มหลัง WASM init จึงต้องวัด wall clock เพิ่ม; warm-vs-cold comparison ต้องใช้ภาพที่ผ่าน preflight เหมือนกัน
6. **AI photo และ barcode เป็นคนละทาง:** `onPhoto` resize 2000px แล้วส่ง AI โดยตรง ส่วน barcode panel ใช้ decoder; upload และ AI ทำพร้อมกันแล้ว แต่ UI รอ `Promise.all` ทั้งคู่ และเลือกภาพหลายใบแล้วเริ่ม `onPhoto` ทุกภาพทันที ไม่มี local barcode cross-check หรือ bounded extraction queue ในเส้นทางนี้
7. **Photo pipeline ทิ้ง JOB ที่อ่านได้เมื่อสินค้ายังอ่านไม่ได้:** final return ของ target `TICKET` คืนเฉพาะ products แทนการคืน partial JOB; Kiro พบ 18 ใบที่ production คืนว่างหลังใช้ 5.4–15.1 วินาที แต่ full1600 อ่าน JOB ได้ ต้องรักษา partial payload ที่ผ่านการตรวจไว้ และแยกสถานะ "ยังขาดสินค้า" ออกจาก "อ่านไม่ได้ทั้งใบ" ข้อนี้เป็น photo fallback ไม่ใช่พฤติกรรมของ live `onBarcode` ที่เก็บแต่ละ field อยู่แล้ว

ระบบมี WASM, photo worker, cancellation, checksum/isValid, crop, หมุนมุมเล็ก, แก้แนวโค้ง, การแยก field, dedup callback และ review flag สำหรับ single-scanline rescue อยู่แล้ว ดู [primary-source review](../research/scanning-decoder-options-2026-10-16.md) การเปลี่ยน library อย่างเดียวจึงยังไม่ตอบปัญหาทั้งหมด

## Mobile architecture to validate

ข้อเลือกสำหรับ implementation รุ่นแรกคือ **WASM hard เต็มเฟรมความละเอียดใกล้ 1920 เป็น portable core โดยรักษา legacy location fallback ใน worker** ไม่ใช่แทน legacy ด้วย ROI prototype ที่ยังอ่านได้น้อยกว่า ปรับ cadence/budget ตามผลบนโทรศัพท์ ไม่เลือก fixed center ROI หรือ 1080 เป็น default จาก speed เพียงอย่างเดียว ใช้ decoder service ชุดเดียวที่มี **worker หนึ่งตัวต่อ scanner session** และ init WASM ล่วงหน้าขณะเปิด scanner รับเพียงเฟรมล่าสุดเมื่อ worker ว่างด้วย `requestVideoFrameCallback` หรือกลไก fallback ตาม capability; ไม่ต่อคิวเฟรมเก่าและไม่แปลงทุกเฟรมเป็น JPEG เพื่อส่งกลับเข้าตัวอ่าน

อ่าน Code128/QR ตามงานที่ contract รองรับจริง เริ่มจาก pixels ที่มีต้นทุนจำกัด โดยทดสอบกรอบเล็งกับ full frame บน framing เดียวกัน ต้องมี full-frame recovery เป็นระยะเพื่อไม่พลาดรหัสนอกกรอบ และคง candidates/ตำแหน่งไว้เมื่อเห็นหลาย identity ไม่ยอมรับผลแรกแบบเงียบ ๆ

เมื่อ target ยังไม่ครบจึงลอง ROI ที่หาจากภาพ/มุมที่ประมาณได้ หรือ targeted JS fallback ใน worker ด้วย budget ที่วัดบนเครื่องจริง สำหรับตำแหน่งควรรักษาเส้นทางที่อ่านป้ายได้เฉพาะ legacy reader และตรวจ canonical location ก่อนรับผล รูปแบบ native-first/WASM/targeted-JS ทั้งชุดนี้ **ยังไม่ถูกวัดเป็น pipeline เดียว** ต้อง A/B เพิ่ม หากใช้ fast-pass scheduling การสลับไป hard ต้องอิง field ที่ยังขาด ไม่ใช่มี QR ใด ๆ แล้วถือว่าทั้งใบสำเร็จ

ไม่ใช้ photo rescue 140 attempts กับทุกเฟรม ถ้ายังอ่านไม่ได้ให้ผู้ใช้หยุดภาพ/ถ่ายใกล้ขึ้น/หลบแสง แล้วค่อยใช้ still-image rescue ที่มี cancel หรือ OCR/AI ตามความจำเป็น การแก้โค้งหรือ single-scanline ยังต้อง review

ปัจจุบัน `LocationPicker.onScan` ตรวจผ่าน `resolveJobScanLocation` ใน warehouse อยู่แล้ว และกันผล lookup เก่าด้วย version เมื่อไม่พบจะหยุดกล้องและเสนอข้อความที่อ่านได้ให้ผู้ใช้ตรวจ/สร้างตำแหน่ง ไม่ได้บันทึก location ผิดอัตโนมัติ งานใหม่จึงเป็นการคัด candidate ให้ตรง target และเพิ่มหลักฐานก่อนถือว่าการสแกนสำเร็จ โดยคง server validation/authorization ที่มีอยู่

แยกความมั่นใจของข้อมูล: checksum-valid decoder payload, การอ่านตัวอักษรด้วย OCR/AI และการที่รหัสตรงกับ warehouse/master data เป็นหลักฐานคนละประเภท ผลเสี่ยงหรือ engines ขัดกันอาจใช้เฟรมที่สองยืนยัน; การอ่านหลายครั้งด้วยรอยเสียหายเดิมไม่ได้รับประกันว่าเป็นคนละหลักฐาน ห้าม auto-correct รหัสตามรูปแบบที่เดาไว้

ใช้ `BarcodeDetector` เป็น optional accelerator เมื่อมี format ที่ต้องการและผลทดสอบ device สนับสนุน คง WASM path สำหรับ Android/iPhone ทั้งคู่ ไม่ผูกระบบกับ API นี้ เพราะการรองรับไม่ได้เหมือนกันทุก browser

เมื่อ Stop/Back/เปลี่ยนงาน ต้อง terminate/ยกเลิกงานที่ค้าง ปล่อย stream/bitmap และกันผลเก่าด้วย generation/job ID; เมื่อเปิดใหม่จึงสร้าง worker อีกครั้ง การ reuse worker ต้องคงการยกเลิก synchronous WASM ที่ระบบเดิมทำได้

## Rollout and remaining acceptance checks

1. แก้ identity routing ที่พิสูจน์ว่าขัดกับ dataset และสร้าง regression cases สำหรับ FO/FOM, QR ที่เป็น JOB, product-only, location, wrong-kind และหลายรหัส โดยยืนยัน contract รูปแบบจริง
2. เปลี่ยน live path แบบแยก flag แล้ว A/B เทียบรุ่นเดิม: same scene/framing, time-to-first-correct-result, precision/recall, UI long tasks/frame gap, no-read/timeout, battery/thermal และอัตราที่ต้องกู้ภาพนิ่ง
3. ทดสอบ Android/Chrome และ iPhone/Safari อย่างน้อยเครื่องที่ใช้จริงหนึ่งรุ่นต่อฝั่ง: กล้องหน้า/หลัง, ขอสิทธิ์/ปฏิเสธ, focus/torch เมื่อรองรับ, orientation, background/foreground, Stop/Cancel แล้วเริ่มใหม่, pending decode และผลเก่า, locale/query/hash/Back contracts หากเปลี่ยน workflow
4. แยก test cases ชุดข้อมูลใหม่ที่ไม่เคยใช้ปรับ pipeline รวม damaged/blur/glare/tiny/off-center/หลายรหัส/ไม่มีรหัส ไม่ใช้ภาพซ้ำหรือภาพดัดแปลงเป็น independent samples
5. เพิ่ม metrics ที่ไม่บันทึกภาพ/รหัสธุรกิจโดยไม่จำเป็น: worker/init, capture/preprocess, detect/decode, attempts ที่นับ engine calls จริง, reject reason, correctable no-read และ end-to-end; ตั้งเป้าตาม baseline มือถือจริง ไม่แปลงตัวเลข M1 Max เป็นคำรับประกันมือถือ

รายละเอียดวิธีทดลองและ raw evidence อยู่ใน [รายงานรูปนิ่ง](topgold-scanning-kiro-2026-10-16.md) และ [รายงานเฟรมกล้อง](topgold-mobile-scanning-kiro-2026-10-16.md) ส่วนการเปลี่ยน production และการปล่อยใช้งานยังเป็นงานถัดไป
