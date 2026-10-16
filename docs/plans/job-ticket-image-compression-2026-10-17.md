# แผนลดขนาดรูปใบงานก่อนอัปโหลด

วันที่: 2026-10-17

สถานะ: implement ระยะแรกสำหรับรูปใหม่แล้วบน main baseline `2ee94968`; ดูผลตรวจจริงและข้อจำกัดใน [verification report](../reviews/job-ticket-image-compression-2026-10-17.md) ตารางสำรวจด้านล่างบันทึก working tree ตอนวางแผน ซึ่งเก่ากว่า baseline ที่ใช้ implement ส่วนงาน backfill/thumbnail ยังเป็นแผน

## เป้าหมายและขอบเขต

ลดพื้นที่จัดเก็บและข้อมูลที่ส่งตอนอัปโหลด โดยยังอ่านรายละเอียดใบงานเมื่อเปิดรูปเต็มได้ เริ่มจากรูปใบงานในหน้า Job Scan ซึ่งเป็นเส้นทางที่อัปโหลดเข้า UploadThing จริง

ระยะแรกคงด้านยาวสูงสุด 2,000 พิกเซล ทดลอง WebP และส่ง JPEG แบบเดิมให้ AI อ่านต่อไป แยกไฟล์สำหรับจัดเก็บออกจากไฟล์สำหรับ AI ภายใน browser จึงไม่ต้องเสี่ยงเปลี่ยน input ของ AI พร้อมกับรูปที่บันทึก และอัปโหลดเพียงไฟล์เดียวต่อรูปตามเดิม

รูปป้าย Location และการสแกนบาร์โค้ดมี pipeline ของตัวเอง ไม่รวมในการเปลี่ยน codec ระยะแรก ส่วน thumbnail และรูปเก่ามีแผนต่อยอดแยกด้านล่าง

## สิ่งที่ตรวจพบ

