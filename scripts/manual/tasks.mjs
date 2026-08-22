/**
 * The operator-manual catalogue — the one source of truth.
 *
 * Thirteen workflows, exactly the thirteen the Thai visual guide documented by
 * hand (`docs/manuals/visual-operator-guide-th.md`). Nothing here is aspirational:
 * a task is listed because a screen exists, a screenshot of it is committed, and
 * an operator can be walked through it. Adding a fourteenth means capturing a
 * screenshot first — see `docs/manuals/operator-manual-authoring.md`.
 *
 * Thai is authored, not translated. The Thai text is the wording the previous
 * hand-written guide shipped with, carried across so no operator sees a sentence
 * change meaning because the storage format changed; English is the equivalent,
 * written for support staff and integrators.
 *
 * Coordinates are unscaled screenshot pixels, inherited from the hard-coded
 * overlay generator this file replaced. `pnpm manual:check` proves every one of
 * them lands inside the screenshot it annotates; it cannot prove one points at
 * the right button, which is what a human review of the generated overlay is
 * for.
 *
 * @typedef {import("./schema.mjs").ManualTask} ManualTask
 * @typedef {import("./schema.mjs").ManualTerm} ManualTerm
 */

/**
 * Filter groups on the manual index, in the order an operator meets them.
 *
 * @type {readonly ManualTerm[]}
 */
export const MANUAL_CATEGORIES = Object.freeze([
  Object.freeze({
    id: "orientation",
    th: "เริ่มต้นใช้งาน",
    en: "Getting started",
  }),
  Object.freeze({ id: "master-data", th: "ข้อมูลหลัก", en: "Master data" }),
  Object.freeze({ id: "purchasing", th: "การจัดซื้อ", en: "Purchasing" }),
  Object.freeze({ id: "receiving", th: "การรับสินค้า", en: "Receiving" }),
  Object.freeze({
    id: "quality",
    th: "การตรวจสอบคุณภาพ",
    en: "Quality control",
  }),
  Object.freeze({ id: "putaway", th: "การจัดเก็บ", en: "Putaway" }),
  Object.freeze({ id: "inventory", th: "สินค้าคงคลัง", en: "Inventory" }),
  Object.freeze({
    id: "reporting",
    th: "รายงานและการส่งออก",
    en: "Reporting and export",
  }),
  Object.freeze({ id: "handheld", th: "เครื่องพกพา", en: "Handheld" }),
]);

/**
 * Who performs a task.
 *
 * The distinction is operational rather than a permission claim: authorization is
 * owned by the permission catalogue (`docs/permissions.md`), and a manual that
 * restated it would be a second place to be wrong.
 *
 * @type {readonly ManualTerm[]}
 */
export const MANUAL_AUDIENCES = Object.freeze([
  Object.freeze({ id: "supervisor", th: "หัวหน้างาน", en: "Supervisor" }),
  Object.freeze({ id: "operator", th: "ผู้ปฏิบัติงาน", en: "Operator" }),
  Object.freeze({
    id: "both",
    th: "หัวหน้างานและผู้ปฏิบัติงาน",
    en: "Supervisor and operator",
  }),
]);

/**
 * Every documented workflow.
 *
 * @type {readonly ManualTask[]}
 */
