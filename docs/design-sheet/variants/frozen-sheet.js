"use strict";

const icons = {
  moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  warehouse: '<path d="m3 9 9-6 9 6v12H3Z M7 21V11h10v10M7 15h10m-10 4h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="m12 3 10 18H2Z M12 9v5m0 3h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
  pending: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v14H3Z"/><circle cx="12" cy="13" r="4"/>',
  barcode:
    '<path d="M3 5V3h4m10 0h4v2M3 19v2h4m10 0h4v-2M6 7v10m3-10v10m3-10v10m3-10v10m3-10v10"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  box: '<path d="m3 7 9-5 9 5v10l-9 5-9-5Z M3 7l9 5 9-5M12 12v10m-4.5-17.5 9 5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
};
const svg = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const copy = {
  en: {
    skip: "Skip to design sheet",
    designSheet: "Design sheet",
    foundations: "Foundations",
    workspace: "Workspace",
    states: "States",
    print: "Print sheet",
    title: "Clear work.<br />Quiet surfaces.",
    intro:
      "A calmer interface for warehouse work and people operations. Keep the familiar blue. Let the task lead.",
    proposal: "Design proposal",
    proposalNote:
      "Based on the current system. Examples use synthetic data; no application workflows have been changed.",
    inPractice: "The system, in practice",
    interactive: "Interactive specimens",
    direction: "Less framing.<br /> More focus.",
    directionCopy:
      "A heading, a useful summary, and one clear next action. Sections share a surface instead of becoming cards inside cards.",
    principleOne: "Space groups information",
    principleOneCopy:
      "8px between fields. 16px within a task. 24px between task groups.",
    principleTwo: "Color carries meaning",
    principleTwoCopy:
      "Blue for action. Status colors for exceptions and outcomes.",
    principleThree: "Keep the work in view",
    principleThreeCopy:
      "Controls stay legible. Details unfold only when needed.",
    sampleWorkspace: "Sample workspace",
    scanTab: "Job scan",
    catalogueTab: "Catalogue",
    floorTab: "Floor plan",
    hrTab: "My day",
    sourceTokens: "Existing palette. A quieter application.",
    color: "Color",
    colorCopy:
      "Neutral surfaces do most of the work. The primary blue remains familiar and deliberate.",
    primary: "Primary action",
    canvas: "Canvas",
    surface: "Surface",
    text: "Text",
    colorRule:
      "Status = color + icon + text. Physical area colors retain their own meaning.",
    typography: "Typography",
    typePage: "Finished goods",
    typeSection: "Storage location",
    typeBody: "Confirm the location before saving.",
    typeMeta: "Last updated 09:41",
    typeRule:
      "Fixed type sizes. Natural Thai wrapping. Monospace for codes, times, and measurements.",
    controls: "Controls that stay clear",
    touchRule: "36px desktop controls · 48px touch targets",
    actionHierarchy: "Action hierarchy",
    saveChanges: "Save changes",
    cancel: "Cancel",
    viewDetails: "View details",
    actionRule: "One primary action per task. Secondary actions stay neutral.",
    saving: "Saving…",
    remove: "Remove",
    disabledRule: "Disabled, saving, and destructive states remain distinct.",
    fieldHierarchy: "Field hierarchy",
    locationCode: "Location code",
    inputHint: "A neutral field with a visible edge.",
    jobNumber: "Job number",
    requiredError: "Enter a job number before saving.",
    fieldRule:
      "Errors explain recovery. AI origin is a small label beside the field, never a page of amber fills.",
    statesTitle: "Useful in every state",
    statesSubtitle: "Keep uncertainty visible. Keep the next step available.",
    emptyState: "Empty",
    noTickets: "No tickets yet",
    emptyCopy: "Choose a location, then add a photo or scan a barcode.",
    addPhoto: "Add photo",
    loadingState: "Loading",
    loadingCopy:
      "Preserve the layout while records load. Unavailable totals never become zero.",
    failureState: "Save failed",
    notSaved: "Changes weren’t saved",
    failureCopy:
      "Your edits are still here. Check your connection and try again.",
    retry: "Try again",
    layoutTitle: "One rhythm, every screen",
    spacing: "Spacing",
    spacingCopy:
      "4px base. 8px field gaps. 16px task sections. 24px task groups. 40px document chapters.",
    responsive: "Responsive behavior",
    mobile: "Phone",
    mobileCopy:
      "Stack fields. Collapse navigation. Keep actions inside the content width.",
    desktop: "Desktop",
    desktopCopy:
      "Use available space for lists and maps. Cap forms at 48rem and details at 80rem.",
    accessibility: "Access",
    accessCopy:
      "Keyboard focus, reduced motion, readable status labels, and long Thai names are part of the design.",
    footer:
      "Built from the real Storage Planner system with Impeccable. A proposal for review.",
    sourceNotes: "Source notes & implementation guidance",
    success: "Complete",
    warning: "Needs review",
    danger: "Error",
    pending: "Pending",
    mapped: "Mapped",
    stored: "Stored",
    awaiting: "Awaiting storage",
    measure: "Awaiting measurement",
    productBarcode: "Product barcode",
    aiOrigin: "AI filled",
    scanned: "Scan barcode",
    manual: "Type manually",
    moreDetails: "More details",
    scanTitle: "Scan job tickets",
    scanSummary: "Pick the location first, then scan each pallet’s job ticket.",
    locationName: "Left side · Floor 1",
    ticket: "Ticket 1",
    advisory: "Review the extracted values before saving.",
    sampleTicket: "1 sample ticket ready",
    saveTickets: "Save tickets",
    savedTicket: "Sample saved. No warehouse records were written.",
    requiredTicket: "Enter both the job number and product barcode.",
    partName: "Part name",
    customer: "Customer",
    deliveryDate: "Delivery date",
    manufacturingDate: "Manufacturing date",
    quantity: "Quantity",
    factoryQuantity: "Factory quantity",
    customerQuantity: "Customer quantity",
    scanCaption:
      "Flatten the ticket container, keep the two required identities visible, and move secondary fields into a plain disclosure. Preserve the review advisory and location-first workflow.",
    catalogueTitle: "Finished goods",
    catalogueSummary: "Prepare goods and confirm their storage location.",
    addProduct: "Add finished good",
    products: "Products",
    storedUnits: "Stored units",
    searchProducts: "Search finished goods",
    filterAll: "All records",
    filterStored: "Stored only",
    product: "Product",
    status: "Status",
    units: "Quantity",
    sampleRecords: "sample records",
    page: "Page 1",
    cartons: "CARTON",
    productOne: "Consumer goods cartons",
    productTwo: "Replacement components",
    productThree: "Protective packaging",
    noResults: "No matching products. Try a different code or name.",
    catalogueCaption:
      "Replace boxed totals with one statistic strip. Give records a shared table surface, align quantities, and keep filters and pagination together. The three records are synthetic.",
    floorTitle: "Building DEMO-01",
    floorSummary: "Floor 1 · 12 × 20 m · synthetic layout",
    floorLocation: "Storage location",
    floorDimensions: "Dimensions",
    floorContents: "Contents",
    floorContentsValue: "2 sample pallets",
    inspect: "Inspect location",
    selectLocation: "Select storage location",
    walkway: "Walkway",
    location: "Location",
    selected: "Selected",
    floorNotice:
      "Sample location selected. Production inspection opens the existing details panel.",
    floorCaption:
      "Keep one canvas surface. Selection is a blue outline; walkway color describes a physical area. Keep the inspector adjacent on desktop and below the map on phones.",
    hrTitle: "My day",
    hrSummary: "Friday, 9 October 2026 · EMP-DEMO-001",
    clockIn: "Clock-in",
    clockOut: "Clock-out",
    clockedIn: "Clocked in",
    clockedOut: "Clocked out",
    plannedShift: "Planned shift",
    break: "60 min break",
    sampleSite: "Demo warehouse",
    site: "Site",
    clockOutAction: "Clock out",
    completeDay: "Today’s attendance is complete.",
    hrPolicy:
      "In the application, the server records the time. Online attendance records your assigned site; it does not verify physical presence.",
    hrSampleClock: "Sample clock-out shown. No attendance was recorded.",
    hrCaption:
      "Remove tinted receipt boxes, keep actual times prominent, and separate planned shift details. Show one next clock action. Supervisor review and period certification remain distinct workflows.",
    demoNotice: "This is a design specimen. No application data was changed.",
    photoNotice:
      "Capture step selected. In the app this opens the existing photo capture control.",
    barcodeNotice:
      "Barcode step selected. In the app this opens the existing scanner.",
    manualNotice: "Manual entry selected. Edit the required fields below.",
    detailNotice:
      "Fields use 36px desktop / 48px touch controls, 6.4px corners, and visible focus.",
    removedNotice:
      "Destructive action specimen selected. Production removal requires the existing confirmation and permissions.",
    retryNotice: "Retry specimen complete. Your sample values are preserved.",
  },
  th: {
    skip: "ข้ามไปยังแผ่นออกแบบ",
    designSheet: "แผ่นออกแบบ",
    foundations: "พื้นฐาน",
    workspace: "พื้นที่ทำงาน",
    states: "สถานะ",
    print: "พิมพ์แผ่นออกแบบ",
    title: "งานชัดเจน<br />หน้าจอสบายตา",
    intro:
      "หน้าจอที่เรียบง่ายขึ้นสำหรับงานคลังสินค้าและงานบุคลากร คงสีน้ำเงินที่คุ้นเคย และให้งานเป็นจุดเด่น",
    proposal: "ข้อเสนอการออกแบบ",
    proposalNote:
      "อ้างอิงระบบปัจจุบัน ตัวอย่างใช้ข้อมูลสมมติ ยังไม่มีการเปลี่ยนกระบวนการทำงานของแอป",
    inPractice: "เห็นระบบผ่านงานจริง",
    interactive: "ตัวอย่างที่ทดลองใช้งานได้",
    direction: "ลดกรอบ<br />เพิ่มความชัดเจน",
    directionCopy:
      "ใช้หัวข้อ คำอธิบายสั้น และการดำเนินการหลักที่ชัดเจน แต่ละส่วนใช้พื้นผิวร่วมกัน เพื่อลดการ์ดซ้อนการ์ด",
    principleOne: "จัดกลุ่มด้วยระยะห่าง",
    principleOneCopy: "8px ระหว่างช่อง 16px ภายในงาน และ 24px ระหว่างกลุ่มงาน",
    principleTwo: "ใช้สีเพื่อบอกความหมาย",
    principleTwoCopy:
      "น้ำเงินสำหรับการดำเนินการ สีสถานะสำหรับข้อยกเว้นและผลลัพธ์",
    principleThree: "ให้งานอยู่ในสายตา",
    principleThreeCopy: "ปุ่มและช่องกรอกอ่านง่าย เปิดรายละเอียดเมื่อจำเป็น",
    sampleWorkspace: "พื้นที่ทำงานตัวอย่าง",
    scanTab: "สแกนใบ Job",
    catalogueTab: "สินค้า",
    floorTab: "ผังชั้น",
    hrTab: "วันนี้",
    sourceTokens: "คงชุดสีเดิม ใช้ให้สบายตาขึ้น",
    color: "สี",
    colorCopy:
      "ให้พื้นผิวสีกลางเป็นพื้นที่หลัก คงสีน้ำเงินเดิมไว้สำหรับจุดที่ต้องการความชัดเจน",
    primary: "การดำเนินการหลัก",
    canvas: "พื้นหลัง",
    surface: "พื้นผิว",
    text: "ข้อความ",
    colorRule:
      "สถานะใช้สีร่วมกับไอคอนและข้อความ สีพื้นที่จริงมีความหมายของตัวเอง",
    typography: "ตัวอักษร",
    typePage: "สินค้าสำเร็จรูป",
    typeSection: "ตำแหน่งจัดเก็บ",
    typeBody: "ตรวจสอบตำแหน่งก่อนบันทึก",
    typeMeta: "ปรับปรุงล่าสุด 09:41",
    typeRule:
      "ขนาดตัวอักษรคงที่ ข้อความไทยตัดบรรทัดตามธรรมชาติ ใช้ตัวอักษรโมโนกับรหัส เวลา และขนาด",
    controls: "ปุ่มและช่องกรอกที่ชัดเจน",
    touchRule: "ปุ่มเดสก์ท็อป 36px · พื้นที่สัมผัส 48px",
    actionHierarchy: "ลำดับการดำเนินการ",
    saveChanges: "บันทึกการเปลี่ยนแปลง",
    cancel: "ยกเลิก",
    viewDetails: "ดูรายละเอียด",
    actionRule: "หนึ่งการดำเนินการหลักต่อหนึ่งงาน ปุ่มรองใช้สีกลาง",
    saving: "กำลังบันทึก…",
    remove: "ลบ",
    disabledRule: "แยกสถานะปิดใช้งาน กำลังบันทึก และการลบให้ชัดเจน",
    fieldHierarchy: "ลำดับช่องกรอก",
    locationCode: "รหัสตำแหน่ง",
    inputHint: "ช่องกรอกสีกลางและขอบที่มองเห็นได้",
    jobNumber: "เลขที่ Job",
    requiredError: "กรอกเลขที่ Job ก่อนบันทึก",
    fieldRule:
      "ข้อผิดพลาดบอกวิธีแก้ ใช้ป้ายเล็กข้างช่องเพื่อระบุข้อมูลจาก AI แทนพื้นสีเหลืองทั้งหน้า",
    statesTitle: "ใช้งานได้ในทุกสถานะ",
    statesSubtitle: "แสดงความไม่แน่นอน และบอกขั้นตอนถัดไป",
    emptyState: "ยังไม่มีข้อมูล",
    noTickets: "ยังไม่มีใบงาน",
    emptyCopy: "เลือกตำแหน่ง แล้วเพิ่มรูปหรือสแกนบาร์โค้ด",
    addPhoto: "เพิ่มรูป",
    loadingState: "กำลังโหลด",
    loadingCopy:
      "คงโครงหน้าจอขณะโหลดข้อมูล ยอดที่ยังไม่พร้อมต้องไม่แสดงเป็นศูนย์",
    failureState: "บันทึกไม่สำเร็จ",
    notSaved: "ยังไม่ได้บันทึกการเปลี่ยนแปลง",
    failureCopy: "ข้อมูลที่แก้ยังอยู่ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง",
    retry: "ลองอีกครั้ง",
    layoutTitle: "ระยะห่างสม่ำเสมอทุกหน้าจอ",
    spacing: "ระยะห่าง",
    spacingCopy:
      "หน่วยพื้นฐาน 4px ช่องกรอกห่าง 8px ส่วนงานห่าง 16px กลุ่มงานห่าง 24px และบทเอกสารห่าง 40px",
    responsive: "การปรับตามหน้าจอ",
    mobile: "โทรศัพท์",
    mobileCopy: "เรียงช่องกรอกแนวตั้ง ย่อเมนู และให้ปุ่มอยู่ในความกว้างเนื้อหา",
    desktop: "เดสก์ท็อป",
    desktopCopy:
      "ใช้พื้นที่สำหรับรายการและผัง จำกัดฟอร์มที่ 48rem และรายละเอียดที่ 80rem",
    accessibility: "การเข้าถึง",
    accessCopy:
      "โฟกัสคีย์บอร์ด การลดการเคลื่อนไหว ป้ายสถานะที่อ่านง่าย และชื่อไทยยาวเป็นส่วนหนึ่งของการออกแบบ",
    footer:
      "อ้างอิงระบบ Storage Planner จริงและแนวทาง Impeccable ข้อเสนอสำหรับพิจารณา",
    sourceNotes: "แหล่งอ้างอิงและแนวทางนำไปใช้",
    success: "เสร็จสมบูรณ์",
    warning: "ต้องตรวจสอบ",
    danger: "ข้อผิดพลาด",
    pending: "รอดำเนินการ",
    mapped: "ผูกตำแหน่งแล้ว",
    stored: "จัดเก็บแล้ว",
    awaiting: "รอจัดเก็บ",
    measure: "รอวัดขนาด",
    productBarcode: "บาร์โค้ดสินค้า",
    aiOrigin: "ข้อมูลจาก AI",
    scanned: "สแกนบาร์โค้ด",
    manual: "กรอกเอง",
    moreDetails: "รายละเอียดเพิ่มเติม",
    scanTitle: "สแกนใบ Job",
    scanSummary: "เลือกตำแหน่งก่อน แล้วสแกนใบงานของแต่ละพาเลท",
    locationName: "ฝั่งซ้าย · ชั้น 1",
    ticket: "ใบงาน 1",
    advisory: "ตรวจสอบค่าที่อ่านได้ก่อนบันทึก",
    sampleTicket: "ใบงานตัวอย่างพร้อมบันทึก 1 ใบ",
    saveTickets: "บันทึกใบงาน",
    savedTicket: "บันทึกตัวอย่างแล้ว ไม่มีการเขียนข้อมูลคลังจริง",
    requiredTicket: "กรอกทั้งเลขที่ Job และบาร์โค้ดสินค้า",
    partName: "ชื่อชิ้นงาน",
    customer: "ลูกค้า",
    deliveryDate: "วันส่งสินค้า",
    manufacturingDate: "วันผลิต",
    quantity: "จำนวน",
    factoryQuantity: "จำนวนโรงงาน",
    customerQuantity: "จำนวนลูกค้า",
    scanCaption:
      "ลดกรอบใบงาน แสดงข้อมูลจำเป็นสองช่อง และเก็บข้อมูลรองในส่วนที่เปิดดูได้ คงคำเตือนให้ตรวจสอบและขั้นตอนเลือกตำแหน่งก่อน",
    catalogueTitle: "สินค้าสำเร็จรูป",
    catalogueSummary: "เตรียมสินค้าและยืนยันตำแหน่งจัดเก็บ",
    addProduct: "เพิ่มสินค้าสำเร็จรูป",
    products: "สินค้า",
    storedUnits: "หน่วยที่จัดเก็บแล้ว",
    searchProducts: "ค้นหาสินค้าสำเร็จรูป",
    filterAll: "ทุกรายการ",
    filterStored: "จัดเก็บแล้วเท่านั้น",
    product: "สินค้า",
    status: "สถานะ",
    units: "จำนวน",
    sampleRecords: "รายการตัวอย่าง",
    page: "หน้า 1",
    cartons: "กล่อง",
    productOne: "กล่องสินค้าอุปโภคบริโภค",
    productTwo: "ชิ้นส่วนอะไหล่",
    productThree: "บรรจุภัณฑ์กันกระแทก",
    noResults: "ไม่พบสินค้า ลองค้นด้วยรหัสหรือชื่ออื่น",
    catalogueCaption:
      "เปลี่ยนยอดรวมในกล่องเป็นแถวสรุป ใช้ตารางร่วมกัน จัดจำนวนชิดขวา และวางตัวกรองกับการแบ่งหน้าให้ต่อเนื่อง ทั้งสามรายการเป็นข้อมูลสมมติ",
    floorTitle: "อาคาร DEMO-01",
    floorSummary: "ชั้น 1 · 12 × 20 m · ผังสมมติ",
    floorLocation: "ตำแหน่งจัดเก็บ",
    floorDimensions: "ขนาด",
    floorContents: "สิ่งที่จัดเก็บ",
    floorContentsValue: "พาเลทตัวอย่าง 2 พาเลท",
    inspect: "ดูตำแหน่ง",
    selectLocation: "เลือกตำแหน่งจัดเก็บ",
    walkway: "ทางเดิน",
    location: "ตำแหน่ง",
    selected: "เลือกอยู่",
    floorNotice: "เลือกตำแหน่งตัวอย่างแล้ว ในแอปจริงจะเปิดแผงรายละเอียดเดิม",
    floorCaption:
      "คงพื้นผิวผังหลักเพียงพื้นที่เดียว ใช้เส้นน้ำเงินแสดงการเลือก และสีทางเดินบอกพื้นที่จริง แผงรายละเอียดอยู่ข้างผังบนเดสก์ท็อปและใต้ผังบนโทรศัพท์",
    hrTitle: "วันนี้",
    hrSummary: "ศุกร์ 9 ตุลาคม 2026 · EMP-DEMO-001",
    clockIn: "เวลาเข้า",
    clockOut: "เวลาออก",
    clockedIn: "เข้างานแล้ว",
    clockedOut: "ออกงานแล้ว",
    plannedShift: "กะตามแผน",
    break: "พัก 60 นาที",
    sampleSite: "คลังตัวอย่าง",
    site: "สถานที่",
    clockOutAction: "ลงเวลาออก",
    completeDay: "การลงเวลาวันนี้เสร็จสมบูรณ์",
    hrPolicy:
      "ในแอปจริง เซิร์ฟเวอร์เป็นผู้บันทึกเวลา การลงเวลาออนไลน์ระบุสถานที่ที่มอบหมาย แต่ไม่ได้ยืนยันการอยู่ในพื้นที่จริง",
    hrSampleClock: "แสดงเวลาออกตัวอย่างแล้ว ไม่มีการบันทึกเวลางานจริง",
    hrCaption:
      "ลดกล่องสีของเวลาเข้าออก คงเวลาจริงให้เด่น และแยกแผนกะให้ชัด แสดงการลงเวลาถัดไปเพียงหนึ่งรายการ การตรวจโดยหัวหน้าและการรับรองงวดยังคงเป็นคนละขั้นตอน",
    demoNotice: "นี่คือตัวอย่างการออกแบบ ไม่มีการเปลี่ยนข้อมูลในแอป",
    photoNotice: "เลือกขั้นตอนถ่ายรูปแล้ว ในแอปจริงจะเปิดตัวถ่ายรูปเดิม",
    barcodeNotice: "เลือกขั้นตอนบาร์โค้ดแล้ว ในแอปจริงจะเปิดเครื่องสแกนเดิม",
    manualNotice: "เลือกกรอกเองแล้ว แก้ไขช่องข้อมูลจำเป็นด้านล่างได้",
    detailNotice:
      "ช่องกรอกสูง 36px บนเดสก์ท็อป และ 48px บนโทรศัพท์ มุมโค้ง 6.4px และโฟกัสชัดเจน",
    removedNotice: "เลือกตัวอย่างการลบแล้ว การลบจริงใช้การยืนยันและสิทธิ์เดิม",
    retryNotice: "ทดลองลองใหม่สำเร็จ ข้อมูลตัวอย่างยังคงอยู่",
  },
};

