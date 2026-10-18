# คู่มือ HR ภาษาไทย

[เปิดคู่มือ HTML](index.html) · [ดาวน์โหลด PDF 20 หน้า](../../../output/pdf/hr-user-guide-th.pdf)

เลือกงานจากสารบัญ แล้วทำตามเลขบนภาพ แต่ละหน้ามี 1–3 ขั้นตอนและผลที่ควรเห็น ใช้ภาพจากแอปจริงเต็มหน้าจอโดยไม่ครอปหรือซูม เมนูหรือปุ่มอาจต่างตามสิทธิ์ของผู้ใช้

ตรวจ PDF ทีละหน้าครบ 20 หน้าแล้ว และตรวจ HTML ทั้ง desktop/mobile รายงานผลและขอบเขตการทดสอบอยู่ใน [รายงานผู้จัดทำ](../../reviews/hr-user-guide-th-verification-2026-10-10.md) ผู้ตรวจอิสระจะบันทึกผลแยกในรายงานของตนก่อนส่งมอบขั้นสุดท้าย

ไฟล์ต้นฉบับ:

- `assets/source/`: PNG จากแอปจริงเก็บ bytes เดิม ลิงก์ดาวน์โหลดอยู่ใต้รูปทุกหน้าใน HTML
- `assets/annotated/`: ภาพขนาดเดิมพร้อมกรอบเลขชี้ปุ่ม
- `pages.json`: เนื้อหา route/state กรอบ SHA-256 และผลตรวจรายหน้า
- `captures.json`: DOM/ปุ่ม ณ เวลาเก็บภาพ เพื่อเทียบภาพและคำสั่ง
- `build.py`, `verify.py`, `requirements.txt`: source และตัวตรวจสำหรับสร้างซ้ำ
- `assets/fonts/`: Noto Sans Thai และใบอนุญาต OFL

สร้างซ้ำจาก root ของ repository:

```sh
output/hr-user-guide-tools/.venv/bin/python docs/manuals/hr-user-guide-th/build.py
pdftoppm -png -scale-to 1600 output/pdf/hr-user-guide-th.pdf tmp/pdfs/hr-user-guide-th/rendered/page
output/hr-user-guide-tools/.venv/bin/python docs/manuals/hr-user-guide-th/verify.py
```

หลังแก้เนื้อหาหรือ build ใหม่ ให้ตรวจภาพที่เปลี่ยนและยืนยัน hash ก่อนส่งมอบ
