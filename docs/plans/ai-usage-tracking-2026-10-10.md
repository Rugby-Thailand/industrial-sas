# แผนบันทึก AI usage และค่าใช้จ่าย

วันที่ 2026-10-10 · สถานะ: implementation และ local verification เสร็จแล้ว; ยังไม่ deploy production

ส่งมอบใน worktree `industrial-sas-ai-usage`, branch `codex/ai-usage-tracking` หน้ารายงานเปิด **เดือนนี้** ตามที่ผู้ใช้ยืนยัน และคงหน้าตาของแอปเดิม รายงานใช้เรทล่าสุดที่ผู้ดูแลบันทึกเพื่อประเมินทั้งช่วงที่เลือก โดย USD ไม่เปลี่ยนและ CSV ระบุ settings version มีรายละเอียดราย attempt ย้อนหลังใน CSV และคำสั่ง internal สำหรับตรวจ/สร้างยอดสรุปใหม่แบบ bounded ดูขั้นตอนเปิดใช้และข้อจำกัดใน [operating notes](../operations/ai-usage-tracking.md)

บันทึกจำนวนครั้งที่เรียก AI, จำนวน token และค่าใช้จ่ายที่ผู้ให้บริการรายงาน เพื่อดูยอดจริงแยกตามองค์กร ผู้ใช้ คลัง และฟีเจอร์ เริ่มจากการอ่านรูปใบงาน แล้วต่อ AI Search เข้ากับกลไกเดียวกัน แสดงยอดเป็นบาทพร้อมอัตราแลกเปลี่ยน และแยกค่าธรรมเนียมเติมเครดิตที่ประมาณไว้จากค่า AI จริง

หลักสำคัญคือ **บันทึกเมื่อเรียก AI ไม่รอให้ผู้ใช้กดบันทึกใบงาน** การอ่านแล้วปิดหน้า ลบรูป อ่านไม่สำเร็จ หรือเรียกซ้ำ อาจเกิดค่าใช้จ่ายแล้ว ต้องปรากฏในรายงานด้วย

## จุดที่ต้องเปลี่ยนจากระบบปัจจุบัน

- [extractJobTicket](../../convex/finishedGoods/jobScans.ts) เรียก OpenRouter หนึ่งครั้งต่อรูป และ retry อีกหนึ่งครั้งเมื่อได้ HTTP 5xx ปัจจุบันอ่านเฉพาะผลใน `choices` และทิ้ง `usage`, model และ generation ID
- [JobScanScreen](../../src/features/finishedGoods/jobScan/JobScanScreen.tsx) อ่านรูปพร้อมกับ upload และเก็บผลใน draft ก่อนบันทึกใบงาน การเก็บ usage ใน `saveJobScans` อย่างเดียวจึงทำให้ยอดตกหล่น
- [AI Search provider](../../convex/model/search/provider.ts) มี timeout และไม่ retry แต่ยังไม่บันทึก usage ส่วน `actionQuotas` นับเพื่อจำกัดการเรียก AI Search เป็นรายช่วงเวลา ไม่ใช่ประวัติค่าใช้จ่าย
- [actionWithOrg](../../convex/lib/tenantFunctions.ts) ส่ง context ที่ผ่าน authorization ให้ handler แต่ไม่ได้เปิด `runMutation` หรือฐานข้อมูล ต้องเพิ่มช่องทางบันทึก usage ที่จำกัดขอบเขตตาม tenant
- [schemaPolicy](../../convex/lib/schemaPolicy.ts) บังคับ tenant indexes และห้ามคำ `token`/`tokens` ในชื่อ field เนื่องจากนโยบายป้องกัน secrets ต้องออกแบบชื่อ metric ให้ผ่านนโยบายเดิม

## ขอบเขตส่งมอบ

