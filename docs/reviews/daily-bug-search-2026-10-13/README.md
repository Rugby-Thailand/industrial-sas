# Daily bug search — 13 October 2026

ตรวจ working tree ที่ HEAD `733c6aca` รวมงานที่ยังไม่ commit โดยเน้น HR self-service, การออกจาก editor และการกู้คำสั่งเมื่อคำตอบจากเซิร์ฟเวอร์หาย พบ **3 ปัญหาที่ทำซ้ำได้** ตามด้านล่าง ยังไม่ได้แก้ production source

| ID       | ความสำคัญ | ผลกระทบ                                                                 | หลักฐาน                                                            |
| -------- | --------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| DAILY-01 | P1        | ลงเวลาวันใหม่ได้ใบยืนยันของวันเก่า แต่วันใหม่ยังไม่มีเวลาเข้า           | UI จริง + registered Convex functions ในฐานข้อมูลทดสอบแยก          |
| DAILY-02 | P2        | กดกลับหน้าวันนี้แล้ว Back ย้อนมาเปิด editor ที่เพิ่งออก                 | เบราว์เซอร์ local และ native history                               |
| DAILY-03 | P2        | editor ที่ไม่มี draft ยังแสดงเมนูลัดเก่า หลังข้อมูลจากอีกแท็บอัปเดตแล้ว | UI จริง + registered preference mutation/query ในฐานข้อมูลทดสอบแยก |

## DAILY-01 — รหัสคำสั่งค้างหลัง remount และถูกใช้กับคำสั่งใหม่

