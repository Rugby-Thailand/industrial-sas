# Bug research และอันดับปัญหา — 13 ตุลาคม 2026

ผลรวมหลังตรวจหลักฐานและตัดรายการซ้ำ: **21 บั๊กที่ยืนยันได้ + 5 ประเด็นความเสี่ยง/นโยบายที่ต้องตัดสินก่อนเรียกว่าเป็นบั๊ก** ตรวจ working tree ปัจจุบันที่ HEAD `733c6aca` รวมงานที่ยังไม่ commit ใช้ **Kiro CLI / claude-opus-5.5 / high** สำหรับการค้นหาอิสระ การจัดหมวด และการจัดอันดับรวม

อันดับสุดท้ายแบ่งเป็น **P1 × 3, P2 × 9, P3 × 9** และ **10 หมวด** ไม่มี P0 ที่มีหลักฐานรองรับ สามอันดับแรกคือ DAILY-01 (Clock in สำเร็จปลอมหลัง recovery), INV-04 (ข้อมูลขนาดพาเลทถูกเขียนทับจาก draft เก่า), INV-02 (replay โซนย้อนข้อมูลตำแหน่งลูก)

อ่าน [อันดับสุดท้ายและหมวดหมู่](final-ranking.md) หรือ [ข้อมูล JSON](final-ranking.json) สำหรับ backlog ที่พร้อมนำไปวางแผน อันดับและระดับ P ในสองไฟล์นี้แทนที่อันดับเบื้องต้นในรายงานย่อยทั้งหมด

## สิ่งที่ยืนยันและขอบเขตหลักฐาน