1. เก็บ usage ของ `JOB_TICKET_SCAN` ทุกการเรียก provider รวม retry
2. ใช้กลไกเดียวกันกับ `AI_SEARCH` โดยแยกยอดและจำนวนครั้งจากสแกนรูป
3. มีหน้ารายงานสำหรับผู้ดูแลองค์กร: วันนี้ เดือนนี้ ค่าเฉลี่ยต่อรูป/คำค้น รายการย้อนหลัง และ CSV
4. ตรวจและแสดงรายการที่ข้อมูลค่าใช้จ่ายยังไม่ครบ พร้อมช่องทางเติมข้อมูลจาก provider เมื่อมี generation ID
5. การอ่านรูปป้ายตำแหน่ง (เพิ่มใน main) ใช้ ledger เดียวกันเป็นฟีเจอร์แยก `LOCATION_LABEL_SCAN` ไม่นับเป็น `JOB_TICKET_SCAN` และผูกกับใบงานที่บันทึกไม่ได้

Budget enforcement, การเปลี่ยน model, การลดขนาดรูปเพิ่มเติม และการคิดเงินลูกค้า เป็นงานต่อยอดหลังการวัด usage ทำงานถูกต้อง

## หน่วยที่ใช้ในการนับ

| หน่วย        | ความหมาย                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------- |
| Operation    | การกดอ่านรูปหนึ่งครั้ง หรือส่ง AI Search หนึ่งครั้ง ใช้ `ctx.requestId` เป็น `operationId`    |
| Attempt      | การส่ง HTTP request ไปยัง provider แต่ละครั้ง หนึ่ง operation อาจมี attempt 1 และ 2 จาก retry |
| Saved ticket | ใบงานที่ผู้ใช้บันทึกสำเร็จ อาจเชื่อมกับ operation แต่ไม่ใช่หน่วยนับค่าใช้จ่าย                 |

ใช้ `(orgId, operationId, attemptNo)` ป้องกันการบันทึกซ้ำ การกดอ่านใหม่เป็น operation ใหม่และมี usage ใหม่ได้ ส่วนการ retry เขียนฐานข้อมูลต้องไม่ทำให้เกิด HTTP request ไปหา AI เพิ่ม

## ข้อมูลที่บันทึก

เพิ่ม tenant table `aiUsageEvents` เก็บหนึ่งแถวต่อ attempt ด้วย validators ที่ระบุ field ชัดเจน

| กลุ่ม            | Field ที่เสนอ                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| เจ้าของและขอบเขต | `orgId`, `actorUserId`, `warehouseId` ถ้ามี, `feature`, `environment`, `billingAccountRef`                                                          |
| การอ้างอิง       | `operationId`, `attemptNo`, `providerGenerationId` ถ้ามี, `jobScanId` เมื่อผูกกับใบงาน                                                              |
| เวลาและผลลัพธ์   | `startedAt`, `finishedAt`, `durationMs`, `status`, `httpStatus`, `errorCode`                                                                        |
| Provider         | `provider`, `requestedModel`, `actualModel`, `isByok` ถ้ามี                                                                                         |
| จำนวน token      | `unitKind: MODEL_TOKEN`, `inputUnitCount`, `outputUnitCount`, `totalUnitCount`, `reasoningUnitCount`, `cachedInputUnitCount`, `cacheWriteUnitCount` |
| ค่าใช้จ่าย       | `currency: USD`, `costUsd` ตาม response, `costUsdNano` สำหรับรวมยอด, `billingStatus`, `usageSource`                                                 |

ชื่อ unit count เป็นจำนวน token เชิงตัวเลข และ UI ใช้คำว่า token ตามปกติ วิธีนี้รักษานโยบายห้าม field เก็บ authentication token โดยไม่ต้องลดความเข้มของ `schemaPolicy`

เก็บยอด USD ด้วยความละเอียด 9 ตำแหน่งสำหรับการรวมยอด (`1 USD = 1,000,000,000 nano USD`) โดยเก็บ `costUsd` ที่ provider รายงานควบคู่กัน ตรวจค่าที่เป็น finite, nonnegative และขอบเขต safe integer ปัดครั้งเดียวที่ provider adapter ไม่ปัดใน domain หรือต่อรูปเป็นสตางค์ เพราะค่าแต่ละรูปเล็กกว่า 1 สตางค์ได้

