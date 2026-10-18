# ทางเลือกปรับความเร็วและความแม่นยำของ barcode / QR decoder

ตรวจวันที่ 2026-10-16 จาก production source และเอกสารต้นทาง ไม่มีการแก้ production code หรือส่งภาพ dataset ไปยังบริการภายนอก เอกสารนี้เป็นการวิเคราะห์สถาปัตยกรรมและข้อเสนอสำหรับทดลอง **ไม่ใช่ผล benchmark ของ dataset** ตัวเลขความเร็วและ accuracy ต้องอ้างอิงผลทดลองแยกต่างหาก

## สิ่งที่ระบบทำอยู่แล้ว

| ส่วน                | หลักฐานใน code                                                   | ความหมาย                                                                                              |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Engine ภาพ          | `package.json`: `zxing-wasm` 3.1.5; `barcodeImagePipeline.ts:69` | ใช้ ZXing-C++ WASM อยู่แล้ว การเสนอเพียง “เปลี่ยนเป็น WASM” จึงไม่ใช่งานใหม่                          |
| Worker และการยกเลิก | `barcodeImage.ts:26–89`, `barcodeImage.worker.ts`                | มี worker แยกต่อภาพ, terminate เมื่อเสร็จ/ยกเลิก, hard timeout 20 วินาที, จำกัดภาพ 16 ล้านพิกเซล      |
| จำกัดชนิดรหัส       | `barcodeImagePipeline.ts:153`                                    | เริ่มด้วย Code128 และ QR; ถ้าภาพเต็มไม่พบผล จึงมี pass ทุก format                                     |
| แก้ geometry        | `barcodeImagePipeline.ts:13–61,274–331`                          | crop แถบซ้อนกัน, หมุนทีละ 2° ถึง ±10°, และแก้แนวบาร์โค้งใน crop ที่คาดว่าจะมี product barcode         |
| หาตำแหน่งบาร์       | `barcodeImagePipeline.ts:235–269`, `barcodeRegions.ts`           | มี detector จาก pattern ภาพทั้งแนวตั้ง/นอน แต่ใน WASM pipeline ใช้เฉพาะ target `ANY`                  |
| ตรวจผล              | `barcodeImagePipeline.ts:195–217`                                | รับ WASM เฉพาะ `isValid`; แยก JOB/product, เก็บรหัสไม่ซ้ำ; ผลจากแก้เส้นโค้งต้อง review                |
| กล้องสด             | `useBarcodeCamera.ts:85–193`                                     | JS ZXing, ขอภาพ 1920×1080, เว้นแต่ละ attempt 100 ms, กันส่งรหัสเดิม 1 วินาที, torch ตาม capability    |
| กล้อง fallback      | `useBarcodeCamera.ts:112–145`                                    | ไม่ซ้อน fallback หลายตัว; ทุกอย่างน้อย 1.5 วินาทีลองภาพเต็มผ่าน JS crop/deskew ด้วย budget 1.2 วินาที |
| Decoder JS reuse    | `barcodeDecoder.ts:40–60`                                        | ใช้ `setHints` และ `decodeWithState` แล้ว ไม่ควรเสนอสิ่งนี้เป็น gap                                   |

## งานที่ควรทดลองก่อน

ข้อเสนอในตารางเป็น **inference จาก source** และต้อง A/B กับข้อมูลจริง รวมถึงภาพที่ไม่มีรหัสและภาพหลายรหัส

