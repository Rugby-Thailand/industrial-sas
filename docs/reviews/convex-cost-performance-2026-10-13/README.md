# Convex cost / performance audit — 13 ต.ค. 2026

ตรวจ working tree ปัจจุบันที่ HEAD `733c6aca` รวมงานที่ยังไม่ commit โดย Kiro CLI (Opus 5.5, high), Codex Sol 6.1 จำนวน 3 agents และ parent reviewer ขอบเขตคือเปรียบเทียบโค้ดกับเอกสาร Convex และจัดลำดับงาน รายงานนี้ไม่ได้ implement หรือ deploy ข้อเสนอใด

**ยัง optimize ได้ โดยเริ่มจากลดการอ่านซ้ำและลดการ invalidate query ที่ไม่เกี่ยวข้อง แล้วค่อยลงทุนใน projection/index เพิ่มเมื่อข้อมูลและผลวัดรองรับ** หลายประเด็นเคยอยู่ในแผน 10 ต.ค. และตรวจซ้ำแล้วว่ายังอยู่ในโค้ด ไม่ใช่การค้นพบใหม่ทั้งหมด

## สิ่งที่ภาพบอกได้

| Resource         | ตัวเลขในภาพ                         | ความหมายต่อการจัดลำดับ                                   |
| ---------------- | ----------------------------------- | -------------------------------------------------------- |
| Database I/O     | 1 GB included + 641.01 MB on-demand | เป็นค่าอ่าน/เขียนสะสม ไม่ใช่ขนาดฐานข้อมูล                |
| Database storage | 12.21 MB                            | ฐานข้อมูลยังเล็ก แต่การอ่านข้อมูลเดิมซ้ำทำให้ I/O สูงได้ |
| Function calls   | 171K / 1M                           | ยังไม่ใกล้ allowance ของ calls ในภาพ                     |
| Action compute   | 0.0031 / 20 GB-hours                | ไม่ใช่ resource ที่ใช้มากเมื่อเทียบกับ allowance ในภาพ   |
| Data egress      | 24.05 MB / 1 GB                     | การลดขนาด response อย่างเดียวไม่แก้ DB I/O ที่ใช้ไปแล้ว  |

ภาพเลือก **All Projects** และช่วง **29 ก.ย.–29 ต.ค. 2026**; ส่วน breakdown ที่เห็นเลือก **Function Calls**: `buildingStatusControl` ประมาณ 40K และ `workspace/current.readCurrent` ประมาณ 34K จึงยังสรุปไม่ได้ว่าสองฟังก์ชันนี้เป็นต้นเหตุหลักของ 641 MB หรือว่า I/O ทั้งหมดมาจาก production ของโปรเจกต์นี้