let language = "en";
let screen = "scan";
let dark = false;
let storedOnly = false;
let productQuery = "";
let floorSelection = "FG1-L01";
let clockedOut = false;
const NUMBER_FIELDS_FOR_SHEET = new Set([
  "quantity",
  "factoryQuantity",
  "customerQuantity",
]);
const aiFields = new Set(["factoryOrder"]);
const draft = {
  factoryOrder: "FO26090042",
  productBarcodeText: "8850000000042",
  partName: "Consumer goods carton",
  customer: "Demo customer",
  deliveryDate: "2026-10-12",
  manufacturingDate: "2026-10-09",
  quantity: "24",
  factoryQuantity: "24",
  customerQuantity: "24",
};
// Keep wording changes on the original sheet; comparison layouts retain their copy.
const originalSheet = !document.querySelector("[data-variant-choice]");
const refinedCopy = {
  en: {
    sampleWorkspace: "Demo · no live changes",
    scanTab: "Scan",
    scanTitle: "Job tickets",
    scanSummary: "One per pallet.",
    advisory: "Check extracted values against the original.",
    moreDetails: "Optional details",
    sampleTicket: "1 draft",
    saveTickets: "Save",
    savedTicket: "Saved in this preview only.",
    factoryQuantity: "Leaving factory",
    customerQuantity: "At customer",
    catalogueSummary: "Track preparation and storage.",
    addProduct: "Add",
    searchProducts: "Search by code or name",
    sampleRecords: "shown",
    noResults: "No matches. Try another code or name, or clear the filter.",
    inspect: "Open details",
    floorNotice: "Further details are unavailable here.",
    hrTitle: "Attendance",
    clockIn: "Start",
    clockOut: "End",
    clockedIn: "In progress",
    clockedOut: "Complete",
    hrPolicy:
      "Online clocking uses server time and your assigned site; it does not confirm physical presence.",
    hrSampleClock: "Preview updated.",
    photoNotice: "Photo capture is unavailable here. Enter the values by hand.",
    barcodeNotice: "The scanner is unavailable here. Enter the values by hand.",
    manualNotice: "Fill in the two required fields.",
    createNotice: "Creating records is unavailable here.",
    attendanceNotice: "Further details are unavailable here.",
    palletQuantity: "Sheets per pallet",
    factoryQuantityAccessible: "Sheets per pallet leaving factory",
    customerQuantityAccessible: "Sheets per pallet at customer",
    allCount: "Total",
    measurementCount: "To measure",
    placementCount: "To store",
    storedCount: "In storage",
    addProductAccessible: "Add finished good",
    searchProductsAccessible: "Search finished goods",
    emptyState: "Getting started",
    emptyCopy: "Choose a storage location to begin.",
    failureState: "Error",
    failureCopy: "Your edits are still here. Check your connection.",
    plannedShift: "Schedule",
  },
  th: {
    sampleWorkspace: "ตัวอย่าง · ไม่แก้ข้อมูลจริง",
    scanTab: "สแกน",
    scanTitle: "ใบ Job",
    scanSummary: "หนึ่งใบต่อพาเลท",
    advisory: "ตรวจค่าที่อ่านได้เทียบกับต้นฉบับ",
    moreDetails: "ข้อมูลเสริม",
    sampleTicket: "ฉบับร่าง 1 ใบ",
    saveTickets: "บันทึก",
    savedTicket: "เก็บไว้ในตัวอย่างนี้เท่านั้น",
    factoryQuantity: "ออกจากโรงงาน",
    customerQuantity: "ลงงานให้ลูกค้า",
    catalogueSummary: "ติดตามการเตรียมและจัดเก็บ",
    addProduct: "เพิ่ม",
    searchProducts: "ค้นด้วยรหัสหรือชื่อ",
    sampleRecords: "รายการที่แสดง",
    noResults: "ไม่พบรายการ ลองใช้รหัสหรือชื่ออื่น หรือปิดตัวกรอง",
    inspect: "เปิดรายละเอียด",
    floorNotice: "หน้านี้ยังไม่เชื่อมข้อมูลเพิ่มเติม",
    hrTitle: "การลงเวลา",
    clockIn: "เริ่ม",
    clockOut: "สิ้นสุด",
    clockedIn: "ยังไม่ปิดรายการ",
    clockedOut: "ครบแล้ว",
    hrPolicy:
      "ระบบใช้เวลาจากเซิร์ฟเวอร์และสถานที่ที่มอบหมาย โดยไม่ยืนยันการอยู่ในพื้นที่จริง",
    hrSampleClock: "อัปเดตตัวอย่างแล้ว",
    photoNotice: "หน้านี้ยังใช้กล้องไม่ได้ กรุณากรอกค่าด้วยตัวเอง",
    barcodeNotice: "หน้านี้ยังใช้เครื่องสแกนไม่ได้ กรุณากรอกค่าด้วยตัวเอง",
    manualNotice: "กรอกข้อมูลจำเป็นทั้งสองช่อง",
    createNotice: "หน้านี้ยังสร้างรายการจริงไม่ได้",
    attendanceNotice: "หน้านี้ยังไม่เชื่อมข้อมูลเพิ่มเติม",
    palletQuantity: "จำนวนแผ่นต่อพาเลท",
    factoryQuantityAccessible: "จำนวนแผ่นต่อพาเลทตอนออกจากโรงงาน",
    customerQuantityAccessible: "จำนวนแผ่นต่อพาเลทตอนลงงานให้ลูกค้า",
    allCount: "ทั้งหมด",
    measurementCount: "รอวัดขนาด",
    placementCount: "รอจัดเก็บ",
    storedCount: "เก็บเข้าที่แล้ว",
    addProductAccessible: "เพิ่มสินค้าสำเร็จรูป",
    searchProductsAccessible: "ค้นหาสินค้าสำเร็จรูป",
    emptyState: "เริ่มต้น",
    emptyCopy: "เลือกตำแหน่งจัดเก็บก่อนเริ่ม",
    failureState: "ข้อผิดพลาด",
    failureCopy: "ข้อมูลที่แก้ยังอยู่ กรุณาตรวจสอบการเชื่อมต่อ",
    plannedShift: "กำหนดการ",
  },
};
const t = (key) =>
  (originalSheet ? refinedCopy[language][key] : undefined) ??
  copy[language][key] ??
  copy.en[key] ??
  key;
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const badge = (tone, label) =>
  `<span class="badge ${tone}">${svg({ success: "check", warning: "warning", danger: "error", pending: "pending", neutral: "box" }[tone])}${label}</span>`;
