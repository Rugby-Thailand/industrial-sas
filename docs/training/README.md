# คู่มืออบรมผู้ใช้งาน · Operator and supervisor training

Thai first, English second — the same rule the product follows (`D-06`,
[ADR-0010](../adr/0010-thai-first-i18n-and-accessibility.md)). Every screen an
operator meets is in Thai; these materials are written the same way so that
training and the software do not disagree about a word.

## เอกสารในชุดนี้ · What is here

| เอกสาร                                              | สำหรับใคร            | Document                                                        |
| --------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| [รับสินค้าด้วยเครื่องสแกน](./operator-receiving.md) | พนักงานหน้าท่ารับของ | Receiving on a handheld — the shift-long task                   |
| [งานของหัวหน้ากะ](./supervisor-operations.md)       | หัวหน้ากะ            | Supervisor operations — the dashboard, QC approval, and exports |

## กติกาของเอกสารชุดนี้ · How these are written

**ภาษาไทยคือภาษาหลัก** ข้อความบนหน้าจอทุกจุดที่อ้างถึงในเอกสารนี้เขียนตรงตามที่
ปรากฏจริง ถ้าหน้าจอเปลี่ยนคำ เอกสารนี้ต้องเปลี่ยนตาม

**รหัสยังเป็นภาษาอังกฤษเสมอ** เช่น `ARTIFACT_LIMIT_REACHED` หรือ `QC_HOLD`
รหัสเหล่านี้คือสิ่งเดียวที่เชื่อมภาพหน้าจอของผู้ใช้กับบันทึกของระบบ การแปลรหัสจะทำให้
ทีมสนับสนุนหาต้นเหตุไม่พบ (`ADR-0010` §1)

**ตัวเลขใช้เลขอารบิก** ทั้งภาษาไทยและอังกฤษ เพราะต้องอ่านเทียบกับหน้าจอเครื่องสแกน
ได้ทันที

**สิ่งที่ยังทำไม่ได้ ต้องบอกว่ายังทำไม่ได้** เอกสารอบรมที่สอนขั้นตอนซึ่งระบบยังไม่รองรับ
คือสาเหตุที่ผู้ใช้เลิกเชื่อคู่มือ ทุกที่ที่มีขอบเขต เอกสารนี้ระบุไว้ตรง ๆ

**Codes stay English.** `ARTIFACT_LIMIT_REACHED` and `QC_HOLD` are the only
strings that connect an operator's screenshot to a server log; translating them
would break the one link support has.

**Limits are stated, never omitted.** Training that teaches a step the system
does not support is why people stop trusting manuals.

## ก่อนเริ่มอบรม · Before a session

การอบรมใช้ระบบพัฒนาที่ตั้งค่า Clerk และ Convex แล้ว ผู้เข้าอบรมต้องมีบัญชี
องค์กร และสิทธิ์ที่ตรงกับบทบาท ห้ามใช้ข้อมูลลูกค้าจริงในการอบรม

## Related

- [Feature manuals](../manuals/README.md) — what each feature actually does
- [Runbooks](../runbooks/README.md) — what to do when something breaks
- [Permissions](../permissions.md) — who may do what