ตาม public Starter rate ที่ตรวจวันที่นี้ $0.22/GB ใน US: `0.64101 × 0.22 ≈ $0.14`; ถ้า region คูณ 1.3 จะประมาณ $0.18 **เฉพาะ I/O overage ที่เห็น** เป็นตัวอย่างจากสมมติฐาน decimal GB ไม่ใช่ invoice จริง ไม่ได้ยืนยัน plan, region, rounding, tax หรือยอดสิ้นเดือน จึงควรเลือกงานที่ได้ทั้ง latency และ growth headroom แทนการทำ migration ใหญ่เพื่อประหยัดเงินส่วนนี้เพียงอย่างเดียว [Official limits/rates](https://docs.convex.dev/production/state/limits)

เปิด dashboard ผ่าน collaborative browser แล้วถูกส่งไปหน้า sign-in จึงไม่มี current per-function I/O/cache/OCC traces รายงานไม่ใช้ credentials ใน repo และไม่มีการ query/mutate production

## เปรียบเทียบ codebase กับ best practice

| ลำดับ                        | Current code / หลักฐาน                                                                                                                              | แนวทางที่ควรทำ                                                                                                                   | ผลที่คาดและข้อจำกัด                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — งานเล็กก่อน              | `scanning.ts:30` และ `batchManagement.ts:42` อ่าน placement/move history แล้วตรวจ `.some/.find` ว่ามี active hold หรือไม่                           | ใช้ status indexes ที่มีแล้ว และ `.first()` สำหรับคำถามแบบมี/ไม่มี                                                               | อ่านตาม active state แทนประวัติที่สะสม; ไม่ต้องเพิ่ม index แต่กรณีคืน move ต้องรักษา ordering/identity                                                         |
| 2 — เส้นทางที่ใช้ทั่วแอป     | `tenantFunctions.ts:460,483` resolve tenant แล้ว authorization หา membership/scope ซ้ำ; `navigationGrants.ts:25` อ่าน role และ permission ต่อเนื่อง | แชร์ผลอ่านเฉพาะ execution เดียว; ลด serial hops ของ independent reads; ทดลอง permission batching เทียบกับ point lookups          | ลด DB operations และเวลาเตรียม shell; batching อาจอ่าน permission bytes เพิ่ม จึงต้องวัด ไม่ cache auth ข้าม request                                           |
| 3 — ลด query ซ้ำบนหน้าอาคาร  | `StorageLayoutScreens.tsx:249,273` มี occupancy และ statusControl คนละฟังก์ชันต่ออาคาร                                                              | ยก occupancy result มาเป็นข้อมูลร่วมของแถว เติม `blocked`; ใช้ status query แบบเดิมในจุดที่ต้องการเฉพาะ status                   | จาก page + B occupancy + E controls เป็น page + B row queries; E เฉพาะแถว non-archived ที่ผู้ใช้มีสิทธิ์ activate ไม่ใช่ทุกแถว และไม่ใช่สัดส่วนลด I/O ทั้งระบบ |
| 4 — ผลกระทบกว้าง             | `finishedGoodsSummary.ts:223,282` เขียน generation เอกสารเดียวต่อคลัง ทั้ง inventory และ layout; catalogues อ่านเอกสารนี้                           | แยก backfill readiness ออกจาก mutable generation และแยก signals ตามข้อมูลที่ cursor ต้องพึ่งจริง                                 | ลด reruns/rescans ข้ามงาน; ลดพื้นที่เกิด write contention ที่ไม่จำเป็น แต่ต้องรักษา signed cursor และ snapshot semantics                                       |
| 5 — รวมยอดสินค้า             | `finishedGoods/catalogue.ts:490` scan ผลรวมทีละ 100 products; `readProductSummary:148` อ่าน readiness ซ้ำต่อ product                                | เริ่มจาก reuse readiness ใน execution; ถ้ายอดรวมเป็น hotspot ค่อยทำ exact warehouse totals ใน transaction                        | ลด reads ซ้ำทันทีใน source path; projection ลด full pass แต่เพิ่ม maintenance/write contention/backfill                                                        |
| 6 — หน้าจัดวาง/ย้ายสินค้า    | `workflow.ts:930` โหลด context ทุก zone แบบต่อเนื่อง; `moveOccupancy.ts:16` lookup 2 statuses ต่อ pallet                                            | memoize parent/blocks ภายใน query, จำกัด parallelism; หาก scale สูงเพิ่ม source/target-building indexes ของ moves                | ลด parent reads ซ้ำและ serial latency; fixed building lookups ต้อง backfill active cross-building moves ให้ครบ                                                 |
| 7 — ค้นหา/เลือก pallet       | `jobScans.ts:406` scan ถึง 10,000 full docs ก่อน substring/offset paging; `workflow.ts:2342` scan pallet history แม้เปลี่ยน rotation                | bounded search continuation และ compact search docs หาก payload ใหญ่; แยก stack candidates จาก preview และเลือกด้วย status index | ลด scan ซ้ำ/หลีกเลี่ยง history cap; search index แบบ token ไม่เท่ากับ substring ภาษาไทยโดยอัตโนมัติ                                                            |
| 8 — HR cache และ range reads | `hr/access.ts:28` ใช้ `orgClock`/`Date.now`; `hr/self.ts:572` อ่าน history รายวัน; `hr/shared.ts:439` อ่าน period ทั้ง site                         | แยก stable access/display data จาก clock; ทำ indexed date ranges และ bounded period lookup โดยรักษาขอบเขต tenant                 | cache reuse และ latency ดีขึ้นได้; server time ต้องยังตัดสิน clock-in/out, authorization และ period locks                                                      |

แนวทางเลือก index ให้ตรง predicate อิง [index ranges](https://docs.convex.dev/database/reading-data/indexes/); การลด read dependencies อิง [reactive queries](https://docs.convex.dev/functions/query-functions); bounded reads, clock และ data modeling อิง [Convex best practices](https://docs.convex.dev/understanding/best-practices) รายละเอียดของแต่ละข้อ รวม tradeoffs และ acceptance tests อยู่ในรายงานแยกด้านล่าง

ลำดับเป็น judgement จาก scope/ความเสี่ยงและหลักฐานในโค้ด **ไม่ใช่ ranking ของ production bytes ที่วัดแล้ว** หาก Dashboard แสดง hotspot คนละจุด ให้ปรับลำดับตามข้อมูลจริง

## ผลเพิ่มเติมจาก Kiro ที่ตรวจข้ามกับ Codex แล้ว

- **HR อ่าน correction มากกว่าที่ใช้:** `hr/self.ts:214,580` ขอประวัติได้ถึง 21 documents ต่อวัน แต่เลือกตัวแรก ควรมี latest-only helper และคง helper เดิมสำหรับหน้าที่แสดงประวัติครบ ตรวจ pending/resubmission fallback ให้ผลเหมือนเดิม
- **ประวัติแก้ไขพนักงานอ่าน audit คนละประเภทปนกัน:** `hr/setup.ts:143` อ่าน 20 rows แล้วกรอง authorization rows และ saves ที่ไม่มี changes ออก ทำให้ได้การแก้ไขจริงไม่เต็มหน้า ใช้ action-qualified index ลดส่วนที่อ่านทิ้ง แต่ยังต้องจัดการ empty changes และ continuation; index อย่างเดียวไม่รับประกัน 20 การแก้ไข
- **HR clock และ period lock มีทางลดงานได้:** แยก name-only lookup จาก `memberDirectory.ts:40` ที่คำนวณ `active` ด้วยเวลาปัจจุบัน; closed preview ต้องแยก `today` ใน header ก่อนจึงจะตัด clock ได้ ส่วน period lock ทดลองอ่าน 8 periods ล่าสุดพร้อม exact fallback ได้เมื่อยืนยันว่า periods ไม่ซ้อนกัน ข้อเสนอ `take(201)` ใช้กับ adapter ปัจจุบันไม่ได้ เพราะ limit คือ 100
- **Clerk watermark อาจ invalidate กว้าง:** webhook patch user/organization/membership แม้ business fields ไม่เปลี่ยน ขณะที่ tenant queries อ่านเอกสารเหล่านี้ หาก event frequency สูง การแยก watermark ออกจาก business document อาจลด reruns แต่ต้องวัดก่อน และรักษา ordering, replay, tombstones และ migration ระหว่าง deployed versions
- **Audit/retention เป็นงานออกแบบ ไม่ใช่ quick win:** fresh successful command มักมี authorization audit, domain audit และ idempotency record แต่จำนวนนี้ไม่ใช้กับทุก attempt/replay ขณะนี้ `expiresAt` ไม่ได้จบ replay protection จริง การเริ่มลบหลัง 30 วันจึงเปลี่ยน semantics; ไม่ควรลด audit หรือเพิ่ม cleanup เพียงเพราะเห็น expiry field

Parent และ Codex สอง agents ตรวจรายงาน Kiro ซ้ำและแก้ข้อเสนอที่เกินหลักฐานแล้ว รวมถึง adapter limit, clock/cache, filtered-history completeness และข้ออ้างเรื่อง subscription consistency รายละเอียดพร้อม source locations และวิธีทดสอบอยู่ใน [Kiro backend review](kiro-backend.md)

## งานที่ทำดีอยู่แล้ว และข้อเสนอที่ไม่ควรเหมารวม

- Layout กับ inventory แยก query แล้วตั้งแต่ 29 ก.ย.; มี query-local pallet/product memoization และ tenant-scoped indexes อยู่แล้ว
- `buildingStatusControl` อ่าน building และใช้ status-index `.first()` สูงสุดสองครั้ง จึงมีต้นทุนต่อ call ต่างจาก query ที่ scan inventory ทั้งหมด
- Workspace มี stable `{}` subscription หนึ่งจุด; `useWorkspace()` หลาย component ไม่ได้เพิ่ม workspace backend query ตามจำนวน component
- Location rows ใน building เดียวกันใช้ status function/args เดียวกันและ SDK deduplicate; จำนวน hooks ไม่เท่ากับ execution count
- Dialog ที่ปิดใช้ `skip` อยู่แล้ว และไม่พบ query polling/Convex SSR preload ใน paths ที่ตรวจ
- Clock dependency ของ ordinary non-expiring authorization ถูกแก้แล้ว; ที่เหลือใน HR เป็นอีกเส้นทางหนึ่ง `Date.now()` ไม่ใช่ timer ที่ทำให้ subscription rerun เองทุกห้าวินาที
- อย่าลด security checks, ใช้ stale localStorage สำหรับ inventory/permissions, ตัดรายการด้วย `.take()` แล้วอ้างว่าครบ, หรือรวม footprint ด้วยการบวกพื้นที่ซึ่งนับการซ้อนผิด
- `Promise.all` ทำให้รอ reads พร้อมกันได้ แต่ไม่ได้ลดจำนวน bytes โดยตัวมันเอง ส่วน `.map` คืน object เล็กลงหลังอ่าน full document แล้ว ก็ไม่ได้คืน DB I/O ที่ใช้ไป

## Index cleanup: ทำหลัง measured hotspots

Parent ตรวจ schema ด้วย TypeScript AST พบ prefix-index candidates 5 คู่: correction day, placement pallet, placement support-pallet, scan-assignment warehouse และ move pallet. **นี่ไม่ใช่รายการที่ลบได้ทันที** เพราะ index สั้นเรียงด้วย `_creationTime` ต่อจาก prefix ส่วน index ยาวเรียงด้วย field เพิ่มก่อนเวลา ซึ่งอาจเปลี่ยน `.first/.take`, cursor หรือ move ที่ถูกเลือก [Index ordering](https://docs.convex.dev/database/reading-data/indexes/)

`hrCorrectionRequests.by_orgId_dayId` (`schema.ts:266`) เป็นตัวที่ควรตรวจ usage ก่อน: current correction detail ใช้ `by_orgId_dayId_submittedAt` แล้ว ส่วน `by_orgId_dayId` ใน `dayDetail.ts:115` เป็นคนละตาราง (`hrAttendanceEvents`) ให้ตรวจ callers/scripts/deployed compatibility ให้ครบก่อนลบ ด้าน placements/moves ควรแก้ active-state query ให้แคบก่อน แล้วจึงพิจารณา index ที่เหลือ

## แผนวัดผลที่ทำให้ตัดสินใจได้

ต้องแยก operational traffic ด้วย: `.github/workflows/production-backup.yml:3` ตั้ง daily native snapshot และ `scripts/release/lib/convex-backup.mjs:227` ขอ export พร้อม storage; การทำ backup อ่านทุก document และมี bandwidth/storage usage ตาม [Backup pricing](https://docs.convex.dev/database/backup-restore#how-are-they-priced) แม้ไม่พบ `convex/crons.ts` ก็ไม่ได้แปลว่าไม่มี scheduled backend work จากภายนอก ไม่ได้ตรวจว่าทุก schedule รันจริงหรือคิดเป็น I/O เท่าไร และไม่เสนอปิด recovery backups เพื่อประหยัด ส่วน scheduled workspace matrix เป็น Vite fixture harness ไม่มี Convex ตาม `.github/workflows/workspace-matrix.yml:2` จึงไม่ควรโยนต้นทุน production ให้ชุดทดสอบนั้น

1. ใน Usage เลือก `industrial-sas` แล้วสลับ breakdown เป็น **Database I/O** เก็บ top functions, แยก production/dev/preview และใช้ช่วงเวลาเดียวกัน ตรวจ Calls, cache misses, read/write bytes และ duration แยกกัน
2. ทำ baseline จาก fixed fixtures และ journey เดิม: sign-in → building list, เปิด/ปิด details, เปลี่ยน placement, scan code, stack rotation, HR history/period preview แยก cold/warm และสิทธิ์ storage-only/HR-only/mixed
3. บันทึก `bytesRead`, `bytesWritten`, `documentsRead`, `databaseQueries` จาก transaction counters. Installed `convex@1.46.0` มี `ctx.meta.getTransactionMetrics()` ใน `node_modules/convex/src/server/meta.ts`; wrapper ปัจจุบันไม่ส่ง `meta` ให้ handler จึงควรวาง optional instrumentation ที่ raw context หรือ harness อย่างมีขอบเขต ส่วน max outstanding operations ต้องใช้ harness/custom instrumentation และ p50/p95 execution/journey latency ต้องเก็บจาก timed runs/dashboard/browser แยกต่างหาก ไม่ใช่ fields ของ `getTransactionMetrics()` [Transaction measurement](https://docs.convex.dev/database/writing-data#checking-transaction-headroom)
4. ใช้ billing-oriented `database_io_read_bytes`/`database_io_write_bytes` จาก execution logs/log stream ถ้า plan รองรับ; dashboard เป็นจุดเริ่มได้โดยไม่ต้องอัปเกรดเพียงเพื่อ audit ครั้งนี้ JSON serialized byte counts ใน local tests เป็น regression proxy ไม่ใช่ billed bytes [Usage attribution](https://docs.convex.dev/platform-apis/track-usage)
5. ทำ patch เล็กทีละเรื่องและเทียบ workload เดิม; หลัง release เปรียบเทียบ 7 วันโดย normalize จำนวนผู้ใช้/ธุรกรรม หัก write cost ที่ projection เพิ่มออกด้วย ก่อนสรุปประหยัดกี่เปอร์เซ็นต์

Acceptance ที่ควรใช้: active-state lookup ไม่โตตามประวัติ RELEASED/finished moves; inventory-only write ไม่ rerun storage metadata query; อ่าน readiness หนึ่งครั้งต่อ query; rotation ไม่ scan candidates ใหม่; ผลลัพธ์/ordering/authorization เหมือนเดิม และ exact totals ตรงกับ recomputation รวม move/retirement/delete

## Verification ที่ทำในรอบนี้

รัน existing integration suites เพื่อยืนยันฐานที่ optimize ไปแล้ว:

```sh
pnpm exec vitest run --project integration \
  tests/integration/query-cache.integration.test.ts \
  tests/integration/storage-occupancy.integration.test.ts \
  tests/integration/finished-goods-summary.integration.test.ts \
  tests/integration/storage-location-catalogue.integration.test.ts
```

ผล **4 files / 23 tests passed** รวม cache-friendly ordinary authorization, layout/inventory isolation, exact occupancy/summary และ catalogue behavior การผ่าน tests นี้ไม่ได้พิสูจน์ savings ของข้อเสนอใหม่; ไม่มี implementation หรือ production performance benchmark ในรอบนี้

## รายงานจากแต่ละ agent

- [Codex Sol 6.1 — queries, indexes, inventory, mutation summary](codex-queries.md)
- [Codex Sol 6.1 — subscriptions, workspace, cache lifetime](codex-subscriptions.md)
- [Codex Sol 6.1 — official documentation / billing baseline](convex-official-baseline.md)
- [Kiro CLI Opus 5.5 — HR, authorization, writes, actions และ retention](kiro-backend.md)

เอกสารเดิมที่ตรวจเทียบ: [September I/O optimization](../../plans/convex-database-io-optimization.md), [October 10 backend review](../performance-kiro-2026-10-10/03-backend-warehouse.md), [October 10 performance plan](../../plans/performance-improvement-2026-10-10.md)