const field = (
  key,
  label,
  required = false,
  ai = false,
  accessibleName = null,
) =>
  `<div class="field ${NUMBER_FIELDS_FOR_SHEET.has(key) ? "number-field" : ""}"><label class="field-label" for="ticket-${key}"><span>${t(label)}${required ? ' <span aria-hidden="true">*</span>' : ""}</span>${ai && aiFields.has(key) ? `<span class="origin">${t("aiOrigin")}</span>` : ""}</label><input id="ticket-${key}" data-draft="${key}" value="${escapeHtml(draft[key])}" ${accessibleName ? `aria-label="${escapeHtml(t(accessibleName))}"` : ""} ${required ? "required" : ""} ${key === "factoryOrder" || key === "productBarcodeText" ? 'class="mono"' : ""} autocomplete="off" spellcheck="false" ${key.includes("Quantity") || key === "quantity" ? 'inputmode="decimal"' : ""}/></div>`;

function renderOptionalFields() {
  const fields = [
    "partName",
    "customer",
    "deliveryDate",
    "manufacturingDate",
    "quantity",
  ];
  if (!originalSheet) {
    return [...fields, "factoryQuantity", "customerQuantity"]
      .map((key) => field(key, key))
      .join("");
  }
  return `${fields.map((key) => field(key, key)).join("")}<div class="quantity-pair" role="group" aria-labelledby="pallet-quantity-label"><span id="pallet-quantity-label" class="quantity-label">${t("palletQuantity")}</span>${field("factoryQuantity", "factoryQuantity", false, false, "factoryQuantityAccessible")}${field("customerQuantity", "customerQuantity", false, false, "customerQuantityAccessible")}</div>`;
}