- 20 รายการทำซ้ำพฤติกรรมที่ผิดได้ด้วย handler/component จริงใน fixture แยก หรือ browser local จากการตรวจรอบแรก ไม่ได้หมายความว่าทั้ง 20 รายการผ่านการเดินทุกขั้นตอนใน browser หรือเกิดใน production แล้ว
- ROOT-01 เป็นข้อสรุปจาก source และ [สัญญาการ rerun query ของ Convex](https://docs.convex.dev/understanding/best-practices#dont-use-datenow-in-queries) ร่วมกับ probe ที่ยืนยันว่าคำตอบ Today เปลี่ยนเพราะเวลาอย่างเดียว ยังไม่ได้จำลอง websocket subscription จริงข้ามคืน
- Mutation probes ใช้ `convex-test` กับข้อมูลสร้างใหม่ในหน่วยความจำและ authorization จริง บาง probe เรียก registered `_handler` โดยตรง จึงไม่ได้ทดสอบ argument validator ของ transport; ROOT-02 ใช้ registered query และตรวจ validator จริง
- INV-06 เป็น API ที่ใช้ optional arguments ที่ถูกต้อง แต่ caller UI ปัจจุบันมักส่ง offsets ชัดเจน; ROOT-03 ต้องมีการเปลี่ยน workspace จากภายนอกขณะ pending; ROOT-02 ต้องใช้ ID ผิดรูป; INV-10 ยืนยัน Blob URL ไม่ถูกคืน แต่ไม่ได้วัด heap หรือการ crash
- การทดสอบ camera ใช้ callback ป้อนข้อมูลควบคุม ไม่ได้ตรวจ hardware หรืออ้างว่าถ่ายภาพจริง ไม่ได้ตรวจระบบ production หรือใช้ข้อมูลธุรกิจจริง

## รายงานและหลักฐานต้นทาง

| กลุ่ม                 | รายงาน                                                                | เนื้อหา                                                                       |
| --------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| รอบแรก                | [README เดิม](../README.md)                                           | DAILY-01..03, การทำซ้ำใน HR และ Back navigation, baseline checks              |
| คลังและสินค้า         | [Inventory research](inventory-research.md)                           | INV-01..10, trigger/actual/expected, caller, แนวทางแก้, logs และ probes       |
| Shared/client         | [Root research](root-research.md)                                     | ROOT-01..03, clock invalidation, malformed link, stale completion             |
| Kiro อิสระ            | [Kiro raw research](kiro/research.md), [raw JSON](kiro/findings.json) | candidate และหลักฐานดิบ; จำนวนและ P เป็นข้อเสนอเบื้องต้นก่อน semantic review  |
| ตรวจเจตนาและรายการซ้ำ | [Review decisions](review-decisions.md)                               | เหตุผลที่รับเพิ่มห้ารายการ รวม KIRO-08 กับ ROOT-01 และแยกห้าประเด็นนโยบาย     |
| จัดอันดับครั้งแรก     | [Kiro 16-item triage](kiro-triage.md)                                 | บันทึกการจัดอันดับก่อนรายงานอิสระเสร็จ ใช้ final-ranking สำหรับอันดับปัจจุบัน |

Kiro raw research เรียก candidate ทั้ง 11 ข้อว่า confirmed แต่การตรวจเทียบข้อกำหนดพบว่า KIRO-01/02/04/06/09 มีคำถามเรื่องนโยบายหรือเป็นพฤติกรรมที่ประกาศไว้ และ KIRO-08 ซ้ำกับ ROOT-01 จึงรับเป็นบั๊กใหม่ห้ารายการเท่านั้น ห้ามบวกยอด raw reports เข้าด้วยกัน

## การตรวจที่ทำแล้ว

| การตรวจ                             | ผลและหลักฐาน                                                                                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ชุดทดสอบปกติในรอบแรก                | 269 files / 3,206 tests ผ่าน; ไม่ได้รันทั้งชุดซ้ำในรอบขยาย — [baseline log](../evidence/baseline-tests.log)                                                                                                |
| ESLint และ navigation รอบแรก        | ผ่าน; navigation 64 fixtures, 43 policies, 187 owners, 25 intents — [navigation log](../evidence/baseline-navigation.log)                                                                                  |
| Inventory probes                    | 10 expected-correct failures + 1 passing Remove control; real production handlers/components — [backend/UI log](probes/inventory-evidence.log), [photo log](probes/inventory-photo-evidence.log)           |
| Inventory integration ที่เกี่ยวข้อง | 3 files / 45 tests ผ่าน — [log](probes/inventory-existing-checks.log)                                                                                                                                      |
| Root probes                         | 2 expected-correct failures — [log](evidence/root-probes-red.log)                                                                                                                                          |
| Kiro candidates                     | 11 expected-correct failures + 1 time-only supporting pass; รวมกรณีที่ยังต้องตัดสินนโยบาย — [backend](kiro/evidence/hr-backend.log), [UI](kiro/evidence/hr-ui.log), [AI dates](kiro/evidence/ai-dates.log) |
| ทำซ้ำเฉพาะ Kiro ที่รับเข้า backlog  | ห้ากรณีที่ผิด + หนึ่ง supporting pass; ดูผล assertion ดิบ — [log](evidence/accepted-kiro-probes.log)                                                                                                       |
| TypeScript หลังสร้าง diagnostics    | `pnpm exec tsc --noEmit` ผ่าน — [log](evidence/final-tsc.log)                                                                                                                                              |
| ESLint diagnostics                  | ผ่าน — [log](evidence/final-diagnostics-eslint.log)                                                                                                                                                        |
| การรักษางานเดิม                     | hash 734 ไฟล์ใน src/convex/scripts ตรงกับก่อนเริ่มรอบขยาย ไม่พบไฟล์เพิ่มในสาม directory นี้ — [ผลตรวจ](evidence/source-preservation.json)                                                                  |

Expected-correct probes ตั้ง assertion เป็นพฤติกรรมที่ควรได้ จึง **ล้มเพื่อแสดงบั๊กปัจจุบัน** ไม่ใช่ผลจากการแก้บั๊ก และไม่เพิ่มเข้า normal suite การล้มของ probe ที่สมมตินโยบายเองไม่เพียงพอให้เรียกว่าบั๊ก รายการนโยบายต้องมีการตัดสินก่อนนำ expectation ไปใช้เป็น regression ถาวร

## คำสั่งทำซ้ำ

```sh
pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/probes/vitest.config.mts
pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/probes/inventory.config.mts
pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/probes/root.config.mts
pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/kiro/vitest.config.mts -t 'KIRO-(03|05|07|08|10|11)'
```

รอบนี้เป็นงาน research และจัด backlog ยังไม่มีการแก้ application code, commit, PR หรือ deployment งานที่เพิ่มอยู่ในเอกสารและ diagnostics เท่านั้น