export const MANUAL_TASKS = Object.freeze([
  Object.freeze({
    id: "start-and-choose-warehouse",
    category: "orientation",
    audience: "both",
    route: "/dashboard",
    image: "dashboard",
    title: Object.freeze({
      th: "เริ่มต้นใช้งานและเลือกคลังสินค้า",
      en: "Start work and choose a warehouse",
    }),
    summary: Object.freeze({
      th: "ตรวจสอบองค์กรและคลังสินค้าที่กำลังทำงานอยู่ แล้วเลือกงานถัดไปจากแดชบอร์ด",
      en: "Confirm the active organization and warehouse, then start a task from the dashboard.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "เข้าสู่ระบบด้วยบัญชีที่เป็นสมาชิกขององค์กร",
        en: "Signed in with an account that is a member of the organization",
      }),
      Object.freeze({
        th: "มีคลังสินค้าอย่างน้อยหนึ่งแห่งที่บัญชีนี้เข้าถึงได้",
        en: "At least one warehouse the account may access",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 เลือกคลังสินค้าที่ต้องการทำงาน ข้อมูลทุกหน้าหลังจากนี้จะอ้างอิงคลังสินค้าที่เลือกอยู่",
        en: "In box 1, choose the warehouse to work in. Every screen after this reads the warehouse selected here.",
      }),
      Object.freeze({
        th: "ที่กรอบ 2 เลือกงานที่ต้องการเริ่ม เช่น รับสินค้า ตรวจสอบคุณภาพ จัดเก็บ ดูยอดคงเหลือ หรือส่งออกข้อมูล",
        en: "In box 2, choose the task to start: receiving, quality, putaway, balances, or export.",
      }),
      Object.freeze({
        th: "ตรวจสอบชื่อคลังสินค้าที่แสดงใต้หัวข้อ “แดชบอร์ด” ก่อนเริ่มงานทุกครั้ง",
        en: "Check the warehouse name shown under the “Dashboard” heading before starting, every time.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "ชื่อคลังสินค้าที่ต้องการปรากฏทั้งในแถบบริบทและบนแดชบอร์ด",
        en: "The intended warehouse name appears both in the context bar and on the dashboard.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 205,
        y: 158,
        width: 270,
        height: 58,
      }),
      Object.freeze({
        kind: "rect",
        step: 2,
        x: 270,
        y: 1080,
        width: 965,
        height: 325,
      }),
    ]),
  }),

  Object.freeze({
    id: "create-item",
    category: "master-data",
    audience: "supervisor",
    route: "/master-data/items",
    image: "items",
    title: Object.freeze({ th: "สร้างรายการสินค้า", en: "Create an item" }),
    summary: Object.freeze({
      th: "เพิ่มสินค้าใหม่เข้าทะเบียนข้อมูลหลัก พร้อมหน่วยนับหลักและรูปแบบการติดตาม",
      en: "Add a new item to the master-data register with its base unit of measure and tracking mode.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "เลือกคลังสินค้าที่ต้องการทำงานแล้ว",
        en: "A warehouse is selected",
      }),
      Object.freeze({
        th: "ทราบรหัสสินค้าและหน่วยนับหลักที่ตกลงกันไว้",
        en: "The agreed item code and base unit of measure are known",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 กด “เปิดข้อมูลสินค้า” เพื่อดูหรือแก้ไขข้อมูลของสินค้าที่มีอยู่",
        en: "In box 1, use “Open item” to view or maintain an existing item.",
      }),
      Object.freeze({
        th: "ที่กรอบ 2 กรอกรหัสสินค้า ชื่อ หน่วยนับหลัก และรูปแบบการติดตาม",
        en: "In box 2, enter the item code, name, base unit of measure, and tracking mode.",
      }),
      Object.freeze({
        th: "กด “บันทึกสินค้า” เมื่อกรอกข้อมูลครบ",
        en: "Press “Save item” once every field is filled in.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "สินค้าใหม่ปรากฏในทะเบียนข้อมูลสินค้า",
        en: "The new item appears in the item register.",
      }),
      Object.freeze({
        th: "รหัสสินค้าและหน่วยนับหลักกำหนดได้ครั้งเดียวตอนสร้าง จึงต้องตรวจสอบให้ถูกต้องก่อนบันทึก",
        en: "The item code and base unit of measure are set once at creation, so both are checked before saving.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 1090,
        y: 525,
        width: 120,
        height: 435,
      }),
      Object.freeze({
        kind: "rect",
        step: 2,
        x: 278,
        y: 1110,
        width: 980,
        height: 380,
      }),
    ]),
  }),

  Object.freeze({
    id: "create-supplier",
    category: "master-data",
    audience: "supervisor",
    route: "/master-data/suppliers",
    image: "suppliers",
    title: Object.freeze({ th: "สร้างผู้จัดจำหน่าย", en: "Create a supplier" }),
    summary: Object.freeze({
      th: "เพิ่มผู้จัดจำหน่ายเข้าทะเบียน และปิดหรือเปิดใช้งานผู้จัดจำหน่ายที่มีอยู่",
      en: "Add a supplier to the register, and deactivate or reactivate an existing one.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "เลือกคลังสินค้าที่ต้องการทำงานแล้ว",
        en: "A warehouse is selected",
      }),
      Object.freeze({
        th: "ทราบรหัสและชื่อผู้จัดจำหน่ายที่ใช้ในเอกสารจัดซื้อ",
        en: "The supplier code and name used on purchasing documents are known",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 ใช้ปุ่มในคอลัมน์การจัดการเมื่อต้องการปิดหรือเปิดใช้งานผู้จัดจำหน่าย",
        en: "In box 1, use the buttons in the management column to deactivate or reactivate a supplier.",
      }),
      Object.freeze({
        th: "ที่กรอบ 2 กรอกรหัสและชื่อผู้จัดจำหน่าย แล้วกด “บันทึกผู้จัดจำหน่าย”",
        en: "In box 2, enter the supplier code and name, then press “Save supplier”.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "ผู้จัดจำหน่ายปรากฏในทะเบียนและมีสถานะ “ใช้งาน”",
        en: "The supplier appears in the register with status “Active”.",
      }),
      Object.freeze({
        th: "ผู้จัดจำหน่ายที่ไม่ใช้แล้วถูกปิดการใช้งาน ไม่ถูกลบ",
        en: "A supplier no longer used is deactivated, never deleted.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 1010,
        y: 540,
        width: 145,
        height: 285,
      }),
      Object.freeze({
        kind: "rect",
        step: 2,
        x: 278,
        y: 970,
        width: 980,
        height: 270,
      }),
    ]),
  }),

  Object.freeze({
    id: "create-purchase-order",
    category: "purchasing",
    audience: "supervisor",
    route: "/purchasing/orders",
    image: "purchase-orders",
    title: Object.freeze({
      th: "สร้างและเปิดใบสั่งซื้อ",
      en: "Create and open a purchase order",
    }),
    summary: Object.freeze({
      th: "สร้างใบสั่งซื้อฉบับร่างสำหรับผู้จัดจำหน่ายรายหนึ่ง หรือเปิดใบสั่งซื้อที่มีอยู่เพื่อทำงานต่อ",
      en: "Create a draft purchase order for a supplier, or open an existing one to continue work.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "มีผู้จัดจำหน่ายที่สถานะใช้งานอยู่ในทะเบียน",
        en: "An active supplier exists in the register",
      }),
      Object.freeze({
        th: "ทราบเลขที่ใบสั่งซื้อและอ้างอิงภายนอกถ้ามี",
        en: "The purchase-order number and any external reference are known",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 กด “เปิดใบสั่งซื้อ” เมื่อต้องการทำงานต่อกับใบสั่งซื้อที่มีอยู่",
        en: "In box 1, press “Open purchase order” to continue with an existing order.",
      }),
      Object.freeze({
        th: "ที่กรอบ 2 กรอกเลขที่ใบสั่งซื้อ เลือกผู้จัดจำหน่าย และกรอกอ้างอิงภายนอกถ้ามี",
        en: "In box 2, enter the purchase-order number, choose the supplier, and enter the external reference if there is one.",
      }),
      Object.freeze({
        th: "กด “บันทึกใบสั่งซื้อ”",
        en: "Press “Save purchase order”.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "ใบสั่งซื้อใหม่ปรากฏในทะเบียนโดยเริ่มเป็นฉบับร่าง",
        en: "The new purchase order appears in the register as a draft.",
      }),
      Object.freeze({
        th: "ใบสั่งซื้อจะพร้อมรับสินค้าเมื่อมีรายการสินค้าอย่างน้อยหนึ่งบรรทัด",
        en: "The order becomes receivable only once it has at least one line.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 1010,
        y: 465,
        width: 115,
        height: 205,
      }),
      Object.freeze({
        kind: "rect",
        step: 2,
        x: 278,
        y: 815,
        width: 980,
        height: 335,
      }),
    ]),
  }),

  Object.freeze({
    id: "add-purchase-order-lines",
    category: "purchasing",
    audience: "supervisor",
    route: "/purchasing/orders/{purchaseOrderId}",
    image: "purchase-order-detail",
    title: Object.freeze({
      th: "เพิ่มรายการสินค้าและเปิดใบรับสินค้า",
      en: "Add order lines and open a receipt",
    }),
    summary: Object.freeze({
      th: "เพิ่มบรรทัดสินค้าในใบสั่งซื้อ ตรวจยอดสั่งซื้อกับยอดที่รับแล้ว แล้วเปิดใบรับสินค้า",
      en: "Add item lines to a purchase order, check ordered against received, then open a receipt.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "มีใบสั่งซื้อที่เปิดอยู่",
        en: "An open purchase order exists",
      }),
      Object.freeze({
        th: "สินค้าที่จะสั่งซื้อมีอยู่ในทะเบียนข้อมูลสินค้าแล้ว",
        en: "Every item to be ordered already exists in the item register",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 กรอกหมายเลขบรรทัด เลือกสินค้า กรอกจำนวนและหน่วยนับ แล้วกด “บันทึกรายการ”",
        en: "In box 1, enter the line number, choose the item, enter the quantity and unit of measure, then press “Save line”.",
      }),
      Object.freeze({
        th: "ตรวจสอบยอด “สั่งซื้อ / รับแล้ว / คงเหลือ” ในตารางด้านบน",
        en: "Check the “Ordered / Received / Remaining” figures in the table above.",
      }),
      Object.freeze({
        th: "ที่กรอบ 3 กรอกเลขที่ใบรับ แล้วกด “เปิดใบรับ”",
        en: "In box 3, enter the receipt number, then press “Open receipt”.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "บรรทัดสินค้ามีสถานะ “ยังรับได้”",
        en: "The order line shows status “Receivable”.",
      }),
      Object.freeze({
        th: "ใบรับใหม่ปรากฏในหน้าการรับสินค้า",
        en: "The new receipt appears on the receiving screen.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 278,
        y: 840,
        width: 980,
        height: 325,
      }),
      Object.freeze({
        kind: "rect",
        step: 3,
        x: 278,
        y: 1238,
        width: 980,
        height: 250,
      }),
    ]),
  }),

  Object.freeze({
    id: "open-receipt-and-report-exception",
    category: "receiving",
    audience: "both",
    route: "/receiving",
    image: "receiving",
    title: Object.freeze({
      th: "เปิดใบรับสินค้าและบันทึกข้อยกเว้น",
      en: "Open a receipt and report an exception",
    }),
    summary: Object.freeze({
      th: "เปิดใบรับสินค้าจากใบสั่งซื้อ และแจ้งข้อยกเว้นเมื่อของเสียหาย ไม่ครบ หรือส่งมอบผิด",
      en: "Open a receipt against a purchase order, and report an exception for damage, shortage, or a delivery problem.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "มีใบสั่งซื้อที่เปิดอยู่และมีบรรทัดสินค้าที่ยังรับได้",
        en: "An open purchase order with at least one receivable line",
      }),
      Object.freeze({
        th: "มีรหัสเหตุผลสำหรับข้อยกเว้นในทะเบียนข้อมูลหลัก",
        en: "Reason codes for exceptions exist in master data",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 กรอกเลขที่ใบรับ เลือกใบสั่งซื้อที่เปิดอยู่ แล้วกด “เปิดใบรับ”",
        en: "In box 1, enter the receipt number, choose the open purchase order, then press “Open receipt”.",
      }),
      Object.freeze({
        th: "หากพบความเสียหาย ของไม่ครบ หรือปัญหาการส่งมอบ ให้ใช้กรอบ 2",
        en: "If there is damage, a shortage, or a delivery problem, use box 2.",
      }),
      Object.freeze({
        th: "เลือกประเภทข้อยกเว้นและรหัสเหตุผล เพิ่มบันทึกที่จำเป็น แล้วกด “แจ้งข้อยกเว้น”",
        en: "Choose the exception type and reason code, add any note needed, then press “Report exception”.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "ใบรับใหม่ปรากฏในรายการใบรับที่เปิดอยู่",
        en: "The new receipt appears in the list of open receipts.",
      }),
      Object.freeze({
        th: "ห้ามใช้ช่องบันทึกแทนประเภทปัญหา ต้องเลือกประเภทและเหตุผลให้ตรงก่อนเสมอ",
        en: "The note field never substitutes for the exception type: the type and reason code are always selected first.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 278,
        y: 745,
        width: 980,
        height: 245,
      }),
      Object.freeze({
        kind: "rect",
        step: 2,
        x: 278,
        y: 1062,
        width: 980,
        height: 335,
      }),
    ]),
  }),

  Object.freeze({
    id: "record-receipt-lines",
    category: "receiving",
    audience: "operator",
    route: "/receiving/{receiptId}",
    image: "receipt-detail",
    title: Object.freeze({
      th: "บันทึกรายการรับ พาเลท และข้อมูลป้าย",
      en: "Record receipt lines, a pallet, and label evidence",
    }),
    summary: Object.freeze({
      th: "บันทึกจำนวนที่รับจริงพร้อมล็อตและวันหมดอายุ รวมรายการไว้บนพาเลท และสร้างข้อมูลป้าย",
      en: "Record what was actually received with lot and expiry, build a pallet, and create label evidence.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "มีใบรับสินค้าที่เปิดอยู่",
        en: "An open receipt exists",
      }),
      Object.freeze({
        th: "ทราบตำแหน่งรับเข้าและมีแม่แบบป้ายที่เผยแพร่แล้วเมื่อจะสร้างข้อมูลป้าย",
        en: "The receiving location is known, and a published label template exists if label evidence is needed",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 เลือกตำแหน่งรับเข้า สแกนหรือค้นหาสินค้า เลือกบรรทัดใบสั่งซื้อ แล้วกรอกจำนวน หน่วยนับ ล็อต และวันหมดอายุ จากนั้นกด “บันทึกรายการ”",
        en: "In box 1, choose the receiving location, scan or search the item, choose the order line, enter quantity, unit of measure, lot, and expiry date, then press “Save line”.",
      }),
      Object.freeze({
        th: "ที่กรอบ 2 กรอกรหัสพาเลท แล้วกด “บันทึกพาเลท” เมื่อต้องรวมรายการรับไว้บนพาเลท",
        en: "In box 2, enter the pallet code and press “Save pallet” when the received lines belong on one pallet.",
      }),
      Object.freeze({
        th: "ที่กรอบ 3 เลือกแม่แบบป้ายที่เผยแพร่แล้ว กรอก LPN และ SKU แล้วกด “สร้างข้อมูลป้าย”",
        en: "In box 3, choose a published label template, enter the LPN and SKU, then press “Create label evidence”.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "รายการปรากฏในตาราง “รายการที่รับเข้า”",
        en: "The line appears in the “Received lines” table.",
      }),
      Object.freeze({
        th: "สถานะสต็อกแสดงผลตามกฎการตรวจสอบคุณภาพ",
        en: "The stock status reflects the quality-control rule that applies.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 278,
        y: 610,
        width: 980,
        height: 710,
      }),
      Object.freeze({
        kind: "rect",
        step: 2,
        x: 278,
        y: 1360,
        width: 980,
        height: 300,
      }),
      Object.freeze({
        kind: "rect",
        step: 3,
        x: 278,
        y: 1710,
        width: 980,
        height: 555,
      }),
    ]),
  }),

  Object.freeze({
    id: "decide-quality-inspection",
    category: "quality",
    audience: "both",
    route: "/quality",
    image: "quality",
    title: Object.freeze({
      th: "ตัดสินผลการตรวจสอบคุณภาพ",
      en: "Decide a quality inspection",
    }),
    summary: Object.freeze({
      th: "บันทึกผลการตรวจและการตัดสิน แล้วให้ผู้ใช้คนที่สองอนุมัติผลนั้น",
      en: "Record the inspection result and disposition, then have a second user approve it.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "มีใบตรวจที่เปิดอยู่จากการรับสินค้า",
        en: "An open inspection created by receiving",
      }),
      Object.freeze({
        th: "มีผู้ใช้คนที่สองที่มีสิทธิ์อนุมัติ",
        en: "A second user with approval permission is available",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 ตรวจสอบสินค้า สถานะ วิธีสุ่มตัวอย่าง และจำนวนที่ต้องตรวจ จากนั้นกด “ตัดสินผลการตรวจ” ในรายการที่เปิดอยู่",
        en: "In box 1, check the item, status, sampling method, and quantity to inspect, then press “Decide inspection” on the open row.",
      }),
      Object.freeze({
        th: "บันทึกผลตรวจและผลการตัดสิน เช่น ปล่อยผ่าน กักกัน หรือไม่ผ่าน",
        en: "Record the result and the disposition: release, quarantine, or reject.",
      }),
      Object.freeze({
        th: "ที่กรอบ 3 ผู้ใช้คนที่สองเลือกใบตรวจที่รออนุมัติ แล้วกด “อนุมัติผลนี้”",
        en: "In box 3, a second user selects the inspection awaiting approval and presses “Approve this decision”.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "สถานะเปลี่ยนจาก “รอตรวจ” หรือ “รออนุมัติ” เป็น “ตัดสินแล้ว”",
        en: "The status moves from “Awaiting inspection” or “Awaiting approval” to “Decided”.",
      }),
      Object.freeze({
        th: "ผู้บันทึกผลและผู้อนุมัติเป็นคนละผู้ใช้",
        en: "The recording user and the approving user are different people.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 278,
        y: 378,
        width: 980,
        height: 260,
      }),
      Object.freeze({
        kind: "rect",
        step: 3,
        x: 278,
        y: 775,
        width: 980,
        height: 455,
      }),
    ]),
  }),

  Object.freeze({
    id: "claim-and-confirm-putaway",
    category: "putaway",
    audience: "operator",
    route: "/putaway",
    image: "putaway",
    title: Object.freeze({
      th: "รับงานจัดเก็บและยืนยันตำแหน่ง",
      en: "Claim a putaway task and confirm the location",
    }),
    summary: Object.freeze({
      th: "รับงานที่พร้อมจัดเก็บ อ่านตำแหน่งที่ระบบแนะนำพร้อมเหตุผล แล้วยืนยันตำแหน่งที่วางจริง",
      en: "Claim a task that is ready for putaway, read the recommended location and its reason, then confirm where the stock was placed.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "มีงานจัดเก็บที่สถานะ “พร้อมจัดเก็บ”",
        en: "A task with status “Ready for putaway” exists",
      }),
      Object.freeze({
        th: "ตำแหน่งจัดเก็บถูกตั้งค่าไว้ในข้อมูลหลัก",
        en: "Storage locations are configured in master data",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 เลือกงานที่สถานะ “พร้อมจัดเก็บ” แล้วกด “รับงานนี้”",
        en: "In box 1, choose a task with status “Ready for putaway” and press “Claim this task”.",
      }),
      Object.freeze({
        th: "กด “คำแนะนำตำแหน่ง” เพื่ออ่านตำแหน่งที่ระบบแนะนำและเหตุผล",
        en: "Press “Location recommendation” to read the recommended location and the reason for it.",
      }),
      Object.freeze({
        th: "ที่กรอบ 3 ตรวจสอบคำแนะนำก่อนยืนยันตำแหน่งที่เลือกจริง",
        en: "In box 3, review the recommendation before confirming the location actually used.",
      }),
      Object.freeze({
        th: "เมื่อวางสินค้าบนชั้นแล้วจึงยืนยันการจัดเก็บ",
        en: "Confirm the putaway only after the stock is physically on the rack.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "สถานะเป็น “จัดเก็บแล้ว” และตำแหน่งที่เลือกปรากฏในรายการ",
        en: "The status reads “Put away” and the chosen location appears in the list.",
      }),
      Object.freeze({
        th: "การเลือกตำแหน่งที่ต่างจากคำแนะนำถูกบันทึกเป็นการทับคำแนะนำพร้อมเหตุผล",
        en: "Choosing a location other than the recommendation is recorded as an audited override with its reason.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 278,
        y: 378,
        width: 980,
        height: 395,
      }),
      Object.freeze({
        kind: "rect",
        step: 3,
        x: 278,
        y: 905,
        width: 980,
        height: 115,
      }),
    ]),
  }),

  Object.freeze({
    id: "check-inventory-balances",
    category: "inventory",
    audience: "both",
    route: "/inventory/balances",
    image: "inventory-balances",
    title: Object.freeze({
      th: "ตรวจสอบยอดคงเหลือ",
      en: "Check inventory balances",
    }),
    summary: Object.freeze({
      th: "อ่านยอดคงเหลือตามสินค้า ตำแหน่งจัดเก็บ ล็อต และสถานะสต็อก",
      en: "Read balances by item, storage location, lot, and stock status.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "เลือกคลังสินค้าที่ต้องการตรวจสอบแล้ว",
        en: "The warehouse to inspect is selected",
      }),
      Object.freeze({
        th: "มีการรับสินค้าหรือรายการบัญชีแยกประเภทเกิดขึ้นแล้วอย่างน้อยหนึ่งรายการ",
        en: "At least one receipt or ledger entry has been posted",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ในกรอบ 1 หาแถวจากสินค้า ตำแหน่งจัดเก็บ และล็อต",
        en: "In box 1, find the row by item, storage location, and lot.",
      }),
      Object.freeze({
        th: "ตรวจสอบสถานะสต็อกก่อนดูจำนวน เช่น พร้อมใช้ รอตรวจสอบคุณภาพ กักกัน หรือหมดอายุ",
        en: "Check the stock status before the quantity: available, awaiting QC, quarantined, or expired.",
      }),
      Object.freeze({
        th: "อ่านจำนวนคู่กับหน่วยนับเสมอ",
        en: "Always read a quantity together with its unit of measure.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "พบแถวที่ตรงกับสินค้า ตำแหน่ง ล็อต และสถานะที่ต้องการตรวจสอบ",
        en: "The row matching the item, location, lot, and status under review is found.",
      }),
      Object.freeze({
        th: "หน้านี้เป็นแบบอ่านอย่างเดียว การแก้ไขยอดต้องทำด้วยรายการกลับรายการหรือขั้นตอนที่มีหลักฐาน ห้ามแก้ตัวเลขโดยตรง",
        en: "This screen is read-only: a balance is corrected by a reversal or an evidenced procedure, never by editing a number.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 278,
        y: 367,
        width: 980,
        height: 570,
      }),
    ]),
  }),

  Object.freeze({
    id: "review-transaction-history",
    category: "inventory",
    audience: "both",
    route: "/inventory/history",
    image: "inventory-history",
    title: Object.freeze({
      th: "ตรวจสอบประวัติการเคลื่อนไหว",
      en: "Review transaction history",
    }),
    summary: Object.freeze({
      th: "อ่านประวัติแบบเพิ่มอย่างเดียว และใช้รหัสรายการเป็นหลักฐานเมื่อติดต่อฝ่ายสนับสนุน",
      en: "Read the append-only history and use a transaction id as evidence when contacting support.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "เลือกคลังสินค้าที่ต้องการตรวจสอบแล้ว",
        en: "The warehouse to inspect is selected",
      }),
      Object.freeze({
        th: "มีธุรกรรมเกิดขึ้นแล้วอย่างน้อยหนึ่งรายการ",
        en: "At least one transaction has been posted",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ในกรอบ 1 ตรวจสอบรหัสรายการ ประเภท เวลาที่เกิด วันที่ทางธุรกิจ และจำนวนบรรทัด",
        en: "In box 1, check the transaction id, type, occurrence time, business date, and line count.",
      }),
      Object.freeze({
        th: "รายการที่มีป้าย “รายการกลับรายการ” คือรายการแก้ไขที่อ้างอิงธุรกรรมเดิม",
        en: "A row tagged “Reversal” is a correction that references the original transaction.",
      }),
      Object.freeze({
        th: "ใช้รหัสรายการเมื่อติดต่อฝ่ายสนับสนุนหรือตรวจสอบหลักฐาน",
        en: "Quote the transaction id when contacting support or auditing evidence.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "พบธุรกรรมที่ต้องการพร้อมรหัสรายการที่อ้างอิงได้",
        en: "The transaction under review is found, with a quotable transaction id.",
      }),
      Object.freeze({
        th: "ประวัติเป็นแบบเพิ่มอย่างเดียว จึงไม่มีปุ่มลบหรือแก้ไข",
        en: "History is append-only, so there is no delete or edit control.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 278,
        y: 335,
        width: 980,
        height: 335,
      }),
    ]),
  }),

  Object.freeze({
    id: "export-data",
    category: "reporting",
    audience: "supervisor",
    route: "/reports",
    image: "reports",
    title: Object.freeze({ th: "ส่งออกข้อมูล", en: "Export data" }),
    summary: Object.freeze({
      th: "ขอไฟล์ CSV ของคลังนี้ ติดตามสถานะงานส่งออกเป็นช่วง แล้วดาวน์โหลดเมื่อเสร็จ",
      en: "Request a CSV file for this warehouse, follow the chunked job status, and download it when finished.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "เลือกคลังสินค้าที่ต้องการส่งออกข้อมูลแล้ว",
        en: "The warehouse to export is selected",
      }),
      Object.freeze({
        th: "มีสิทธิ์ส่งออกข้อมูลของคลังนั้น",
        en: "Permission to export that warehouse's data",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 เลือกชนิดข้อมูล แล้วกด “ขอส่งออก”",
        en: "In box 1, choose the data set, then press “Request export”.",
      }),
      Object.freeze({
        th: "ที่กรอบ 2 ตรวจสอบสถานะงาน: “เสร็จแล้ว” กด “ดาวน์โหลด CSV”, “กำลังทำงาน” กด “ทำหน้าถัดไป” จนจบ, “หยุดทำงาน” อ่านเหตุผลและลดขอบเขตข้อมูลก่อนเริ่มใหม่",
        en: "In box 2, check the job status: “Finished” — press “Download CSV”; “Running” — press “Process next page” until it ends; “Stopped” — read the reason and narrow the data set before starting again.",
      }),
      Object.freeze({
        th: "ตรวจสอบจำนวนแถวก่อนใช้ไฟล์",
        en: "Check the row count before using the file.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "งานส่งออกมีสถานะ “เสร็จแล้ว” และไฟล์ CSV ถูกดาวน์โหลดพร้อมจำนวนแถวที่ตรงกัน",
        en: "The export job reads “Finished” and the downloaded CSV has the row count shown.",
      }),
      Object.freeze({
        th: "งานที่หยุดทำงานจะไม่ให้ไฟล์ที่ถูกตัดทอน แต่จะแจ้งเหตุผลให้ลดขอบเขตข้อมูล",
        en: "A stopped job never hands over a truncated file; it states the reason so the data set can be narrowed.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 278,
        y: 490,
        width: 980,
        height: 235,
      }),
      Object.freeze({
        kind: "rect",
        step: 2,
        x: 278,
        y: 745,
        width: 980,
        height: 370,
      }),
    ]),
  }),

  Object.freeze({
    id: "work-on-handheld",
    category: "handheld",
    audience: "operator",
    route: "/handheld",
    image: "handheld-home",
    title: Object.freeze({
      th: "ใช้งานบนเครื่องพกพา",
      en: "Work on the handheld",
    }),
    summary: Object.freeze({
      th: "ตรวจบริบทบนเครื่องพกพา แล้วทำงานหนึ่งงานต่อครั้งตามลำดับที่หน้าจอแสดง",
      en: "Check the context on the handheld, then do one task at a time in the order the screen presents.",
    }),
    prerequisites: Object.freeze([
      Object.freeze({
        th: "เข้าสู่ระบบบนเครื่องพกพาแล้ว",
        en: "Signed in on the handheld device",
      }),
      Object.freeze({
        th: "เลือกองค์กรและคลังสินค้าที่ถูกต้องแล้ว",
        en: "The correct organization and warehouse are selected",
      }),
    ]),
    steps: Object.freeze([
      Object.freeze({
        th: "ที่กรอบ 1 ตรวจสอบภาษา องค์กร และคลังสินค้าก่อนเริ่มงาน",
        en: "In box 1, check the language, organization, and warehouse before starting.",
      }),
      Object.freeze({
        th: "ที่กรอบ 2 เลือกหนึ่งงานต่อครั้ง: ค้นหาสต็อก รับสินค้า ตรวจสอบคุณภาพ หรือจัดเก็บ",
        en: "In box 2, choose one task at a time: stock lookup, receive, quality, or putaway.",
      }),
      Object.freeze({
        th: "ทำตามลำดับที่หน้าจอแสดง ปุ่มขั้นถัดไปจะพร้อมเมื่อข้อมูลของขั้นปัจจุบันครบ",
        en: "Follow the order on screen: the next-step button becomes available once the current step is complete.",
      }),
      Object.freeze({
        th: "ใช้ “กลับไปหน้าจอเดสก์ท็อป” เมื่อต้องกลับไปงานของหัวหน้างาน",
        en: "Use “Back to desktop” to return to supervisor work.",
      }),
    ]),
    success: Object.freeze([
      Object.freeze({
        th: "งานที่เลือกเปิดขึ้นโดยแสดงองค์กรและคลังสินค้าที่ถูกต้อง",
        en: "The chosen task opens showing the correct organization and warehouse.",
      }),
      Object.freeze({
        th: "งานที่ยังไม่มีในระบบจะแสดงว่ายังไม่พร้อมใช้งาน ไม่ใช่ซ่อนไว้",
        en: "A task that does not exist yet is shown as unavailable rather than hidden.",
      }),
    ]),
    annotations: Object.freeze([
      Object.freeze({
        kind: "rect",
        step: 1,
        x: 430,
        y: 96,
        width: 420,
        height: 178,
      }),
      Object.freeze({
        kind: "rect",
        step: 2,
        x: 430,
        y: 380,
        width: 420,
        height: 330,
      }),
    ]),
  }),
]);