function renderScan() {
  return `<div class="workflow-title"><div><h3>${t("scanTitle")}</h3><p>${t("scanSummary")}</p></div></div>
    <div class="location-strip">${svg("pin")}<strong class="mono">FG1-L01</strong>${badge("success", t("mapped"))}<span class="location-name">${t("locationName")}</span></div>
    <div class="ticket-toolbar"><button class="btn outline" type="button" data-demo="photoNotice">${svg("camera")}${t("addPhoto")}</button><button class="btn quiet" type="button" data-demo="barcodeNotice">${svg("barcode")}${t("scanned")}</button><button class="btn quiet" type="button" data-demo="manualNotice">${svg("keyboard")}${t("manual")}</button></div>
    <p class="review-advisory">${svg("info")}${t("advisory")}</p>
    <form id="ticket-form" novalidate>${originalSheet ? "" : `<div class="ticket-heading"><strong>${t("ticket")}</strong></div>`}<div class="field-grid">${field("factoryOrder", "jobNumber", true, true)}${field("productBarcodeText", "productBarcode", true)}</div>
      <details class="detail-disclosure"><summary>${t("moreDetails")} · 7</summary><div class="field-grid detail-grid">${renderOptionalFields()}</div></details>
      <div class="save-row"><p>${t("sampleTicket")}</p><button type="submit" class="btn primary">${t("saveTickets")}${svg("arrow")}</button></div><p id="workflow-feedback" class="inline-feedback" role="status" aria-live="polite"></p></form>`;
}