จุดหลัก: [useHrWrite.ts](../../../src/features/hr/useHrWrite.ts#L88), [TodayScreen.tsx](../../../src/features/hr/TodayScreen.tsx#L92), [clockReplay](../../../convex/hr/self.ts#L391)

`useHrWrite` เก็บ request ID ใน session storage แต่เก็บคำสั่งที่ต้อง retry ไว้ใน `useRef` เท่านั้น เมื่อ unmount/remount คำสั่งและสถานะ UNCERTAIN หาย แต่ request ID ยังอยู่ การกดส่งคำสั่งใหม่จึงอ่าน ID เก่ากลับมา

สำหรับ attendance ขอบเขตของ hook คือ action + employee โดยไม่แยก business date และ payload ของ backend clock-in เป็น `{}` การใช้ ID เดิมจึง replay เหตุการณ์เดิมได้จริง

วิธีทำซ้ำที่ยืนยันแล้ว:

1. วันที่ 12 ต.ค. กด Clock in ให้ backend บันทึกสำเร็จ แต่จำลองว่าคำตอบหาย UI เข้า UNCERTAIN
2. ออกจากหน้า แล้วลงเวลาออกของวันที่ 12 ด้วยคำสั่งใหม่ตามปกติ
3. วันที่ 13 ต.ค. เปิดหน้า Today ใหม่ ข้อมูลที่โหลดมาระบุ `businessDate: 2026-10-13` และ `nextAction: CLOCK_IN`
4. กด Clock in โดย UI และ registered mutation จริง

ผลที่ได้:

```text
reusedOldId: true
answer.value: written=true, replayed=true, businessDate=2026-10-12
receipt: Clocked in at 09:00 / Monday, 12 October 2026
fresh today: businessDate=2026-10-13, state=NONWORKING, nextAction=CLOCK_IN
```

ฐานข้อมูล fixture ไม่มี schedule assignment จึงเป็น NONWORKING ซึ่งอนุญาตให้ลงเวลาได้ตาม production code ประเด็นคือวันใหม่ยังไม่มี clock-in แม้หน้าจอแสดงใบยืนยันสำเร็จของวันเก่า

อีกอาการจากสาเหตุเดียวกัน: บันทึกเมนูลัดสำเร็จแต่คำตอบหาย → เปิด editor ใหม่โดยโหลด version ล่าสุด → เปลี่ยนเมนูอีกค่าแล้ว Save จะได้ `written: false` และ `REQUEST_ARGUMENT_CONFLICT` เพราะ payload ใหม่ถูกส่งด้วย ID เก่า

การแยกสาเหตุ:

- Query ก่อนกดวันใหม่ให้วันที่ 13 ถูกต้อง จึงไม่ใช่ UI อ่านวันเก่าค้าง
- ตัวเทียบที่ล้างเฉพาะ ID ค้างใน fixture ทำให้ทั้ง Clock in วันใหม่และ Save preferences ใหม่ผ่าน โดยไม่เปลี่ยน production code, เวลา, employee หรือ backend
- การเลือกวัน/เขตเวลาจึงไม่อธิบายความต่างของผลเทียบ

แนวทางแก้: ให้ recovery เก็บและคืนตัวคำสั่งเดิมพร้อม operation, payload, request ID และสถานะที่ยังไม่ทราบผล แยกการ retry เดิมออกจากคำสั่งใหม่หลังคืนข้อมูลล่าสุด สำหรับ clock ต้องแยกเจตนาของ business date/event ที่ถูกต้อง และรักษา overnight clock-out การล้าง session storage ในตัวเทียบเป็นการพิสูจน์สาเหตุ ไม่ใช่แนวทางแก้ทั่วไป เพราะอาจสูญเสียความสามารถในการ retry คำสั่งเดิมอย่างปลอดภัย

## DAILY-02 — ปุ่มกลับเพิ่ม history entry แทนการจบ editor

จุดหลัก: [ShortcutCustomizeScreen.tsx](../../../src/features/hr/ShortcutCustomizeScreen.tsx#L461)

ปุ่ม “กลับหน้าวันนี้” เป็น `Link` ปกติไป `/hr/today#hr-customize-shortcuts` จึง push หน้า Today ใหม่ และเก็บหน้า Customize ไว้ข้างหลัง ขัดกับ [Back navigation contract](../../contracts/back-navigation.md) ที่กำหนดให้ explicit exit ใช้ owned return

วิธีทำซ้ำในเบราว์เซอร์ local ที่เข้าใช้บัญชีทดสอบแล้ว:

1. เปิด `/th/hr/today`
2. กด “จัดเมนูลัด” → `/th/hr/customize`
3. กด “กลับหน้าวันนี้” → `/th/hr/today#hr-customize-shortcuts`
4. กด Back ที่ header

ผล: URL กลับเป็น `/th/hr/customize` และหน้า editor สามารถใช้งานได้อีกครั้ง

Native history ที่ตรวจอ่านได้:

```text
หลังปุ่มกลับ: appNavigationIndex=2
appRouteOrigin={href: /th/hr/customize, index: 1}
หลัง Back: pathname=/th/hr/customize, appNavigationIndex=1
assertion “dismissed editor must not reopen”: false
```

แนวทางแก้: ใช้ `returnFromTask` กับ safe fallback และ actual origin แทน parent push เพิ่ม navigation intent ใน inventory พร้อม caller regression สำหรับ exit → next Back, direct entry, locale/query/hash และ dirty/pending draft

หลักฐานใช้ URL/history และการโต้ตอบจริง ไม่มี screenshot ที่ใช้ยืนยันผลนี้: ภาพที่จับระหว่าง transition ยังแสดง underlay เก่า จึงไม่นำมาใช้ การตรวจซ้ำใน tab ใหม่หยุดเมื่อ T3 browser host disconnect หลังจากได้ผลข้างต้นแล้ว

## DAILY-03 — editor ที่ยังสะอาดไม่ตาม preference version ใหม่

จุดหลัก: [ShortcutCustomizeScreen.tsx](../../../src/features/hr/ShortcutCustomizeScreen.tsx#L98)

`baseline` และ `draft` รับ `preferences` ผ่าน `useState` เฉพาะครั้งแรก เมื่อ query ส่ง version ใหม่เข้ามา component identity ยังคงเดิม และไม่มีการคืนค่าจาก query ให้ editor ที่ไม่มีการแก้ไข

วิธีทำซ้ำ:

1. เปิด editor ที่ version 0 ทุกเมนูแสดงอยู่ ยังไม่แก้ฟอร์ม
2. จำลองอีกแท็บบันทึก `hr.profile.visible=false` ผ่าน registered mutation จริง ได้ version 1
3. อ่าน query ใหม่จาก backend แล้วส่งข้อมูล version 1 กลับเข้า component เดิม

ผล: checkbox “Show Profile” ยัง checked, Save disabled และ UI ยังบอก “These menus match your saved preferences.” แม้ค่าที่บันทึกเป็น false แล้ว ผู้ใช้ต้องกด Cancel หรือเปิดหน้าใหม่เพื่อเห็นค่าจริง หากเริ่มแก้ต่อจะส่ง `expectedVersion` เก่าและชน `PREFERENCES_STALE`

ตัวเทียบที่เปลี่ยนเพียงให้ clean editor remount ด้วยข้อมูล version 1 ทำให้ checkbox อัปเดตถูกต้อง แสดงว่าข้อมูล backend/query มีครบ แต่ state ของ editor ไม่ตามข้อมูลนั้น

แนวทางแก้: ยอมรับ version ใหม่เมื่อไม่มี draft/การจัดลำดับ/คำสั่ง pending หรือ uncertain ส่วนฟอร์มที่ยังแก้ไม่เสร็จต้องคง draft และแสดงทางออกจาก stale version อย่างชัดเจน

## การทำซ้ำและผลตรวจ

รัน probes ที่แยกจากชุดทดสอบปกติ:

```sh
pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/probes/vitest.config.mts --reporter=verbose
```

ผลคาดหมายบน source ปัจจุบัน: **3 tests failed**, exit 1 ใช้เวลาประมาณ 2 วินาที ได้แก่ clock วันใหม่, preference command ใหม่หลัง remount และ clean editor query update เป็นการยืนยันบั๊ก ไม่ใช่ผลชุดทดสอบหลัก

รันตัวเทียบเพื่อแยกสาเหตุ:

```sh
DAILY_BUG_CONTROL=fresh-intent pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/probes/vitest.config.mts -t remount
DAILY_BUG_CONTROL=remount-clean pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/probes/vitest.config.mts -t 'clean shortcut editor'
```

ผล: ตัวเทียบแรก **2 passed**, ตัวเทียบที่สอง **1 passed** ควบคุมเวลา backend ด้วย Date เท่านั้น ใช้ `convex-test` และ authorization/registered functions จริง แทน transport ที่ UI hooks เท่านั้น ข้อมูลใน probes เป็น fixture ที่แยกจาก backend local/production

เช็กพื้นฐานก่อนเพิ่ม probes:

| คำสั่ง                                | ผล                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm exec vitest run --reporter=dot` | 269 files / 3,206 tests passed                                            |
| `pnpm exec tsc --noEmit`              | ผ่าน                                                                      |
| `pnpm lint`                           | ผ่าน                                                                      |
| `pnpm check:navigation`               | 64 fixtures ผ่าน; inventory 43 routes, 187 owners, 25 action intents ผ่าน |

หลังเพิ่ม probes: TypeScript และ ESLint ของไฟล์ probes ผ่าน เก็บ raw output ใน [evidence](./evidence/) การตรวจครั้งนี้ไม่รวม production build, authenticated production walkthrough หรือ camera hardware

ชุดเดิมผ่านแต่ไม่ครอบคลุมคำสั่ง uncertain → remount → fresh intent และ explicit exit แบบ Link ดังกล่าว ควรย้าย probes ที่เกี่ยวข้องเข้า regression suite พร้อมการแก้จริงและเพิ่ม caller coverage ใน navigation inventory