จำนวน token เป็นจำนวนเต็มไม่ติดลบ ข้อมูลบาง field อาจไม่ถูกส่งกลับ ต้องแยก missing จากศูนย์ ไม่บังคับให้ `input + output` เท่ากับ `total` ด้วยการแก้ค่าที่ provider รายงาน เก็บค่าที่ตรวจรูปแบบแล้วตามต้นทาง ส่วน reasoning เป็นรายละเอียดของ output และ cached/cache-write เป็นรายละเอียดของ input **ไม่บวกซ้ำเข้า total**

เพิ่ม indexes ที่ขึ้นต้นด้วย `orgId` สำหรับ operation/attempt, generation ID, เวลา, ผู้ใช้, คลัง และ feature ตาม query จริง พร้อม uniqueness contract สำหรับ operation/attempt และ generation ID เมื่อมีค่า จำกัดจำนวน indexes ที่ไม่ได้ใช้

เพิ่ม `aiUsageOperations` เป็น tenant projection หนึ่งแถวต่อ `(orgId, operationId)` เก็บ `startedAt`, owner/scope, `requestedModel`, จำนวน attempts, ยอด USD ที่ยืนยันแล้ว, จำนวน attempts ที่ cost ยัง unknown และผลของ operation เริ่ม operation กับ attempt แรกใน transaction เดียวกัน อัปเดต projection ด้วย delta ของ attempt ที่เปลี่ยนโดยไม่รวม events ทั้งระบบ การ retry ไม่สร้าง operation ใหม่ และคืน operation reference แบบ opaque สำหรับผูกกับใบงาน

Projection นี้เป็นฐานนับรูป/คำค้นและค่าเฉลี่ย ส่วน `aiUsageEvents` เป็นหลักฐานราย provider attempt การ reconcile ที่เปลี่ยน cost จาก unknown เป็น reported ต้องปรับทั้งสองระดับใน transaction เดียวกัน

ไม่เก็บ API key, authorization header, prompt, ข้อความค้น HR, base64, URL รูป หรือผลอ่านใบงานซ้ำใน usage table ข้อมูลใบงานยังอยู่ในตารางเดิม

## วิธีบันทึกแต่ละครั้ง

1. ผ่าน authorization และ validation ของรูป/คำค้น ตรวจ credentials และ quota ก่อน ถ้าไม่ส่ง request จริง หรือใช้ demo AI ไม่สร้าง provider attempt ในยอด production
2. `beginAttempt` เขียนแถว `PENDING` ก่อนเรียก provider พร้อมขอบเขตที่ได้จาก server ถ้าเขียนไม่ได้ ให้หยุดก่อนเกิดค่า AI และตอบ error ที่ retry ได้
3. ส่ง request ด้วย model, prompt, schema และ retry policy เดิม
4. Decode response เป็นสองส่วน: ข้อมูล usage และผลที่ใช้ในฟีเจอร์ ตรวจ usage ด้วย decoder ที่อนุญาตเฉพาะ field ที่ต้องการ ค่า `usage.cost` เป็นแหล่งยอดจริงหลัก ไม่คำนวณใหม่จากจำนวน token หรือราคาบนเว็บไซต์
5. ประมวลผลผลอ่าน/intent และ finalize usage ใน `finally` ที่รอการเขียนเสร็จก่อนคืนผล ถ้า JSON ของใบงานหรือ intent ไม่ผ่าน แต่ usage ใช้ได้ ให้เก็บค่าใช้จ่ายนั้นและสถานะ `UNREADABLE` ด้วย
6. ถ้าได้ 5xx และเข้าเงื่อนไข retry ปิด attempt แรกก่อน แล้วเริ่มแถว attempt ที่สองด้วย operation เดิม รายงานรวมค่าใช้จ่ายของทุก attempt ที่ provider รายงาน
7. คืนผลเดิมให้หน้าสแกน พร้อม operation reference สำหรับเชื่อมกับใบงานภายหลัง ไม่ต้องแสดงข้อมูลระบบติดตามให้พนักงานทำงานเพิ่ม