function renderCatalogue() {
  return `<div class="workflow-title"><div><h3>${t("catalogueTitle")}</h3><p>${t("catalogueSummary")}</p></div><button class="btn primary" type="button" data-demo="${originalSheet ? "createNotice" : "demoNotice"}" ${originalSheet ? `aria-label="${t("addProductAccessible")}"` : ""}>${svg("plus")}${t("addProduct")}</button></div>
    <dl class="stat-strip"><div><dt>${t(originalSheet ? "allCount" : "products")}</dt><dd>3</dd></div><div><dt>${t(originalSheet ? "measurementCount" : "measure")}</dt><dd>1</dd></div><div><dt>${t(originalSheet ? "placementCount" : "awaiting")}</dt><dd>1</dd></div><div><dt>${t(originalSheet ? "storedCount" : "storedUnits")}</dt><dd>1</dd></div></dl>
    <div class="catalogue-search"><div class="search-wrap">${svg("search")}<input class="search-input" id="product-search" type="search" value="${escapeHtml(productQuery)}" placeholder="${t("searchProducts")}" aria-label="${t(originalSheet ? "searchProductsAccessible" : "searchProducts")}"/></div><button type="button" id="catalogue-filter" class="btn outline" aria-pressed="${storedOnly}">${t(storedOnly ? "filterStored" : "filterAll")}</button></div>
    <div class="table-scroll" tabindex="0" role="region" aria-label="${t("catalogueTitle")}"><table class="sample-table"><thead><tr><th scope="col">${t("product")}</th><th scope="col">${t("status")}</th><th scope="col" class="numeric">${t("units")}</th></tr></thead><tbody id="product-rows"></tbody></table></div>
    <div class="table-footer"><span class="small" id="product-count"></span><span class="small">${t("page")}</span></div><p id="workflow-feedback" class="inline-feedback" role="status" aria-live="polite"></p>`;
}