| จุดในระบบ                                                                                   | พฤติกรรมปัจจุบัน                                                                                         | ผลต่อแผน                                                                                      |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [JPEG baseline fixture](../../tests/fixtures/job-ticket-jpeg-baseline.ts)                   | เดิมย่อด้านยาวไม่เกิน 2,000 px, ไม่ขยายภาพ, JPEG quality 0.85                                            | ย้าย baseline สำหรับเทียบ bytes ไป test fixture; runtime ใช้ prepareJobTicketPhoto            |
| [JobScanScreen.tsx](../../src/features/finishedGoods/jobScan/JobScanScreen.tsx)             | ใช้ไฟล์ที่ย่อแล้วไฟล์เดียวกันอัปโหลดและส่ง AI พร้อมกัน                                                   | แยก `aiFile` กับ `uploadFile`; รักษาการจัดการ AI/upload failure แยกกัน                        |
| [PhotoCapture.tsx](../../src/features/finishedGoods/jobScan/PhotoCapture.tsx)               | กล้องสร้าง JPEG quality 0.9 ก่อนส่งเข้า resize; gallery รับ image/* สูงสุด 25 MiB; ครั้งละไม่เกิน 20 รูป | ทดสอบทั้งกล้องและ gallery; ยังไม่เปลี่ยนการถ่ายภาพพร้อมกับ codec; ตรวจ memory เมื่อรับหลายรูป |
| [UploadThing core](../../src/app/api/uploadthing/core.ts)                                   | หนึ่งภาพต่อ request, เพดาน 16MB                                                                          | ตรวจขนาดไฟล์ที่จะส่งจริงและการยอมรับ WebP บน staging                                          |
| [extractJobTicket](../../convex/finishedGoods/jobScans.ts)                                  | ยอมรับ JPEG/PNG/WebP data URL; จำกัด string ยาวไม่เกิน 4,000,000 ตัวอักษร                                | เพดาน AI ไม่ใช่เพดาน upload; ตรวจ data URL จริงก่อนเรียก ไม่เพิ่มเพดานเพื่อแก้ขัด             |
| [schema.ts](../../convex/schema.ts)                                                         | เก็บ URL ใน optional `imageUrl`                                                                          | ระยะแรกยังใช้ field เดิมได้ ไม่ต้อง migrate schema                                            |
| [JobScanPhotoPreview.tsx](../../src/features/finishedGoods/jobScan/JobScanPhotoPreview.tsx) | thumbnail และ dialog ใช้ source เดียวกัน                                                                 | WebP ลด bytes ของทั้งสองจุด; thumbnail แยกจะช่วยการโหลดรายการเพิ่มในงานภายหลัง                |
| [prepareLocationImage.ts](../../src/features/finishedGoods/jobScan/prepareLocationImage.ts) | crop/ย่อสำหรับ AI Location ต่างหาก; มี abort และขอบเขต pixel                                             | รักษา pipeline นี้และบาร์โค้ดเดิม; `toDataUrl` ยังต้องใช้ได้กับ caller เดิม                   |

Working tree มีงานอื่นแก้ไขอยู่หลายไฟล์ รวมถึง JobScanScreen และ PhotoCapture ก่อนเริ่ม implementation ต้องอ่าน diff ล่าสุดและแยกเฉพาะงานนี้ ไม่ทับหรือรวมงานอื่นโดยอัตโนมัติ

## แนวทาง implementation ที่เลือก

### 1. วัดคุณภาพด้วยรูปจริงก่อนเลือกค่า WebP

- เทียบ JPEG เดิมที่ 2,000 px / 0.85 กับ WebP ที่ความละเอียดเดียวกัน ทดลอง quality 0.85 และ 0.90 เป็นจุดเริ่มต้น ค่า quality คนละ codec ไม่ใช่หลักฐานว่าคุณภาพเท่ากัน
- ใช้รูปใบงานจริงอย่างน้อย 30 รูปที่ไม่ซ้ำ ครอบคลุมตัวหนังสือไทยเล็ก ตาราง รหัสสินค้า บาร์โค้ด แสงน้อย กระดาษเอียง และรายละเอียดสี; เพิ่มกรณี rotation, PNG โปร่งใส, รูปเล็กและรูปที่บีบอัดมาแล้ว
- ใช้ชุดข้อมูล Topgold เดิมได้เมื่อไฟล์ยังอยู่ในเครื่องและเป็นเอกสารที่เหมาะกับการประเมินใบงาน ไม่ถือว่ารายงาน barcode เดิมเป็นผลทดสอบ compression/OCR; ผลวัดรอบนี้และการแบ่งชุดภาพอยู่ใน verification report
- เก็บผลต่อภาพ: source/baseline/candidate bytes, ขนาดภาพ, MIME ที่ได้จริง, เวลาแปลง และผลตรวจอ่านรายละเอียดที่ตำแหน่งเดียวกัน
- ตรวจรหัสและตัวเลขสำคัญกับค่าที่ทราบจริง หาก JPEG baseline อ่านได้แต่ candidate อ่านไม่ได้ ให้ถือว่า candidate ไม่ผ่าน แม้ภาพรวมจะดูคล้ายกัน
- ทดสอบ barcode จากรูปที่บีบอัดด้วย decoder เดียวกันเพื่อวัดความอ่านได้ โดยไม่เปลี่ยน production barcode pipeline
- แยกข้อมูลที่ใช้ปรับค่าออกจากชุดยืนยันผล ไม่ปรับค่าเฉพาะรูปแล้วรายงานเหมือนเป็น policy ทั่วไป

ผลส่งมอบ: รายงานก่อน/หลังพร้อม crop เปรียบเทียบและค่าที่เลือก ไม่มีการรับประกันเปอร์เซ็นต์ประหยัดก่อนวัด

### 2. เตรียม JPEG สำหรับ AI และ WebP สำหรับจัดเก็บจากภาพที่ decode เดียวกัน

เพิ่ม helper เฉพาะงานใบงาน เช่น `prepareJobTicketPhoto.ts` โดยซ่อน canvas และอายุทรัพยากรไว้ใน helper ให้ caller ใช้ `aiFile` ได้ทันทีเมื่อ JPEG พร้อม ส่วน `uploadFile` เป็นผลลัพธ์ asynchronous อีกช่วงหนึ่ง ห้ามรอ WebP พร้อมทั้งคู่ก่อนคืน JPEG ให้ caller; เก็บข้อมูลขนาด/เวลาเท่าที่ใช้วัดผลจริง

- Decode และ draw ครั้งเดียว คง aspect ratio, ไม่ crop, ไม่ขยายรูป และคงเพดานด้านยาว 2,000 px
- สร้าง JPEG baseline สำหรับ AI ตามค่าปัจจุบัน ส่งต่อให้เริ่ม data URL/AI request ก่อนเริ่มงาน WebP เพิ่ม จากนั้นสร้าง WebP candidate จาก canvas เดียวกันใน upload branch หลีกเลี่ยง JPEG → WebP หลายทอดโดยไม่จำเป็น; helper ต้องจัดการ cleanup ครอบคลุมทั้งสองช่วงแม้ caller ยกเลิกหรือไม่ใช้ผล upload
- เลือก WebP เฉพาะเมื่อ encoder คืน MIME `image/webp` จริงและไฟล์เล็กกว่า JPEG baseline อย่างน้อย 15%; มิฉะนั้นใช้ JPEG baseline ตัวเดิม ค่าใช้งานสุดท้ายเป็น quality 0.90 เพื่อรักษารายละเอียดและหลีกเลี่ยงการเปลี่ยน format เพื่อผลประหยัดเล็กน้อย ดูผล calibration/ข้อจำกัดใน verification report
- ตรวจ `blob.type` ก่อนตั้งชื่อ/นามสกุล ไม่สร้างไฟล์ชื่อ `.webp` ที่ bytes จริงเป็น PNG; `toBlob` อาจ fallback เป็น PNG เมื่อไม่รองรับ format
- หาก WebP encoding ล้มเหลว แต่ JPEG สำเร็จ ให้ upload และ AI ทำงานต่อด้วย JPEG
- หาก decode/draw/JPEG ล้มเหลว ห้ามอัปโหลดภาพว่างหรือคืนไฟล์เดิมแบบไม่ตรวจสอบ ใช้ไฟล์เดิมเป็น fallback ได้เฉพาะ type/ขนาดที่แต่ละปลายทางยอมรับ; กรณีอื่นจบสถานะ reading ด้วย notice ที่แก้ข้อมูลเองได้
- ตรวจ dimension และจำกัด output canvas ด้วยด้านยาว 2,000 px คงการรับภาพ 48MP ที่ gallery เคยรองรับ ไม่เพิ่มเพดาน decoded pixel 40MP ตามข้อเสนอแรก เพราะจะทำให้ภาพที่เคยใช้ได้ถูกปฏิเสธ; input file ยังมีเพดานเดิม 25 MiB และ decode รูปเต็มยังใช้ memory ตามขนาดภาพ
- คืน bitmap, canvas และ object URL ที่ helper เป็นเจ้าของใน `finally`; preview ของ workflow ต้องไม่ถูก revoke ก่อนผู้ใช้เลิกใช้
- กำหนดพฤติกรรม orientation และ transparency ให้ JPEG baseline และ WebP เหมือนกัน ทดสอบ PNG ที่มี alpha ก่อนกำหนดว่าจะ flatten พื้นหลังสีขาวหรือใช้เส้นทางเดิม; การแก้ผลภาพต่างจาก baseline ต้องมีผลเปรียบเทียบรองรับ
- ไม่เพิ่ม library, Worker หรือบริการแปลงรูปใหม่ในรอบแรก หากผลวัดบนมือถือชี้ว่าต้องย้าย encoding ออกจาก main thread ค่อยเพิ่มในงานเฉพาะ

ลบ runtime `resizeImage` ที่ไม่มี caller แล้ว เก็บเฉพาะ [imageDataUrl.ts](../../src/features/finishedGoods/jobScan/imageDataUrl.ts) ที่ Job Scan และ Location ใช้จริง; การเปลี่ยนชื่อ import ต้องไม่ทำให้ Location caller เปลี่ยนพฤติกรรม

### 3. เชื่อมกับ workflow อัปโหลด

ใน `JobScanScreen.onPhoto` เริ่ม `toDataUrl(aiFile)`/`extract` ทันทีที่ JPEG baseline พร้อม ขณะเดียวกัน upload branch จึงเตรียม WebP และเรียก `startUpload` เมื่อเลือก `uploadFile` ได้แล้ว AI ต้องไม่ await WebP encoding, คิว WebP หรือการอัปโหลด

การประมวลผลของ AI ใช้ input เดิม แต่ยังรับประกันเวลาเท่าเดิมทุกครั้งไม่ได้ เพราะ CPU/เครือข่ายบนเครื่องใช้ร่วมกันและ provider มีความแปรปรวน หน้าจอยังรอทั้ง AI กับ upload จบก่อนอัปเดต ticket ตามพฤติกรรมเดิม จึงต้องวัดทั้งเวลาเริ่มส่ง AI, เวลา AI จบ และเวลาที่ผู้ใช้เห็น ticket พร้อมแยกกัน

- ตรวจ upload file กับเพดาน UploadThing และ data URL ของ AI กับขอบเขต 4,000,000 ตัวอักษรแยกกัน รวม prefix/base64 แล้ว ขนาดไฟล์ binary อย่างเดียวไม่พอ
- ระบุ error ของ branch ที่ใช้ไม่ได้ โดยยังปล่อยอีก branch ทำงานได้ตามพฤติกรรมเดิม เช่น upload ล้มเหลวไม่ควรหยุด AI; AI ล้มเหลวยังบันทึกภาพและกรอกข้อมูลเองได้
- การแปลงเพิ่มต้องไม่สร้าง ticket ซ้ำ ข้ามเพดานกลุ่ม หรือทำให้ค้าง reading; callback ที่กลับหลังลบ draft/ออกจาก workflow ต้องไม่เรียก upload/AI ใหม่หรือคืนข้อมูลเข้า draft ที่ถูกทิ้ง
- จำกัดงาน WebP เพิ่มไม่เกิน 2 รูปต่อ workflow และวัด batch 20 รูป ให้การเตรียม JPEG/ส่ง AI มีลำดับความสำคัญก่อน WebP; ห้ามให้คิว WebP ขวาง JPEG ของรูปถัดไป วัดภาระ decode ของ batch เทียบ baseline ก่อนจำกัดคิว JPEG เพราะการเปลี่ยนนั้นอาจเพิ่มเวลารอ AI เอง แยกคิวประมวลผลภาพจาก upload/AI เพื่อไม่รอเครือข่ายในช่อง encode
- รักษา preview, สถานะ error, draft protection และ completion owner เดิม เพิ่มข้อความแปลไทย/อังกฤษเฉพาะที่ข้อความเดิมอธิบายสาเหตุไม่ได้
- ไม่เก็บ bytes หรือ base64 ใน Convex; อัปโหลดเฉพาะไฟล์ที่เลือกหนึ่งชุดต่อรูป เก็บ `imageUrl` ที่ provider ส่งกลับตามเดิม

ไม่เพิ่มหน้า/foreground ใหม่ หากเพิ่ม render-controlling state หรือเปลี่ยน semantic target ของสถานะเดิม ต้องทบทวน [Back contract](../contracts/back-navigation.md) และ [inventory](../contracts/back-navigation.json) ตาม caller จริง

### 4. ทดสอบและเปิดใช้งาน

Tests ที่เพิ่มต้องตรวจพฤติกรรมสำคัญ ไม่ใช้ mock canvas เป็นหลักฐานคุณภาพ encoder:

| ชั้น          | สิ่งที่ต้องพิสูจน์                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helper        | ไม่ขยาย/ไม่ผิดอัตราส่วน; เลือก WebP เมื่อเล็กกว่า; fallback MIME/encoder/null context; ตั้งนามสกุลถูก; คืนทรัพยากร; ไฟล์ใหญ่/อ่านไม่ได้ไม่กลายเป็นภาพว่าง                                                 |
| JobScanScreen | upload ได้ candidate, AI ได้ JPEG baseline; สำเร็จ/ล้มเหลวแยก branch; ไม่ค้าง reading; batch และ late completion ไม่คืน draft ที่ทิ้งแล้ว                                                                 |
| Browser จริง  | JPEG/PNG/WebP, alpha, EXIF orientation, รูปเสีย, WebP fallback และรูปจากกล้อง/คลังภาพ; ตรวจ bytes ของไฟล์ที่ส่งจริง                                                                                       |
| Staging       | เลือกรูป → บีบอัด → UploadThing → AI → ตรวจ/บันทึก → เปิดรายการและรูปเต็ม → refresh; ทดสอบ URL รูป JPEG เดิมร่วมกับ WebP ใหม่                                                                             |
| มือถือ        | Chrome Android และ Safari iPhone จริง; ทดสอบ batch 20 รูป ความลื่นของหน้าจอ memory และเวลาเพิ่มจาก encoding; desktop WebKit ไม่ทดแทน iPhone                                                               |
| Back/draft    | ใช้ caller tests เดิมของ JobScan/PhotoCapture/preview และเพิ่มกรณี Back/ยกเลิกระหว่างคิวกับหลัง encoding; รวม next Back, direct link, locale/query/hash, pending save, Forward และ remount ตามผลกระทบจริง |

ไฟล์ทดสอบหลัก: `prepareJobTicketPhoto.test.tsx` (อยู่ใน Vitest project `unit` ที่มี jsdom), `JobScanScreen.test.tsx`, `JobScanScreen.capacity.test.tsx`, `PhotoCapture.test.tsx`, `JobScanPhotoPreview.test.tsx` และ provider/integration tests ที่เกี่ยวข้องเมื่อแก้ validation ฝั่ง backend

ชุดตรวจเมื่อ implement: targeted Vitest ของ caller/helper ที่เปลี่ยน, `pnpm typecheck`, `pnpm lint`, `pnpm check:navigation` และ formatting ของไฟล์ที่แก้ รวมถึง browser/staging flow ข้างต้น Static checks และ mock AI ไม่ใช่หลักฐานว่าคุณภาพรูปผ่าน

### เกณฑ์ผ่านก่อนใช้จริง

- ไม่มีภาพที่เลือกไป upload ใหญ่กว่า JPEG baseline ของภาพนั้น; MIME, rotation, aspect ratio และรายละเอียดสำคัญถูกต้อง
- ตั้งเป้าลดขนาดมัธยฐานอย่างน้อย 20% เทียบ JPEG baseline บนชุดยืนยันผล นี่คือเป้าหมายวัดผล ไม่ใช่ตัวเลขที่พิสูจน์แล้ว หากไม่ถึงให้รายงานผลและประเมินความคุ้มค่าก่อนเปิด
- ไม่มีรหัส/ตัวเลขที่ baseline อ่านได้แล้ว candidate ทำให้ผิดหรือหายบนชุดยืนยันผล; barcode ที่ baseline อ่านได้ต้องอ่านได้เหมือนเดิมบนชุดนั้น ข้อสรุปจำกัดอยู่ที่ชุดที่ทดสอบ
- AI รับ JPEG baseline ตามเดิม และความล้มเหลวของการบีบอัดเพิ่มไม่หยุดการทำงานที่ JPEG เดิมทำได้ เพิ่ม regression case ที่ค้าง WebP promise ไว้แล้วพิสูจน์ว่า AI request เริ่มได้ก่อนปล่อย promise
- บันทึก p50/p95 แยกสำหรับเวลาเลือกรูปจนเริ่ม AI request, เวลา AI request จนจบ, เวลา WebP/upload และเวลาจน ticket พร้อม เทียบ baseline บนมือถือเครื่องเดียวกันและทดสอบซ้ำเพื่อลดผลจาก provider/เครือข่าย เป้าหมายคือเวลาเริ่ม AI และเวลาเห็นผลไม่ถดถอยอย่างมีนัยสำคัญจากงาน WebP; ไม่มี crash/คิวค้างเมื่อเลือก 20 รูป หากวัดพบ regression ต้องปรับ scheduling หรือลด/ปิด WebP ก่อนเปิดจริง
- ทั้งรูปเก่า/ใหม่เปิดได้หลัง refresh และมีผล staging จริงก่อน deploy

เปิดตามลำดับ local → staging → production ผ่านขั้นตอน release ปกติ ใช้ policy เดียวที่เปลี่ยนกลับเป็น JPEG ได้ หากต้อง rollback ให้หยุดสร้าง WebP ใหม่ แต่ยังอ่าน URL WebP ที่บันทึกไปแล้วได้ ไม่ย้อน schema หรือแปลงไฟล์กลับ

## งานต่อยอดที่แยกจาก release แรก

### Thumbnail แยกสำหรับหน้ารายการ

พิจารณาหลังวัดจำนวน bytes ที่หน้ารายการโหลดจริง เพิ่ม thumbnail ด้านยาวประมาณ 160–240 px สำหรับรายการและโหลดรูปอ่านเต็มเมื่อเปิด dialog เท่านั้น ต้องออกแบบ optional thumbnail reference, API/list result, อัปโหลดสองไฟล์โดยไม่ทำให้สำเร็จครึ่งเดียวสูญหาย และ cleanup/backup แยก

การเพิ่ม thumbnail ช่วย bandwidth ตอนดูรายการ แต่เพิ่มไฟล์ที่จัดเก็บ จึงไม่ควรนำไปรวมเป็นตัวเลขลด storage ของ release แรก การย้าย provider เช่น R2 เป็นงานสถาปัตยกรรมแยกต่างหาก

### แปลงรูปที่อัปโหลดไปแล้ว

1. ทำ inventory แบบ read-only: จำนวนไฟล์จริง ขนาด format จำนวน record ที่อ้าง URL เดียวกัน และสิทธิ์เข้าถึง provider ที่ใช้งานจริง ประเมิน bytes ที่ประหยัดได้เทียบค่าอ่าน/เขียน/ประมวลผล
2. แปลงจากไฟล์ที่เก็บอยู่โดยตรง ไม่ย่อซ้ำหลายทอด รักษาความละเอียดเดิมในรอบแรก และใช้ quality gate สำหรับ source ที่เป็น JPEG บีบอัดแล้วโดยเฉพาะ ไม่อ้างผล WebP จากรูปกล้องเป็นหลักฐานคุณภาพ backfill
3. สร้าง dry-run manifest ที่มี reference ของ tenant/record, URL/file key เดิมและใหม่, hash, bytes และสถานะ; ดาวน์โหลดแล้วแปลงซ้ำได้อย่าง idempotent โดยเก็บข้อมูลเข้าถึงไฟล์ไว้ในที่ควบคุม
4. อัปโหลดไฟล์ใหม่ ตรวจ MIME/ขนาด/เปิดอ่าน และแทนที่เฉพาะเมื่อเล็กลงและผ่านคุณภาพ อัปเดต reference แบบมีเงื่อนไขว่า URL เดิมยังไม่เปลี่ยนเพื่อไม่ทับการแก้ไขล่าสุด; ไม่มีการแก้จำนวนสินค้า/ข้อมูลใบงาน
5. รันเป็น batch จำกัด concurrency มี checkpoint/retry และ rollback mapping ตรวจ record และ tenant scope ทุกครั้ง รวมทุก reference ที่ชี้ไฟล์เดียวกัน
6. เก็บไฟล์เดิมไว้ระหว่างตรวจสอบและช่วง rollback แยกการลบเป็นขั้นตอนภายหลัง ต้องพิสูจน์ว่าไม่มี reference เหลือและมี backup/retention ที่กู้ได้ การประหยัด storage สุทธิเกิดหลังเลิกเก็บสำเนาเดิม ไม่ใช่เพียงหลังแปลงสำเร็จ

การ implement ระยะแรกไม่เรียก migration หรือเปลี่ยน reference ของรูปเก่าใน production

## ลำดับชุดงานสำหรับ implementation

1. **Benchmark และ policy:** ชุดภาพ/ตัววัด/รายงาน เปรียบเทียบ JPEG กับ WebP และล็อกค่าที่ผ่าน
2. **Helper และ tests:** การเตรียมภาพจาก canvas เดียว เลือกไฟล์ fallback/limits/cleanup และคิวประมวลผลขนาดเล็ก
3. **Workflow integration:** แยก input AI/upload, ทดสอบ failure/batch/lifecycle และข้อความที่จำเป็น
4. **Staging และ release evidence:** ผลมือถือ/เปิดรูปที่เก็บจริง/Back และ draft checks/rollback ผ่านขั้นตอน release ปกติ
5. **ประเมินงานต่อ:** ใช้ bytes ที่วัดได้ตัดสิน thumbnail และ backfill ไม่ผูกงานเหล่านี้เป็นเงื่อนไข release ของรูปใหม่

## เอกสารอ้างอิง

- [Google WebP](https://developers.google.com/speed/webp): มีทั้ง lossy/lossless; ผลเปรียบเทียบของ Google เป็นบริบท ไม่ใช่ผลวัดระบบเรา
- [Canvas toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob): format fallback, blob null และ quality parameter
- [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap): decode และ orientation options
- อ่าน Next.js image guide ที่ติดตั้งจริงแล้ว: `node_modules/next/dist/docs/01-app/01-getting-started/12-images.md`; การ optimize ตอนแสดงผลไม่ลด bytes ของต้นฉบับที่เก็บใน UploadThing จึงไม่ใช่งานหลักของแผนนี้