เพิ่ม port เช่น `ctx.aiUsage.beginAttempt(...)` และ `ctx.aiUsage.finishAttempt(...)` ใน `TenantActionFunctionContext` โดยประกอบใน `runTenantAction` จาก `rawContext.runMutation` กับ context ที่ผ่าน preflight แล้ว handlers ไม่ได้รับ raw database หรือเลือก tenant เอง การประกาศ feature เป็นค่าคงที่ฝั่ง server ไม่รับจาก browser

ใช้ internal mutations ใต้ `convex/aiUsage/` สำหรับ lifecycle แถวและ summary การ finalize ตรวจ ownership ของแถวและ immutable identity ใช้ขอบเขตที่อนุมัติตอนเริ่มเพื่อบันทึกค่าใช้จ่ายที่เกิดขึ้นแล้ว แม้ผู้ใช้ถูกถอนสิทธิ์ระหว่างรอ AI ไม่เปิด public mutation ที่รับ cost จาก client [Convex actions](https://docs.convex.dev/functions/actions) เขียนผ่าน mutation และต้อง await งาน asynchronous ที่ต้องการให้เสร็จ

## Failure และข้อมูลที่ยังไม่ทราบ

แยกผลการทำงานออกจากสถานะข้อมูลค่าใช้จ่าย:

- `status`: `PENDING`, `SUCCEEDED`, `UNREADABLE`, `PROVIDER_ERROR`, `TIMEOUT`, `NETWORK_ERROR`, `INTERRUPTED`
- `billingStatus`: `REPORTED`, `UNKNOWN` โดยยอดศูนย์นับเป็น reported ได้ก็ต่อเมื่อ provider รายงาน zero จริง
- `usageSource`: `RESPONSE` หรือ `GENERATION_LOOKUP` เมื่อได้ข้อมูลยืนยัน

Timeout, network failure, response เสีย หรือไม่มี usage **ไม่ให้อนุมานว่าฟรี** เก็บ HTTP status/error code ที่ผ่านการ sanitize ไม่เก็บ error body ดิบ แม้ attempt ไม่สำเร็จ แต่ response มี usage ที่ผ่าน validation ก็ยังรวมยอดนั้น

ถ้า provider ตอบแล้วแต่ finalize เขียนไม่สำเร็จ ให้ retry เฉพาะ mutation ด้วย key เดิมและจำนวนจำกัด คืนผลอ่านที่ได้ให้ใช้ต่อโดยไม่สั่งให้ผู้ใช้สแกนใหม่เพราะ logging failure แถวที่เริ่มไว้ยังอยู่ `PENDING` และเกิด structured operational log เฉพาะ IDs กับ billing metadata ที่จำเป็นสำหรับ recovery

ให้ `beginAttempt` จัด scheduled check ใน transaction เดียวกัน หลัง 15 นาทีตรวจแถวที่ยัง pending และเปลี่ยนเป็น `INTERRUPTED/UNKNOWN` ถ้าไม่มีผล finalize ไม่มีการส่งรูปซ้ำอัตโนมัติ หากมี generation ID ให้ internal reconciliation อ่าน [generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation) และอัปเดตยอด/summary ด้วย delta อย่าง idempotent ห้ามแทนค่า reported ที่ขัดแย้งอย่างเงียบ ๆ

ถ้า process หยุดหลังส่ง request แต่ก่อนบันทึก generation ID ระบบอาจกู้ยอดรายรูปเองไม่ได้ รายงานต้องแสดง gap นี้ ยอดที่ทราบเป็นเพียงยอดที่ยืนยันแล้ว และต้อง reconcile กับ provider แทนการรับรองว่าตรง invoice ทั้งหมด

## เชื่อมกับใบงาน

เพิ่ม optional `aiUsageOperationId` ใน ticket draft และ payload ที่บันทึก ใช้ operation reference จากผล extraction ผูก events กับ `finishedGoodsJobScans` ใน transaction ของการ save โดยตรวจองค์กร ผู้ใช้ คลัง และ feature ต้องตรงกัน และห้ามผูก operation เดียวกับใบงานคนละรายการ

ถ้าอ่านแล้วทิ้ง draft หรือ upload รูปไม่สำเร็จ events ยังอยู่ได้โดยไม่มี `jobScanId` เมื่อใบงานถูกลบ events ต้องยังคงอยู่ การบันทึกซ้ำด้วย request เดิมไม่เพิ่มค่า AI หรือผูกซ้ำ บาร์โค้ด/QR และกรอกมือไม่สร้าง AI usage

## รายงานและสิทธิ์

เพิ่ม `aiUsage.read` และ `aiUsage.configure` แบบ ORG scope ให้ `ORG_ADMIN` ตาม default grants ส่วน warehouse managers และ HR roles ไม่ได้รับโดยอัตโนมัติ องค์กรเดิมต้องมี provisioning ที่ idempotent: อัปเกรดเฉพาะ seeded role ที่ยังมี grants ตาม default เดิม และรายงาน customized role เพื่อให้ admin กำหนดเอง เพราะ seed ปัจจุบันไม่เพิ่ม grants ให้ role ที่มีอยู่แล้ว

หน้าใหม่ `/ai-usage` อยู่ในเมนูผู้ดูแลองค์กร มีภาษาไทย/อังกฤษ mobile/desktop และ permission guard ทั้งหน้าและ query:

- ยอดค่า AI ที่ยืนยันแล้ววันนี้/เดือนนี้ จำนวนรูปหรือคำค้น และค่าเฉลี่ยต่อ operation แยก feature
- จำนวน provider attempts และ retry แยกจากจำนวนรูป รวมรายการที่ยังไม่ทราบค่าใช้จ่าย
- อัตราสำเร็จ เวลาเฉลี่ย และรายการล่าสุดพร้อมผู้ใช้ คลัง model สถานะ และค่าใช้จ่าย
- Filter วันที่ ผู้ใช้ คลัง และ feature พร้อม CSV ที่ระบุ timezone, environment, currency, ค่าเงินจริง, ค่าประมาณบาท และ billing status

ค่าเฉลี่ยต้นทุนต่อ operation ต้องรวมค่า attempts ของ operation นั้น หาก operation มี attempt ที่ยังไม่ทราบยอด ไม่รวมไว้ในค่าเฉลี่ยที่อ้างว่า complete แสดงจำนวน complete operations และ unknown operations ประกอบ ส่วนต้นทุนต่อการอ่านสำเร็จเป็น metric แยกโดยระบุ denominator ชัดเจน

เพิ่ม tenant table `aiUsageDailySummaries` รวม contribution ของ operation ตามวันเริ่ม operation แบบ UTC, feature, environment, actor, warehouse และ requested model ด้วย deterministic key การ finalize/reconcile อัปเดต event, operation projection และ delta ของ summary ใน transaction เดียวกัน นับ operation เพียงครั้งเดียวแม้มีหลาย attempts ใช้ actual model จาก events สำหรับรายละเอียด provider แทนการรวมข้าม model แล้วนับรูปซ้ำ Replaying finalize ไม่เพิ่มยอดซ้ำ มี bounded rebuild สำหรับตรวจยอดกลับไปยัง event ledger

ใช้ indexed, bounded queries และ pagination ไม่ `.collect()` events ทั้งองค์กรสำหรับรายงานเดือน หาก query summary เกินขอบเขต ให้แจ้งว่าสรุปยังไม่ครบ ไม่แสดงยอด partial เป็นยอดทั้งหมด วันนี้/เดือนนี้อิง timezone ขององค์กร โดย query operation projections ใน exact UTC boundary slices สำหรับขอบวันที่ UTC daily summary คร่อมวันท้องถิ่น เพื่อไม่รวมข้อมูลนอกช่วง ค่าใช้จ่ายทุก attempt ในรายงานนี้จัดเข้าวันเริ่ม operation ส่วนการเทียบ provider report ใช้เวลาเริ่มแต่ละ attempt และระบุเหตุของส่วนต่างเมื่อ retry ข้ามวัน

## การแสดงบาทและค่าธรรมเนียม

บันทึกค่าเงินจริงใน USD เป็นหลัก เพิ่ม `aiCostSettings` ที่ scoped ด้วยองค์กร ใช้ FX rate ที่ผู้ดูแลตั้งพร้อมวันที่มีผลและแหล่งอ้างอิง เก็บ version ของ settings ไม่แก้ทับประวัติ ถ้ายังไม่ตั้ง rate แสดง USD และแจ้งว่าประเมินบาทไม่ได้ ไม่ฝังเรต 33.53 ไว้ถาวร

- ค่า AI ประมาณเป็นบาท = USD ที่ยืนยันแล้ว × อัตรา USD/THB ของช่วงวันที่ใช้งาน
- ค่าธรรมเนียมประมาณ = ค่า AI ประมาณเป็นบาท × fee rate
- ยอดรวมประมาณ = ค่า AI ประมาณเป็นบาท + ค่าธรรมเนียมประมาณ

Default fee estimate ของ Standard plan เป็น 5.5% และแก้ได้ตามบัญชี เพราะ [OpenRouter](https://openrouter.ai/business) คิดค่าธรรมเนียมตอนซื้อเครดิต ไม่ได้เพิ่มในค่า inference ต่อ request ที่ใช้ใน `usage.cost` หน้าและ CSV ต้องแยกยอดจริง USD ออกจากยอดบาท/fee ที่ประมาณ การเทียบใบเสร็จเติมเงินจริงต้องใช้ยอดและ fee จากใบเสร็จ อาจต่างจากการเฉลี่ย 5.5% ต่อรูป

รวมยอดด้วยความละเอียดสูงก่อนปัดตอนแสดงผล: ต่อรูป 4–6 ตำแหน่งบาท และยอดรวม 2 ตำแหน่ง CSV export แนบ FX rate, settings version และ fee estimate ไม่รวม unknown cost เป็น zero

## ลำดับ implementation

| ขั้น | งานและไฟล์หลัก                                                                                                                                                         | เกณฑ์จบ                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1    | Provider decoder ที่ `convex/lib/providerUsage.ts`, integer monetary model ใต้ `convex/model/aiUsage/`, schema, classification/uniqueness, internal lifecycle และ port | บันทึก tenant-scoped attempt ได้ ไม่ซ้ำ แยก zero/missing และไม่เปิดช่องให้ client ส่ง cost |
| 2    | ต่อ `extractJobTicket`, retry/failure recovery, operation link ใน `ticketDraft`, `JobScanScreen`, `saveJobScans`                                                       | ค่า AI ถูกเก็บแม้ไม่ save, upload fail หรือผลอ่านไม่ผ่าน และ retry มีสอง attempts          |
| 3    | ต่อ `requestSearchIntent` และ `hr/navigationIntent`, daily summaries, timezone queries, permissions/provisioning                                                       | รูปและ AI Search แยกยอดกัน local/staging ไม่ปน production summary ตรง ledger               |
| 4    | หน้า `/ai-usage`, navigation, i18n, versioned FX/fee settings, CSV และ bounded reconciliation/rebuild                                                                  | ผู้ดูแลเห็นยอดและ unknown coverage กรอง/ส่งออกได้ ผู้ไม่มีสิทธิ์ดูไม่ได้                   |
| 5    | ตรวจ acceptance cases, schema compatibility, typecheck/lint/build และ browser ก่อน rollout                                                                             | มีหลักฐาน end-to-end และวันที่เริ่มเก็บจริงชัดเจน                                          |

Regenerate Convex types ด้วย tooling ของ repo และอ่าน Next.js guides ที่เกี่ยวข้องก่อน implementation หน้าใหม่ รักษาไฟล์งานอื่นที่กำลังแก้ไว้

## Acceptance cases

1. สแกนสำเร็จแล้วปิดหน้าโดยไม่ save: ยังมี event และค่าใช้จ่าย
2. Provider รายงาน usage แต่ข้อมูลใบงาน JSON ผิด: event เป็น unreadable และ cost ยังถูกนับ
3. 5xx แล้วสำเร็จ: operation เดียว สอง attempts และไม่คิดว่าเป็นสองรูป
4. Timeout/response ไม่มี usage: unknown ไม่ใช่ zero; free/cache-hit ที่ provider ระบุ zero แสดงศูนย์ได้
5. Upload failed หรือเอารูปออกจาก draft: usage ไม่หาย บาร์โค้ด/manual/demo ไม่เพิ่ม production cost
6. เขียน finalize ซ้ำ/concurrent, reconcile ซ้ำ หรือ save retry: event/link/summary ไม่บวกซ้ำ
7. เขียน begin ไม่ได้: ไม่มี outbound AI call; finalize ล้มเหลว: ไม่ส่งรูปซ้ำและแสดง accounting gap ที่ฝั่ง admin
8. สลับองค์กร/คลัง ผู้ใช้ไม่มีสิทธิ์ และปลอม operation reference: อ่านหรือผูก event ของผู้อื่นไม่ได้
9. คำนวณ nano USD, cache/reasoning counts, FX/fee, เวลาใกล้เที่ยงคืนและเดือนใหม่: ผลรวม/CSV ตรงช่วงที่เลือก ไม่ปัดรูปละ 0.00 แล้วรวมเป็นศูนย์
10. จำนวนข้อมูลมากกว่าหน้าแรก: รายงานยอดยังครบจาก summaries หรือแสดง incomplete ชัดเจน และ daily rebuild ตรง ledger

Unit tests เน้น decoder/arithmetic/state transitions Integration tests ใช้ authenticated Convex actions และ stub provider เพื่อพิสูจน์จำนวน outbound calls, persisted events และ tenant isolation Browser ตรวจ 1 operation จริงผ่านหน้าสแกน แล้วเทียบ generation ID/usage กับรายงาน พร้อมไทย/อังกฤษและ mobile/desktop ใช้ fixture ใน staging/local และแยก environment ให้ชัดเจน

## Rollout และประวัติย้อนหลัง

เริ่มเก็บทุก operation ที่ได้รับอนุญาตตั้งแต่เปิดฟีเจอร์ ไม่ sampling เพราะต้องรวมค่าใช้จ่าย ใช้ additive schema และ optional operation links เพื่อให้ใบงานเก่ายังอ่านได้ ตั้ง `environment` จาก deployment configuration ฝั่ง server โดยไม่อาศัยค่า client และแสดงช่วงเวลาที่เริ่ม track ในรายงาน

ประวัติก่อนเปิด tracking ไม่มี generation ID จึงกู้เป็นรายรูป/ผู้ใช้จากใบงานเดิมอย่างแม่นยำไม่ได้ หากต้องนำเข้ายอดเก่า ใช้ provider report และแสดงเป็น historical aggregate ที่ไม่มี attribution ไม่สร้าง events สมมติ

[OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting) ส่งค่าใช้จ่ายและ native token counts ใน response อยู่แล้ว จึงไม่ต้องยิง generation lookup เพิ่มทุก scan ส่วน [Activity API](https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity-grouped-by-endpoint) ต้องใช้ management key และแสดงวัน UTC ที่เสร็จแล้ว ใช้ reconciliation ภายหลัง ไม่เป็น prerequisite ของการเริ่มบันทึก และไม่ควรเอายอดบัญชีรวมมาแทนยอดแยก tenant

วัดเวลาที่เพิ่มจาก begin/finalize, จำนวน Convex calls/writes และต้นทุนเก็บ events/summaries ด้วย เพราะ report นี้เป็นค่า AI ส่วนค่า infrastructure แยกต่างหาก รายละเอียด events และ summary ต้องมี retention policy ขององค์กรก่อนเปิด auto-delete โดยค่าเริ่มต้นของ rollout ยังไม่ลบประวัติเอง