function updateProducts() {
  const rows = [
    {
      code: "DEMO-FG-001",
      name: "productOne",
      status: "stored",
      tone: "success",
      quantity: 24,
    },
    {
      code: "DEMO-FG-002",
      name: "productTwo",
      status: "awaiting",
      tone: "warning",
      quantity: 12,
    },
    {
      code: "DEMO-FG-003",
      name: "productThree",
      status: "measure",
      tone: "pending",
      quantity: 36,
    },
  ].filter(
    (row) =>
      (!storedOnly || row.status === "stored") &&
      `${row.code} ${t(row.name)}`
        .toLowerCase()
        .includes(productQuery.toLowerCase()),
  );
  document.querySelector("#product-rows").innerHTML = rows.length
    ? rows
        .map(
          (row) =>
            `<tr><td><strong class="mono">${row.code}</strong><span class="table-description">${t(row.name)}</span></td><td>${badge(row.tone, t(row.status))}</td><td class="numeric">${row.quantity} ${t("cartons")}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3">${t("noResults")}</td></tr>`;
  document.querySelector("#product-count").textContent =
    `${rows.length} ${t("sampleRecords")}`;
}

function renderFloor() {
  const zone = (code, y) =>
    `<g role="button" tabindex="0" data-zone="${code}" aria-label="${t("selectLocation")} ${code}" aria-pressed="${floorSelection === code}"><rect class="${floorSelection === code ? "zone-selected" : "zone"}" x="24" y="${y}" width="96" height="54" rx="2"/><text x="72" y="${y + 32}" text-anchor="middle">${code}</text></g>`;
  return `<div class="workflow-title"><div><h3>${t("floorTitle")}</h3><p>${t("floorSummary")}</p></div></div>
    <div class="floor-layout"><div><div class="floor-map"><svg viewBox="0 0 300 240" role="group" aria-label="${t("floorTab")}"><rect x="8" y="8" width="284" height="224" fill="none" stroke="var(--scene-boundary)"/><path d="M8 80h284M8 160h284M80 8v224M160 8v224M240 8v224" stroke="var(--scene-grid)" opacity=".35"/><rect class="walkway" x="136" y="18" width="30" height="204"/><text class="walkway-text" x="151" y="126" text-anchor="middle" transform="rotate(-90 151 126)">${t("walkway")}</text>${zone("FG1-L01", 30)}${zone("FG1-L02", 140)}<rect class="zone" x="190" y="30" width="80" height="164" rx="2"/><text x="230" y="55" text-anchor="middle">FG1-R01</text><rect class="pallet" x="202" y="76" width="26" height="36" rx="1"/><rect class="pallet" x="234" y="76" width="26" height="36" rx="1"/></svg></div><div class="floor-legend"><span><i class="legend-line"></i>${t("location")}</span><span><i class="legend-line selected"></i>${t("selected")}</span>${originalSheet ? "" : `<span><i class="legend-line walkway"></i>${t("walkway")}</span>`}</div></div>
    <aside class="floor-inspector" aria-label="${t("floorLocation")}"><h4>${floorSelection}</h4><dl><div><dt>${t("floorDimensions")}</dt><dd class="mono">4.0 × 2.0 m</dd></div><div><dt>${t("floorContents")}</dt><dd>0 ${language === "th" ? "พาเลท" : "pallets"}</dd></div></dl><button class="btn outline" type="button" data-demo="floorNotice">${t("inspect")}</button></aside></div><p id="workflow-feedback" class="inline-feedback" role="status" aria-live="polite"></p>`;
}

function renderHr() {
  return `<div class="workflow-title"><div><h3>${t("hrTitle")}</h3><p>${t("hrSummary")}</p></div>${badge("success", t(clockedOut ? "clockedOut" : "clockedIn"))}</div>
    <div class="time-grid"><div class="time-cell"><p>${t("clockIn")}</p><strong class="recorded">08:29</strong></div><div class="time-cell"><p>${t("clockOut")}</p><strong class="${clockedOut ? "recorded" : "unrecorded"}">${clockedOut ? "17:31" : "—"}</strong></div></div>
    <div class="shift-strip"><span>${t("plannedShift")} <strong>08:30–17:30 · ${t("break")}</strong></span><span>${t("site")} <strong>${t("sampleSite")}</strong></span></div>
    <div class="hr-action-row">${originalSheet ? "" : `<p class="small">${clockedOut ? t("completeDay") : t("demoNotice")}</p>`}${clockedOut ? `<button class="btn outline" type="button" data-demo="${originalSheet ? "attendanceNotice" : "demoNotice"}">${t("viewDetails")}</button>` : `<button id="sample-clock-out" class="btn primary" type="button">${t("clockOutAction")}${svg("arrow")}</button>`}</div>
    <p class="hr-policy">${t("hrPolicy")}</p><p id="workflow-feedback" class="inline-feedback" role="status" aria-live="polite"></p>`;
}

function renderWorkflow() {
  const panel = document.querySelector("#workflow-panel");
  panel.setAttribute("aria-labelledby", `tab-${screen}`);
  panel.innerHTML = {
    scan: renderScan,
    catalogue: renderCatalogue,
    floor: renderFloor,
    hr: renderHr,
  }[screen]();
  document.querySelector("#workflow-caption").textContent = t(
    `${screen}Caption`,
  );
  if (screen === "catalogue") updateProducts();
}

function updateAppearance() {
  document.documentElement.classList.toggle("dark", dark);
  const themeButton = document.querySelector("#theme-toggle");
  themeButton.innerHTML = svg(dark ? "sun" : "moon");
  themeButton.setAttribute("aria-pressed", String(dark));
  themeButton.setAttribute(
    "aria-label",
    language === "th"
      ? dark
        ? "เปลี่ยนเป็นโหมดสว่าง"
        : "เปลี่ยนเป็นโหมดมืด"
      : `Switch to ${dark ? "light" : "dark"} mode`,
  );
  const values = dark
    ? {
        primary: "oklch(0.46 0.22 266)",
        canvas: "oklch(0 0 0)",
        surface: "oklch(0.145 0 0)",
        border: "#858585",
        muted: "oklch(0.72 0 0)",
      }
    : {
        primary: "oklch(0.4901 0.2875 264.3293)",
        canvas: "oklch(0.985 0 0)",
        surface: "oklch(1 0 0)",
        border: "#808080",
        muted: "oklch(0.44 0 0)",
      };
  Object.entries(values).forEach(([key, value]) => {
    document.querySelector(`#${key}-value`).textContent = value;
  });
}

function renderLanguage() {
  document.documentElement.lang = language;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.innerHTML = t(element.dataset.i18n);
  });
  document.querySelector("#language-label").textContent =
    language === "en" ? "ไทย" : "EN";
  document
    .querySelector("#language-toggle")
    .setAttribute(
      "aria-label",
      language === "en" ? "Switch to Thai" : "Switch to English",
    );
  document.querySelector("#semantic-statuses").innerHTML = [
    "success",
    "warning",
    "danger",
    "pending",
  ]
    .map((tone) => badge(tone, t(tone)))
    .join("");
  document.querySelector("#control-feedback").textContent = "";
  document
    .querySelector(".skeleton-example")
    .setAttribute("aria-label", t("loadingState"));
  updateAppearance();
  renderWorkflow();
}