| ลำดับ | ช่องว่างที่พบ                                                                                          | การทดลอง                                                                                                                               | สิ่งที่ต้องรักษา                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1     | `TICKET`/product ไม่ใช้ region detector ที่มีอยู่; หลัง full-frame miss จะค้นแถบที่ผูกกับตำแหน่งเอกสาร | หาตำแหน่งบนภาพย่อ แล้ว decode crop จากต้นฉบับก่อนวนทุกแถบ; จัดอันดับ candidate ด้วยความเป็นแนวบาร์                                     | คง fallback เต็มภาพ/แถบสำหรับ detector miss; ไม่ใช้ค่าใน filename หรือรหัสที่คาดหวังช่วยเดา                             |
| 2     | ทุก attempt เปิด `tryHarder: true`; ภาพ ticket เริ่ม decode เต็มความละเอียด                            | ทำ fast pass กับภาพย่อ/ROI แล้วค่อย hard pass ต้นฉบับ; บน crop ที่รู้ orientation ทดลองปิด `tryRotate` และ `tryInvert` เฉพาะ fast pass | อย่าลดทุกภาพจนแท่งเล็กหาย; ต้องลองต้นฉบับเมื่อ fast pass ไม่สำเร็จ                                                      |
| 3     | worker ถูกสร้างและทำลายใหม่ทุกไฟล์                                                                     | prewarm decoder เมื่อเข้าสู่ scanner; ทดลอง worker หนึ่งตัวต่อ session ที่ reuse WASM                                                  | ยกเลิก synchronous WASM ด้วย terminate ได้เหมือนเดิมและสร้างใหม่ภายหลัง; job ID ต้องกันผลเก่า; ปล่อย bitmap/canvas เสมอ |
| 4     | กล้องหลักเรียก `BrowserMultiFormatReader(undefined, ...)`; ไม่มี format hints                          | ใส่ hints ตามงาน; ทดลอง Code128/QR ก่อนสำหรับงานที่รองรับจริง; format อื่นค่อย fallback                                                | package scanner อาจมี symbology อื่น ต้องยืนยันจาก contract ก่อนจำกัด                                                   |
| 5     | camera decoder และ fallback ทำ canvas/JS decode บน main thread                                         | ทดลอง WASM worker สำหรับ live ROI; ส่งเฉพาะเฟรมล่าสุดเมื่อ worker ว่าง; วัด UI long tasks และเวลาถึงผลแรก                              | คง ownership/stop/cancel/torch และไม่ queue เฟรมย้อนหลัง                                                                |
| 6     | timestamp dedupe กันรหัสซ้ำ แต่ยอมรับผลแรกทันที                                                        | สำหรับผลเสี่ยง เช่น scanline เดียว/engine ขัดกัน ทดลองต้องได้ค่าเดียวกัน 2 เฟรม หรือให้ตรวจยืนยัน                                      | วัด false accept และ latency แยกกัน; อย่าเพิ่มการรอทุก QR โดยไม่มีหลักฐาน                                               |
| 7     | ไม่มี native detector ใน source                                                                        | ทดลอง `BarcodeDetector` เป็น optional fast path พร้อมตรวจ `getSupportedFormats()` และคง WASM fallback                                  | ความพร้อมและผลขึ้นกับ platform; ห้ามบังคับทุก browser ใช้ native                                                        |

## Decoder options ที่มีจริงในเวอร์ชันติดตั้ง

