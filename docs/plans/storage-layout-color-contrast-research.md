# Storage layout — color contrast research

Date: 2026-10-01

ปรับ canvas เป็นโทน slate/charcoal ที่เป็นกลาง ใช้ teal สำหรับจุดมีสินค้า และ lime สำหรับจุดที่เลือก พร้อมแยกสี link, primary button และ selected border ตามหน้าที่ Palette นี้เป็นการตัดสินใจด้าน design ของงานนี้; WCAG กำหนดเกณฑ์ contrast และการสื่อความหมาย ไม่ได้กำหนดชื่อสีที่ต้องใช้

## เกณฑ์จากแหล่งข้อมูลหลัก

- ตัวอักษรขนาดปกติ รวม label ใน SVG ต้องมี contrast อย่างน้อย **4.5:1**; ตัวอักษรใหญ่ใช้ **3:1** โดยตัวใหญ่หมายถึงอย่างน้อย 18pt หรือ 14pt ตัวหนา การตรวจใช้ค่าจริงก่อนปัดเศษ และควรเผื่อระยะเหนือเกณฑ์สำหรับเส้นตัวอักษรบาง [W3C — Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- ขอบหรือรูปที่จำเป็นต่อการเห็น control, state หรือเข้าใจแผนผัง ต้องมี contrast **3:1** กับสีที่อยู่ติดกัน เส้นตกแต่ง เช่น dot grid ที่ไม่สื่อข้อมูล ไม่จำเป็นต้องเด่นเท่าจุดที่เลือก [W3C — Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- สถานะห้ามอาศัยสีเพียงอย่างเดียว จึงควรคงรหัส, คำว่า “ว่าง”/จำนวนพาเลท, เส้น selected ที่หนาขึ้น และ hatch ของพื้นที่ห้ามจัดเก็บ [W3C — Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- คำนวณด้วย relative luminance ของ sRGB และสูตร `(Llighter + 0.05) / (Ldarker + 0.05)`; ตรวจ foreground/background ที่ render ติดกันจริง [W3C — Relative luminance](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance), [W3C — Contrast ratio](https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio)

## จุดที่ควรแก้จาก palette เดิม

ค่าด้านล่างคำนวณจาก hex ใน `FloorMap.module.css` ก่อนปรับ tone; เป็นการตรวจคู่สี token ไม่ใช่การรับรอง WCAG ทั้งหน้า

| คู่สีเดิม                                       | Contrast | ผลต่อ UI                                 |
| ----------------------------------------------- | -------: | ---------------------------------------- |
| Light muted `#657361` / occupied `#b9d3c3`      |   3.15:1 | label รองขนาดเล็กไม่ถึง 4.5:1            |
| Light muted / empty `#d9e2d3`                   |   3.77:1 | คำว่า “ว่าง” ขนาดเล็กไม่ถึง 4.5:1        |
| Dark muted `#a2afa5` / occupied `#294f40`       |   4.03:1 | จำนวนพาเลทขนาดเล็กไม่ถึง 4.5:1           |
| Light wall `#84967b` / floor `#e4ebdf`          |   2.60:1 | ขอบผังที่สื่อ geometry ควรเข้มขึ้น       |
| Light occupied border `#658773` / occupied fill |   2.50:1 | ขอบด้านในที่ติดกับ fill ควรเข้มขึ้น      |
| Light link `#7b983f` / raised panel `#e2e9dc`   |   2.64:1 | ต้องแยก link text ออกจาก selected border |

## Palette ที่ implement แล้ว

อ่านค่าจริงจาก `src/components/storageLayouts/FloorMap.module.css` หลังปรับ tone วันที่ 2026-10-01; dark สืบทอด selected text จาก light

| Role                | Light     | Dark      |
| ------------------- | --------- | --------- |
| Canvas              | `#f1f5f9` | `#111820` |
| Floor               | `#e2e8f0` | `#192330` |
| Empty fill          | `#f8fafc` | `#243243` |
| Wall / empty border | `#64748b` | `#94a3b8` |
| Occupied fill       | `#ccfbf1` | `#164e46` |
| Occupied border     | `#0f766e` | `#5eead4` |
| Selected fill       | `#d9f99d` | `#d9f99d` |
| Selected border     | `#4d7c0f` | `#ecfccb` |
| Selected text       | `#1a2e05` | `#1a2e05` |
| Text                | `#0f172a` | `#f1f5f9` |
| Muted text          | `#475569` | `#c0ccda` |
| Panel               | `#ffffff` | `#18212c` |
| Raised panel        | `#f1f5f9` | `#263442` |
| Link text           | `#3f6212` | `#bef264` |
| Primary fill        | `#3f6212` | `#d9f99d` |
| Primary hover fill  | `#365314` | `#bef264` |
| Primary text        | `#ffffff` | `#1a2e05` |

## ผลวัด palette หลังปรับ

คำนวณตามสูตร WCAG จาก hex ใน stylesheet โดยไม่ปัดเศษก่อนตัดสินผ่าน/ไม่ผ่าน ตัวเลขในตารางปัดสองตำแหน่งเพื่ออ่านสะดวก

| คู่สีที่วัด                       |   Light |    Dark | เกณฑ์ที่ใช้                  |
| --------------------------------- | ------: | ------: | ---------------------------- |
| Small muted label / occupied fill |  6.72:1 |  5.83:1 | ≥4.5:1                       |
| Small muted label / empty fill    |  7.24:1 |  8.00:1 | ≥4.5:1                       |
| Muted text / panel                |  7.58:1 |  9.97:1 | ≥4.5:1                       |
| Muted text / raised panel         |  6.92:1 |  7.80:1 | ≥4.5:1                       |
| Selected text / selected fill     | 12.52:1 | 12.52:1 | ≥4.5:1                       |
| Empty border / floor              |  3.86:1 |  6.18:1 | ≥3:1                         |
| Empty border / empty fill         |  4.55:1 |  5.08:1 | ≥3:1                         |
| Occupied border / floor           |  4.44:1 | 10.72:1 | ≥3:1                         |
| Occupied border / occupied fill   |  4.86:1 |  6.42:1 | ≥3:1                         |
| Selected border / floor           |  4.05:1 | 14.61:1 | ≥3:1                         |
| Selected border / selected fill   |  4.28:1 |  1.08:1 | ดูคำอธิบาย selected ด้านล่าง |
| Selected fill / floor             |  1.06:1 | 13.58:1 | ดูคำอธิบาย selected ด้านล่าง |
| Link text / raised panel          |  6.46:1 |  9.73:1 | ≥4.5:1                       |
| Primary text / default fill       |  7.08:1 | 12.52:1 | ≥4.5:1                       |
| Primary text / hover fill         |  8.73:1 | 11.19:1 | ≥4.5:1                       |
| Success text / success fill       |  5.47:1 |  9.78:1 | ≥4.5:1                       |

Light selected ใช้ขอบเข้มที่ต่างจากทั้ง floor และ selected fill เกิน 3:1 ส่วน dark selected ใช้พื้น lime สว่างที่ต่างจาก floor **13.58:1** และเส้นขอบที่หนาขึ้นเป็นสัญญาณของ selected state; ความต่างระหว่างขอบสีอ่อนกับพื้น lime ด้านใน **1.08:1** ไม่ใช่สัญญาณ contrast ที่ใช้แยก selected จากจุดอื่น

## หลักฐานจากแอปจริงและขอบเขตการตรวจ

- วันที่ 2026-10-01 ตรวจ computed styles ใน browser ทั้ง light/dark พบ RGB ของ semantic tokens ตรงกับ palette ที่ implement แล้ว ตรวจ viewport **1169 × 731 CSS px** ไม่พบ horizontal overflow
- ภาพหลักฐาน: [Dark canvas](../../output/storage-layout-b-ui/contrast-desktop-dark.png), [Light canvas](../../output/storage-layout-b-ui/contrast-desktop-light.png)
- เก็บรหัส, คำว่า “ว่าง”/จำนวนพาเลท, เส้น selected และ hatch สำหรับพื้นที่ห้ามจัดเก็บไว้ เพื่อให้มีสัญญาณที่มองเห็นเพิ่มเติมจาก hue
- สี reserved area ที่ผู้ใช้บันทึก/import มาเป็นข้อมูลเดิมและคงไว้ การวัด token ชุดนี้ไม่ครอบคลุมสี arbitrary ทุกสีของข้อมูลเหล่านั้น
- ผลนี้ยืนยันคู่สีและ viewport ที่ตรวจ ไม่ใช่การรับรอง WCAG ทั้งหน้า หรือการรับรอง browser QA บน mobile/tablet ทุกขนาด ยังต้องตรวจ focus ทุก control, modal/sheet และข้อมูล imported จริงใน QA matrix ของแผนหลัก