function selectScreen(next, focus = false) {
  screen = next;
  document.querySelectorAll("[data-screen]").forEach((tab) => {
    const active = tab.dataset.screen === screen;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  renderWorkflow();
}

document.querySelector("#warehouse-icon").innerHTML = svg("warehouse");
document.querySelector("#caption-icon").innerHTML = svg("info");
document.querySelector("#empty-icon").innerHTML = svg("barcode");
document.querySelector("#error-icon").innerHTML = svg("error");
document.querySelector("#theme-toggle").addEventListener("click", () => {
  dark = !dark;
  updateAppearance();
});
document.querySelector("#language-toggle").addEventListener("click", () => {
  language = language === "en" ? "th" : "en";
  renderLanguage();
});
document
  .querySelector("#print-sheet")
  .addEventListener("click", () => window.print());
document
  .querySelectorAll("[data-screen]")
  .forEach((tab) =>
    tab.addEventListener("click", () => selectScreen(tab.dataset.screen)),
  );
document
  .querySelector(".specimen-tabs")
  .addEventListener("keydown", (event) => {
    const screens = ["scan", "catalogue", "floor", "hr"];
    const index = screens.indexOf(screen);
    const target = {
      ArrowRight: screens[(index + 1) % screens.length],
      ArrowLeft: screens[(index + screens.length - 1) % screens.length],
      Home: screens[0],
      End: screens.at(-1),
    }[event.key];
    if (target) {
      event.preventDefault();
      selectScreen(target, true);
    }
  });
document.querySelector("#workflow-panel").addEventListener("input", (event) => {
  if (event.target.dataset.draft) {
    draft[event.target.dataset.draft] = event.target.value;
    aiFields.delete(event.target.dataset.draft);
    event.target.closest(".field").querySelector(".origin")?.remove();
    event.target.removeAttribute("aria-invalid");
  }
  if (event.target.id === "product-search") {
    productQuery = event.target.value;
    updateProducts();
  }
});
document
  .querySelector("#workflow-panel")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    const valid = draft.factoryOrder.trim() && draft.productBarcodeText.trim();
    ["factoryOrder", "productBarcodeText"].forEach((key) =>
      document
        .querySelector(`#ticket-${key}`)
        .setAttribute("aria-invalid", String(!draft[key].trim())),
    );
    const feedback = document.querySelector("#workflow-feedback");
    feedback.textContent = t(valid ? "savedTicket" : "requiredTicket");
    feedback.style.color = `var(--token-${valid ? "success" : "danger"})`;
    if (!valid) document.querySelector('[aria-invalid="true"]').focus();
  });