`zxing-wasm@3.1.5` เปิด `tryHarder`, `tryRotate`, `tryInvert`, `tryDownscale` โดย default; threshold downscale คือด้านสั้น 500 พิกเซลและ factor 3 การเพิ่ม “รองรับหมุน 90°/กลับสี/ภาพย่อ” จึงต้องตรวจ default ก่อน `tryRotate` หมายถึงมุมฉาก ไม่ใช่ deskew มุมเล็กที่ app ทำเองอยู่แล้ว ใช้ `tryHarder: false` เป็น fast pass ได้ ส่วน `minLineCount` default 2 คือจำนวน scanline ที่ต้องอ่านตรงกัน; ปัจจุบัน app ลดเหลือ 1 เฉพาะ curve pass และระบุ review แล้ว การลดเป็น 1 ทุก pass อาจเพิ่มผลบวกผิด ต้องวัดกับ negative controls `isPure` มีไว้สำหรับภาพรหัสเดี่ยวที่จัดตรงสมบูรณ์ ไม่เหมาะกับภาพถ่ายเอกสาร [source เวอร์ชัน 3.1.5](https://raw.githubusercontent.com/Sec-ant/zxing-wasm/v3.1.5/src/bindings/readerOptions.ts)

ส่วน binarization มี LocalAverage, GlobalHistogram, FixedThreshold และ BoolCast; ใน ZXing-C++ LocalAverage ใช้ local threshold สำหรับ matrix แต่ใช้ histogram สำหรับ linear barcode อยู่แล้ว ดังนั้นการเพิ่ม adaptive threshold ไม่ได้หมายความว่าจะช่วย 1D เสมอ ทดลอง contrast normalization/threshold เพียงหนึ่งหรือสอง variant **บน crop ที่ยังอ่านไม่ได้** แล้วเทียบ recall และ false accepts การทำทุก filter ทุกภาพจะเพิ่มต้นทุน [ZXing-C++ ReaderOptions](https://github.com/zxing-cpp/zxing-cpp/blob/master/core/src/ReaderOptions.h)

JS ZXing `TRY_HARDER` เพิ่มจำนวน scanline และพยายามหมุนมุมฉากเมื่อ source รองรับ; ไม่ได้แก้ perspective หรือความโค้งอัตโนมัติ งานถัดไปที่ต่างจากของเดิมคือประมาณมุมจาก candidate แล้วลองใกล้มุมนั้น แทนการกวาดทุกมุม เป็นข้อเสนอที่ต้อง benchmark [OneDReader v0.23.0](https://raw.githubusercontent.com/zxing-js/library/v0.23.0/src/core/oned/OneDReader.ts) ส่วน reuse readers ด้วย `decodeWithState` เป็นแนวทางที่ upstream แนะนำและระบบทำแล้ว [MultiFormatReader v0.23.0](https://raw.githubusercontent.com/zxing-js/library/v0.23.0/src/core/MultiFormatReader.ts)

## Crop, QR และคุณภาพภาพ

Google แนะนำให้ barcode มีจำนวนพิกเซลต่อหน่วยเพียงพอ ลด resolution เพื่อความเร็วโดยให้รหัสกินพื้นที่ส่วนใหญ่ จำกัด format และทิ้งเฟรมใหม่ขณะ detector ยังทำงาน; แนะนำ temporal consistency เมื่อผลแต่ละเฟรมไม่ตรงกัน ตัวเลขแนะนำ 2 พิกเซลต่อหน่วยเป็นคำแนะนำสำหรับ ML Kit ไม่ใช่เกณฑ์รับประกันของ ZXing แต่ใช้เป็นจุดเริ่มต้นทดลอง ROI scale ได้ ไม่ควรสรุปว่าลด resolution เท่าใดก็เร็วและแม่นขึ้น [ML Kit barcode guidance](https://developers.google.com/ml-kit/vision/barcode-scanning/android)

QR ต้องมี quiet zone สี่ modules รอบสัญลักษณ์ ดังนั้น crop ต้องมีขอบเผื่อ อย่าตัดชิด finder pattern; white padding อาจช่วยเมื่อภาพมีขอบว่างไม่พอ แต่สร้างข้อมูลที่เสียหาย/ถูกบังกลับมาไม่ได้ แยกชุดทดลอง QR ออกจาก 1D detector ซึ่งมองหาเส้นบาร์ [DENSO WAVE QR area](https://www.qrcode.com/en/howto/code.html)

ภาพที่เอียง perspective มากอาจใช้มุมกระดาษหรือ quadrilateral ของรหัสเพื่อ rectify ก่อนอ่าน เป็นงานใหม่จาก source ที่ตรวจพบ แต่ไม่ควรเริ่มด้วย document warp ทุกภาพ: ต้องเก็บภาพต้นฉบับไว้และ fallback เพราะการ resample อาจทำให้เส้นเล็กเสียรายละเอียด สำหรับภาพเบลอหรือ highlight บังรหัส ควรให้ feedback ให้ถ่ายใกล้ขึ้น/นิ่งขึ้น/หลบแสง แทนการวน 140 attempts กับข้อมูลที่หายไป ข้อนี้เป็นข้อเสนอทางวิศวกรรม ยังไม่ได้พิสูจน์จาก dataset

## ควรเปลี่ยน library หรือไม่

- **WASM:** ใช้อยู่แล้ว; upstream มี reader-only build และ `prepareZXingModule` สำหรับควบคุมการโหลด/init จึงเหมาะจะทดลอง session reuse ก่อนเพิ่ม dependency [ZXing WASM](https://github.com/Sec-ant/zxing-wasm)
- **Native BarcodeDetector:** ใช้ระบบตรวจจับของ platform, asynchronous และใช้ใน worker ได้ แต่ต้องตรวจ capability ราย format และใช้เป็น progressive enhancement; ยังสรุปไม่ได้ว่าจะเร็วกว่าหรือแม่นกว่าสำหรับ dataset นี้ [Chrome Shape Detection](https://developer.chrome.com/docs/capabilities/shape-detection)
- **html5-qrcode:** ยังไม่มีใน dependency/source ที่ตรวจพบ; implementation ใช้ ZXing JS และอาจสลับกับ native detector ไม่ใช่ decoder ใหม่ที่รับประกัน recall ดีกว่า WASM การเปลี่ยน wrapper ทั้งชุดจึงไม่ใช่ตัวเลือกแรก [official decoder shim](https://raw.githubusercontent.com/mebjas/html5-qrcode/master/src/code-decoder.ts)

## หลักฐานที่ต้องเก็บก่อนตัดสินใจ

ใช้ชุดภาพที่มี ground truth ว่าแต่ละภาพมีรหัสใดและควรอ่าน field ใด แยกตามรหัสเดียว/หลายรหัส/ไม่มีรหัส, QR/1D, เบลอ/สะท้อน/เอียง/โค้ง, ขนาดรหัสในภาพ และ template เอกสาร ห้ามนับรหัสที่ decode ได้เป็น ground truth ของตัวมันเอง

เก็บ correct exact-match, missing code, wrong identity/false accept, review-required, p50/p95 latency, timeout, attempts และเวลาแยก load/init/rasterize/detect/decode ทั้ง cold และ warm runs ปัจจุบัน `elapsedMs` เริ่มหลัง `prepareZXingModule` จึงไม่รวม startup WASM; `attempts` นับ canvas attempt แต่หนึ่ง attempt อาจเรียกหลาย engine และ branch LOCATION คืน `attempts: 1` แม้ JS fallback ค้นหลาย region การเปรียบเทียบต้องวัด end-to-end เพิ่ม ไม่อาศัยสอง field นี้อย่างเดียว

รันทดลอง geometry/scale/options ทีละเรื่องบน dataset เดียวกัน แล้วกันรูปจากเอกสารหรือเหตุการณ์เดียวกันให้อยู่ split เดียวกัน เพื่อไม่ให้ภาพเกือบซ้ำทำให้ผลดูดีเกินจริง ใช้ภาพที่ยังไม่เคยปรับ pipeline ให้เป็น held-out set และทดสอบกล้องจริงบนโทรศัพท์เป้าหมายเพิ่ม: ภาพนิ่งพิสูจน์ live frame rate, autofocus หรือเวลาจนจับรหัสไม่ได้