document.querySelector("#workflow-panel").addEventListener("click", (event) => {
  const demo = event.target.closest("[data-demo]");
  if (demo) {
    document.querySelector("#workflow-feedback").textContent = t(
      demo.dataset.demo,
    );
    if (demo.dataset.demo === "manualNotice")
      document.querySelector("#ticket-factoryOrder").focus();
  }
  if (event.target.closest("#catalogue-filter")) {
    storedOnly = !storedOnly;
    const button = document.querySelector("#catalogue-filter");
    button.textContent = t(storedOnly ? "filterStored" : "filterAll");
    button.setAttribute("aria-pressed", String(storedOnly));
    updateProducts();
  }
  const zone = event.target.closest("[data-zone]");
  if (zone) {
    floorSelection = zone.dataset.zone;
    renderWorkflow();
    document.querySelector(`[data-zone="${floorSelection}"]`).focus();
  }
  if (event.target.closest("#sample-clock-out")) {
    clockedOut = true;
    renderWorkflow();
    document.querySelector("#workflow-feedback").textContent =
      t("hrSampleClock");
    document.querySelector(".hr-action-row button").focus();
  }
});
document
  .querySelector("#workflow-panel")
  .addEventListener("keydown", (event) => {
    if (event.target.dataset.zone && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });
const feedbackActions = {
  "demo-primary": "demoNotice",
  "demo-secondary": "demoNotice",
  "demo-details": "detailNotice",
  "demo-remove": "removedNotice",
  "demo-add": "photoNotice",
  "demo-retry": "retryNotice",
};
Object.entries(feedbackActions).forEach(([id, key]) =>
  document.querySelector(`#${id}`).addEventListener("click", () => {
    document.querySelector("#control-feedback").textContent = t(key);
  }),
);
document.querySelector("#demo-required").addEventListener("input", (event) => {
  const invalid = !event.target.value.trim();
  event.target.setAttribute("aria-invalid", String(invalid));
  document.querySelector("#required-error").textContent = invalid
    ? t("requiredError")
    : "";
});
renderLanguage();
