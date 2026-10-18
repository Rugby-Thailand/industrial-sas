"use strict";

// Root sheet only. The comparison layouts use frozen 8b0ef538 assets.
const reviewCopy = {
  en: {
    datePicker: "Date",
    timePicker: "Time",
    pickerHint: "Select a date or a 24-hour time.",
    sourceTokens: "2026-10-09 palette snapshot · application primary #1d4ed8.",
    touchRule: "Fields: 32px on desktop · 40px on touch / small screens",
    detailNotice:
      "Compact fields keep their icons centered and their focus edge visible.",
    scanSummary: "Read a job ticket for each storage unit.",
    jobNumber: "Job No.",
    requiredError: "Enter a Job No. before saving.",
    manufacturingDate: "MFG date",
    mapped: "Location set",
    addPhoto: "Photos (AI)",
    hrTitle: "Friday, 9 October 2026",
    hrSummary: "Demo employee · EMP-DEMO-001",
    clockIn: "Clock-in",
    clockOut: "Clock-out",
    clockedIn: "Clocked in",
    clockedOut: "Clocked out",
    allCount: "Products",
    emptyCopy: "Take a photo of a job ticket or scan its barcode.",
    failureState: "Finished goods · save error",
    notSaved: "Could not save",
    failureCopy:
      "Check your input and connection, then retry. Your draft is kept.",
    floorSummary: "Floor 1 · 15 × 12 m · schematic",
    floorCaption:
      "Details sit beside the map on wide workspaces and open in a sheet on narrow ones. This schematic illustrates selection, not production geometry.",
    catalogueCaption:
      "Warehouse totals stay independent of the displayed records. Products use Ready or Draft; storage units carry workflow statuses. These three rows are synthetic; real cursor paging and phone lists stay in the app.",
    reviewState: "Review state",
    normalState: "Normal",
    loadingState: "Loading",
    readingState: "Reading",
    unavailableState: "Unavailable totals",
    viewOnlyState: "View only",
    unknownState: "Unknown inventory",
    pendingState: "Pending write",
    uncertainState: "Not confirmed",
    unlinkedState: "Account not linked",
    unresolvedState: "Earlier day open",
    refusedState: "Refused",
    deniedState: "Denied",
    change: "Change",
    changeLocation: "Change location",
    locationContext: "DEMO-01 · Floor 1",
    stockNote: "Saving tickets does not confirm storage at this location.",
    unitType: "Unit type",
    pallet: "Pallet",
    box: "Package / box",
    other: "Other",
    filled: "filled",
    sourceAi: "AI",
    sourceManual: "Manual",
    removeTicket: "Remove #1",
    scanField: "Scan",
    scanSaveName: "Save 1 ticket",
    requiredBlocker: "Every ticket needs a Job No. and a product barcode.",
    quantityBlocker: "Use non-negative numbers for quantities.",
    readingBlocker: "Wait for the ticket to finish reading.",
    viewOnlyCopy:
      "Your role allows viewing. Ask an administrator for edit access.",
    savedTitle: "Saved 1 ticket at FG1-L01",
    scanMore: "Scan more",
    viewRecords: "View records",
    storageUnits: "Storage units",
    ready: "Ready",
    draftStatus: "Draft",
    totalInUnits: "Total in storage units",
    totalsScope:
      "Warehouse totals · workflow counts are storage units, independent of this page and filters.",
    totalsRules:
      "To store includes reserved units. Moving units are excluded from In storage.",
    movingUnits: "Moving units: 2",
    unavailable: "Unavailable",
    summaryUnavailable:
      "Warehouse totals could not be loaded. Records remain available.",
    filters: "Filters",
    readyOnly: "Ready only",
    storedOnly: "In storage only",
    clearFilters: "Clear filters",
    noResults: "No matches",
    noResultsHint: "Try another code or name, or clear the filters.",
    perPage: "Per page",
    previous: "Previous",
    next: "Next",
    pageOne: "Page 1",
    recordScope: "sample records shown",
    productBreakdown: "Pallets",
    unrecorded: "Not recorded yet",
    viewDay: "View this day",
    receipt: "Clocked out at 17:31",
    timeHistory: "View time history",
    requests: "My correction requests",
    noRequests: "No correction requests yet",
    viewAll: "View all",
    unlinkedTitle: "Your account is not linked to an employee record",
    unlinkedHint: "HR must link your account before you can clock in.",
    pendingCopy: "Waiting for the server response. Keep this page open.",
    uncertainTitle: "We could not confirm whether this was saved",
    uncertainCopy:
      "The connection dropped before the reply. Retrying is safe and will not record it twice.",
    safeRetry: "Try again safely",
    refusedTitle: "Nothing was saved",
    refusedCopy: "Your entry is kept. Check the clock details, then try again.",
    deniedTitle: "You cannot record attendance",
    deniedCopy: "Ask HR to review your access.",
    unresolvedTitle: "An earlier day is still open",
    unresolvedCopy: "Review that day's record before continuing.",
    correctDay: "Request a correction",
    hrDomain: "HR attendance",
    statusProposal: "Refined status ink · also present in the app working tree",
    appInk: "Earlier ink",
    adoptionTitle: "Ready to implement in stages",
    adoptionCopy:
      "The preview has compact fields and shadcn/Radix select, date and time controls with confirm-safe dates, a time draft committed by Done, and invalid, pending, read-only, empty and example-range states. The application still needs shared field sizing, centered in-field icons without hover or press movement, color-only text-button hover and press, and HR picker migration.",
    adoptionScope:
      "Kiro's plan covers 40 pages across Storage, Finished Goods, HR, shell and access states, with ten implementation and verification stages.",
    reviewedPlan: "Read the full system plan",
    auditLink: "Earlier Kiro audit · 11 Oct",
    adoptionStatus: "Audit fixes · 15 October 2026",
    retryNotice: "Retry example shown. No application records were written.",
    wordmarkName: "Storage Planner design sheet",
    sectionsName: "Design sheet sections",
    workflowTabsName: "Workflow specimens",
    proposalDate: "9 October 2026",
    languageName: "ไทย · Switch language",
    themeName: "Dark mode",
    removeFilter: "Remove filter",
    loadingValue: "Loading",
    fieldStates: "Field states",
    fieldStatesNote:
      "Examples only. Requirements, ranges and pending writes here illustrate states; they are not business rules.",
    stateInvalid: "Invalid",
    stateBounded: "Example range",
    stateEmpty: "Empty · optional",
    statePending: "Pending",
    stateReadOnly: "Read only",
    stateDisabled: "Disabled",
    dateRequired: "Choose a date before saving.",
    timeRequired: "Choose an hour and minute before saving.",
    boundedHint: "Example range only: 5–23 Oct 2026.",
    emptyTimeHint: "Leave empty, or choose both hour and minute.",
    pendingFieldHint: "Saving… locked until the reply.",
    controlsFallback:
      "The interactive select, date and time controls did not load. Their current values are shown read-only. Reload the sheet to try again.",
  },
  th: {
    datePicker: "วันที่",
    timePicker: "เวลา",
    pickerHint: "เลือกวันที่หรือเวลาแบบ 24 ชั่วโมง",
    sourceTokens: "ชุดสี ณ 9 ต.ค. 2569 · แอปใช้สีหลัก #1d4ed8",
    touchRule: "ช่องกรอก 32px บนคอม · 40px บนจอสัมผัส / จอเล็ก",
    detailNotice: "ช่องกรอกกระชับ ไอคอนอยู่กึ่งกลาง และยังเห็นเส้นโฟกัสชัดเจน",
    scanSummary: "อ่านใบ Job ของแต่ละหน่วยจัดเก็บ",
    jobNumber: "เลขที่ Job",
    manufacturingDate: "วันที่ผลิต",
    partName: "ชื่อสินค้า",
    customer: "ชื่อลูกค้า",
    deliveryDate: "วันที่ส่งสินค้า",
    mapped: "กำหนดจุดแล้ว",
    addPhoto: "รูปภาพ (AI)",
    hrTitle: "วันศุกร์ที่ 9 ตุลาคม 2569",
    hrSummary: "พนักงานตัวอย่าง · EMP-DEMO-001",
    clockIn: "เวลาเข้า",
    clockOut: "เวลาออก",
    clockedIn: "เข้างานแล้ว",
    clockedOut: "ออกงานแล้ว",
    clockOutAction: "ลงเวลาออกงาน",
    allCount: "สินค้า",
    placementCount: "รอเลือกจุดจัดเก็บ",
    location: "จุดจัดเก็บ",
    emptyCopy: "ถ่ายรูปใบ Job หรือสแกนบาร์โค้ดบนใบงาน",
    failureState: "สินค้าสำเร็จรูป · บันทึกไม่สำเร็จ",
    notSaved: "บันทึกไม่ได้",
    failureCopy: "ตรวจข้อมูลและการเชื่อมต่อ แล้วลองใหม่ ฉบับร่างยังอยู่",
    floorSummary: "ชั้น 1 · 15 × 12 ม. · แผนผังตัวอย่าง",
    floorCaption:
      "พื้นที่กว้างแสดงรายละเอียดข้างแผนที่ พื้นที่แคบเปิดในแผงเลื่อน ตัวอย่างนี้อธิบายการเลือกจุด ไม่ใช่แบบพื้นที่จริง",
    catalogueCaption:
      "ยอดคลังไม่ขึ้นกับรายการที่แสดง สินค้ามีสถานะพร้อมหรือฉบับร่าง ส่วนหน่วยจัดเก็บใช้สถานะตามงาน ทั้งสามแถวเป็นข้อมูลตัวอย่าง ระบบจริงยังใช้การแบ่งหน้าแบบเคอร์เซอร์และรายการสำหรับโทรศัพท์",
    reviewState: "ดูสถานะ",
    normalState: "ปกติ",
    loadingState: "กำลังโหลด",
    readingState: "กำลังอ่าน",
    unavailableState: "ยอดคลังไม่พร้อม",
    viewOnlyState: "ดูได้อย่างเดียว",
    unknownState: "ไม่ทราบยอดจัดเก็บ",
    pendingState: "กำลังส่งข้อมูล",
    uncertainState: "ยังไม่ยืนยัน",
    unlinkedState: "บัญชียังไม่เชื่อม",
    unresolvedState: "วันก่อนยังเปิดอยู่",
    refusedState: "ถูกปฏิเสธ",
    deniedState: "ไม่มีสิทธิ์",
    change: "เปลี่ยน",
    changeLocation: "เปลี่ยนจุดจัดเก็บ",
    locationContext: "DEMO-01 · ชั้น 1",
    stockNote: "การบันทึกใบงานไม่ได้ยืนยันว่าเก็บสินค้าในจุดนี้แล้ว",
    unitType: "ประเภทหน่วย",
    pallet: "พาเลท",
    box: "หีบห่อ / กล่อง",
    other: "อื่น ๆ",
    filled: "กรอกแล้ว",
    sourceAi: "AI",
    sourceManual: "กรอกเอง",
    removeTicket: "ลบใบที่ 1",
    scanField: "สแกน",
    scanSaveName: "บันทึกใบงาน 1 ใบ",
    requiredBlocker: "ทุกใบต้องมีเลขที่ Job และบาร์โค้ดสินค้า",
    quantityBlocker: "กรอกจำนวนเป็นตัวเลขที่ไม่ติดลบ",
    readingBlocker: "รอให้อ่านใบงานเสร็จก่อน",
    viewOnlyCopy: "สิทธิ์ของคุณใช้ดูข้อมูลได้ หากต้องแก้ไขให้ติดต่อผู้ดูแลระบบ",
    savedTitle: "บันทึกใบงาน 1 ใบที่ FG1-L01 แล้ว",
    scanMore: "สแกนต่อ",
    viewRecords: "ดูรายการ",
    storageUnits: "หน่วยจัดเก็บ",
    ready: "พร้อม",
    draftStatus: "ฉบับร่าง",
    totalInUnits: "ยอดรวมในหน่วยจัดเก็บ",
    totalsScope:
      "ยอดทั้งคลัง · จำนวนตามขั้นตอนนับเป็นหน่วยจัดเก็บ ไม่ขึ้นกับหน้านี้หรือตัวกรอง",
    totalsRules:
      "รอเลือกจุดรวมหน่วยที่จองไว้ ยอดเก็บเข้าที่ไม่รวมหน่วยที่กำลังย้าย",
    movingUnits: "กำลังย้าย 2 หน่วย",
    unavailable: "ไม่พร้อมใช้งาน",
    summaryUnavailable: "โหลดยอดคลังไม่ได้ ยังดูรายการได้",
    filters: "ตัวกรอง",
    readyOnly: "พร้อมเท่านั้น",
    storedOnly: "เก็บเข้าที่แล้วเท่านั้น",
    clearFilters: "ล้างตัวกรอง",
    noResults: "ไม่พบรายการ",
    noResultsHint: "ลองใช้รหัสหรือชื่ออื่น หรือล้างตัวกรอง",
    perPage: "ต่อหน้า",
    previous: "ก่อนหน้า",
    next: "ถัดไป",
    pageOne: "หน้า 1",
    recordScope: "รายการตัวอย่างที่แสดง",
    productBreakdown: "พาเลท",
    unrecorded: "ยังไม่ได้ลงเวลา",
    viewDay: "ดูวันนี้",
    receipt: "ลงเวลาออกงานแล้ว 17:31",
    timeHistory: "ดูประวัติลงเวลา",
    requests: "คำขอแก้ไขของฉัน",
    noRequests: "ยังไม่มีคำขอแก้ไข",
    viewAll: "ดูทั้งหมด",
    unlinkedTitle: "บัญชีนี้ยังไม่ได้เชื่อมกับประวัติพนักงาน",
    unlinkedHint: "ฝ่ายบุคคลต้องเชื่อมบัญชีของคุณกับพนักงานก่อนจึงจะลงเวลาได้",
    pendingCopy: "กำลังรอคำตอบจากเซิร์ฟเวอร์ กรุณาเปิดหน้านี้ไว้",
    uncertainTitle: "ยังไม่ทราบว่าบันทึกสำเร็จหรือไม่",
    uncertainCopy:
      "การเชื่อมต่อขาดก่อนได้รับคำตอบ ลองใหม่ได้อย่างปลอดภัย ระบบจะไม่บันทึกซ้ำ",
    safeRetry: "ลองส่งอีกครั้ง",
    refusedTitle: "ไม่มีข้อมูลถูกบันทึก",
    refusedCopy: "ข้อมูลที่กรอกยังอยู่ ตรวจรายละเอียดการลงเวลาแล้วลองใหม่",
    deniedTitle: "คุณไม่มีสิทธิ์ลงเวลา",
    deniedCopy: "ติดต่อฝ่ายบุคคลเพื่อตรวจสอบสิทธิ์",
    unresolvedTitle: "วันก่อนยังมีรายการที่ไม่ปิด",
    unresolvedCopy: "ตรวจรายการของวันนั้นก่อนดำเนินการต่อ",
    correctDay: "ขอแก้ไข",
    hrDomain: "การลงเวลา",
    statusProposal: "สีข้อความสถานะที่ปรับแล้ว · มีใน working tree ของแอปแล้ว",
    appInk: "สีข้อความเดิม",
    adoptionTitle: "นำไปใช้ทีละขั้นได้",
    adoptionCopy:
      "Preview มีช่องขนาดกระชับและตัวเลือก วันที่ และเวลาแบบ shadcn/Radix โดยยืนยันวันที่เดิมได้ไม่หาย เวลาบันทึกเมื่อกดเสร็จ และมีสถานะไม่ถูกต้อง กำลังบันทึก อ่านอย่างเดียว ว่าง และช่วงตัวอย่าง งานในแอปที่เหลือคือขนาดช่องร่วม ไอคอนในช่องที่อยู่กลางและไม่เปลี่ยนตอน hover หรือกด ปุ่มข้อความที่เปลี่ยนเฉพาะสีตอน hover และกด และการเปลี่ยนตัวเลือกวันที่กับเวลาใน HR",
    adoptionScope:
      "แผนของ Kiro ครอบคลุม 40 หน้า ทั้ง Storage, Finished Goods, HR, ส่วนกลางและสถานะสิทธิ์ แบ่งงานพัฒนาและตรวจสอบเป็น 10 ขั้น",
    reviewedPlan: "อ่านแผนสำหรับทั้งระบบ",
    auditLink: "ผลตรวจ Kiro เดิม · 11 ต.ค.",
    adoptionStatus: "แก้ตามผลตรวจ · 15 ตุลาคม 2569",
    retryNotice: "แสดงตัวอย่างการส่งซ้ำแล้ว ไม่มีการเขียนข้อมูลจริง",
    wordmarkName: "Storage Planner แผ่นออกแบบ",
    sectionsName: "ส่วนต่าง ๆ ของแผ่นออกแบบ",
    workflowTabsName: "ตัวอย่างขั้นตอนงาน",
    proposalDate: "9 ตุลาคม 2569",
    languageName: "EN · เปลี่ยนภาษา",
    themeName: "โหมดมืด",
    removeFilter: "ลบตัวกรอง",
    loadingValue: "กำลังโหลด",
    fieldStates: "สถานะของช่องกรอก",
    fieldStatesNote:
      "เป็นตัวอย่างเท่านั้น ข้อบังคับ ช่วงวันที่ และการบันทึกที่ค้างอยู่ในส่วนนี้ใช้แสดงสถานะ ไม่ใช่กฎทางธุรกิจ",
    stateInvalid: "ไม่ถูกต้อง",
    stateBounded: "ช่วงตัวอย่าง",
    stateEmpty: "ว่าง · ไม่บังคับ",
    statePending: "กำลังบันทึก",
    stateReadOnly: "อ่านอย่างเดียว",
    stateDisabled: "ปิดใช้งาน",
    dateRequired: "เลือกวันที่ก่อนบันทึก",
    timeRequired: "เลือกชั่วโมงและนาทีก่อนบันทึก",
    boundedHint: "ช่วงตัวอย่างเท่านั้น: 5–23 ต.ค. 2569",
    emptyTimeHint: "เว้นว่างได้ หรือเลือกทั้งชั่วโมงและนาที",
    pendingFieldHint: "กำลังบันทึก… ล็อกไว้จนกว่าจะได้คำตอบ",
    controlsFallback:
      "ตัวเลือก วันที่ และเวลาโหลดไม่สำเร็จ จึงแสดงค่าปัจจุบันแบบอ่านอย่างเดียว โหลดหน้านี้ใหม่เพื่อลองอีกครั้ง",
  },
};
Object.keys(reviewCopy).forEach((lang) =>
  Object.assign(refinedCopy[lang], reviewCopy[lang]),
);

let reviewMode = "normal";
let catalogueView = "products";
let catalogueFiltered = false;
let scanHasTicket = true;
let scanSaved = false;
let scanMethod = "photo";
let scanSource = "AI";
let scanTouched = new Set();
draft.storageFormat = "PALLET";
const optionalKeys = [
  "partName",
  "customer",
  "deliveryDate",
  "manufacturingDate",
  "quantity",
  "factoryQuantity",
  "customerQuantity",
];
const quantityPattern = /^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/;
const quietBadge = (tone, label) =>
  tone === "accent"
    ? `<span class="badge accent"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 9-9 9-9-9Z"/></svg>${label}</span>`
    : badge(tone, label);
const notice = (title, message = "") =>
  `<div class="review-notice" role="status"><strong>${title}</strong>${message ? `<p>${message}</p>` : ""}</div>`;
const feedback = () =>
  '<p id="workflow-feedback" class="inline-feedback" role="status" aria-live="polite"></p>';
const demoLink = (label) =>
  `<button class="text-action" type="button" data-demo="detailNotice">${t(label)}</button>`;
const validQuantity = (value) =>
  !value.trim() ||
  (quantityPattern.test(value.trim()) &&
    Number.isFinite(Number(value.replaceAll(",", ""))));
function resetScanDraft() {
  Object.keys(draft).forEach((key) => {
    draft[key] = key === "storageFormat" ? "PALLET" : "";
  });
  aiFields.clear();
  scanTouched.clear();
  scanMethod = "manual";
  scanSource = "MANUAL";
}
function scanBlocker() {
  if (reviewMode === "reading") return t("readingBlocker");
  if (!draft.factoryOrder.trim() || !draft.productBarcodeText.trim())
    return t("requiredBlocker");
  if ([...NUMBER_FIELDS_FOR_SHEET].some((key) => !validQuantity(draft[key])))
    return t("quantityBlocker");
  return "";
}
// The same arc as the Controls saving specimen; pending is busy, not disabled.
const savingIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 1-9 9"/></svg>';
const selectControl = (markup) => `<span class="select-input">${markup}</span>`;

function scanField(key, label, ai = false) {
  return field(key, label, true, ai).replace(
    /(<input[^>]+\/>)/,
    `<div class="scan-input">$1<button class="btn quiet icon-btn field-scan" type="button" data-demo="barcodeNotice" aria-label="${t("scanField")} ${t(label)}">${svg("barcode")}</button></div>`,
  );
}
function renderReviewScan() {
  if (reviewMode === "viewOnly")
    return notice(t("viewOnlyState"), t("viewOnlyCopy")) + feedback();
  if (scanSaved)
    return `<div class="workflow-title"><h3>${t("savedTitle")}</h3></div><p class="small muted">${t("stockNote")}</p><div class="ticket-toolbar scan-success-actions"><button class="btn primary" id="scan-more" type="button">${t("scanMore")}</button><button class="btn outline" data-demo="detailNotice" type="button">${t("viewRecords")}</button></div>${feedback()}`;
  const reading = reviewMode === "reading";
  return `<div class="workflow-title"><div><h3>${t("scanTitle")}</h3><p>${t("scanSummary")}</p></div></div>
  <div class="location-strip">${svg("pin")}<strong class="mono">FG1-L01</strong>${badge("success", t("mapped"))}<button type="button" class="text-action" data-demo="detailNotice" aria-label="${t("changeLocation")}">${t("change")}</button><span class="location-name">${t("locationContext")}</span></div><p class="small muted stock-note">${t("stockNote")}</p>
  <div class="ticket-toolbar">${[
    ["photo", "camera", "addPhoto"],
    ["barcode", "barcode", "scanned"],
    ["manual", "keyboard", "manual"],
  ]
    .map(
      ([method, icon, label]) =>
        `<button class="btn outline" type="button" data-capture="${method}" aria-pressed="${scanMethod === method}" ${reading ? "disabled" : ""}>${svg(icon)}${t(label)}</button>`,
    )
    .join("")}</div>
  ${
    scanHasTicket
      ? `${scanSource === "AI" ? `<p class="review-advisory">${svg("info")}${t("advisory")}</p>` : ""}<form id="ticket-form" novalidate><div class="ticket-heading"><span>#1 · ${t(scanSource === "AI" ? "sourceAi" : "sourceManual")}</span>${reading ? `<span>${t("readingState")}…</span>` : ""}<button class="btn quiet icon-btn" id="remove-ticket" type="button" aria-label="${t("removeTicket")}" ${reading ? "disabled" : ""}>${svg("error")}</button></div><div class="field-grid scan-required">${scanField("factoryOrder", "jobNumber", true)}${scanField("productBarcodeText", "productBarcode")}<div class="field"><label for="ticket-storageFormat">${t("unitType")}</label>${selectControl(
          `<select id="ticket-storageFormat" data-draft="storageFormat">${[
            ["PALLET", "pallet"],
            ["BOX", "box"],
            ["OTHER", "other"],
          ]
            .map(
              ([value, key]) =>
                `<option value="${value}" ${draft.storageFormat === value ? "selected" : ""}>${t(key)}</option>`,
            )
            .join("")}</select>`,
        )}</div></div>
  <details class="detail-disclosure"><summary>${t("moreDetails")} · <span id="filled-count"></span></summary><div class="field-grid detail-grid">${renderOptionalFields()}</div></details><div class="save-row"><p id="save-blocker" role="status"></p><button type="submit" class="btn primary" id="scan-save" aria-label="${t("scanSaveName")}">${t("saveTickets")}</button></div>${feedback()}</form>`
      : `<div class="empty-example"><strong>${t("noTickets")}</strong><p>${t("emptyCopy")}</p><button type="button" class="btn outline" id="add-ticket">${t("manual")}</button></div>${feedback()}`
  }`;
}
function updateScanValidation() {
  if (!document.querySelector("#ticket-form")) return;
  const count = optionalKeys.filter((key) => draft[key].trim()).length;
  document.querySelector("#filled-count").textContent =
    language === "th" ? `${t("filled")} ${count}` : `${count} ${t("filled")}`;
  const blocker = scanBlocker();
  document.querySelector("#save-blocker").textContent =
    blocker || t("sampleTicket");
  document.querySelector("#scan-save").disabled = !!blocker;
  document
    .querySelectorAll(
      "#ticket-form input, #ticket-form select, #ticket-form .field-scan",
    )
    .forEach((input) => {
      input.disabled = reviewMode === "reading";
    });
  const invalidNumbers = [...NUMBER_FIELDS_FOR_SHEET].filter(
    (key) => !validQuantity(draft[key]),
  );
  if (invalidNumbers.length)
    document.querySelector(".detail-disclosure").open = true;
  for (const key of [
    "factoryOrder",
    "productBarcodeText",
    ...NUMBER_FIELDS_FOR_SHEET,
  ]) {
    const input = document.querySelector(`#ticket-${key}`);
    const invalid = NUMBER_FIELDS_FOR_SHEET.has(key)
      ? invalidNumbers.includes(key)
      : scanTouched.has(key) && !draft[key].trim();
    input.setAttribute("aria-invalid", String(invalid));
    let error = document.querySelector(`#error-${key}`);
    if (invalid && !error) {
      error = document.createElement("p");
      error.id = `error-${key}`;
      error.className = "field-error";
      input.closest(".field").append(error);
    }
    if (invalid) {
      error.textContent = t(
        NUMBER_FIELDS_FOR_SHEET.has(key) ? "quantityBlocker" : "requiredTicket",
      );
      input.setAttribute("aria-describedby", error.id);
    } else {
      error?.remove();
      input.removeAttribute("aria-describedby");
    }
  }
}
function renderReviewCatalogue() {
  const totals = [128, 6, 14, 342];
  return `<div class="workflow-title"><div><h3>${t("catalogueTitle")}</h3><p>${t("catalogueSummary")}</p></div>${reviewMode !== "viewOnly" ? `<button class="btn primary" type="button" data-demo="createNotice" aria-label="${t("addProductAccessible")}">${svg("plus")}${t("addProduct")}</button>` : ""}</div>
  ${reviewMode === "viewOnly" ? notice(t("viewOnlyState"), t("viewOnlyCopy")) : ""}<dl class="stat-strip"${reviewMode === "loading" ? ' aria-busy="true"' : ""}>${["products", "measurementCount", "placementCount", "storedCount"].map((key, i) => `<div><dt>${t(key)}</dt><dd>${reviewMode === "loading" ? `<span aria-hidden="true">…</span><span class="sr-only">${t("loadingValue")}</span>` : reviewMode === "unavailable" ? t("unavailable") : totals[i]}</dd></div>`).join("")}</dl><p class="small muted">${t("totalsScope")}</p><details class="totals-explanation"><summary>${t("totalsRules")}</summary><p class="small">${t("movingUnits")}</p></details>${reviewMode === "unavailable" ? notice(t("summaryUnavailable")) : ""}
  <div class="catalogue-switch" role="group" aria-label="${t("catalogueTab")}">${["products", "storageUnits"].map((view) => `<button type="button" class="btn outline" data-catalogue-view="${view}" aria-pressed="${catalogueView === view}">${t(view)}</button>`).join("")}</div>
  <div class="catalogue-search"><div class="search-wrap">${svg("search")}<input class="search-input" id="product-search" type="search" value="${escapeHtml(productQuery)}" placeholder="${t("searchProducts")}" aria-label="${t("searchProductsAccessible")}"/></div><button type="button" id="review-filter" class="btn outline" aria-pressed="${catalogueFiltered}">${t("filters")}</button></div>${catalogueFiltered ? `<button class="filter-chip" type="button" id="clear-catalogue-filter" aria-label="${t("removeFilter")}: ${t(catalogueView === "products" ? "readyOnly" : "storedOnly")}">${t(catalogueView === "products" ? "readyOnly" : "storedOnly")}${svg("error")}</button>` : ""}
  <div class="table-scroll" tabindex="0" role="region" aria-label="${t("catalogueTitle")}"><table class="sample-table"><thead><tr><th scope="col">${t(catalogueView === "products" ? "product" : "storageUnits")}</th><th scope="col">${t("status")}</th><th scope="col" class="numeric">${t(catalogueView === "products" ? "totalInUnits" : "units")}</th></tr></thead><tbody id="product-rows"></tbody></table></div><div id="catalogue-empty"></div>
  <div class="table-footer"><span class="small" id="product-count"></span><div class="pagination-example"><div class="pagination-size"><label class="small" for="sample-page-size">${t("perPage")}</label>${selectControl('<select id="sample-page-size" disabled><option>20</option></select>')}</div><div class="pagination-nav"><button type="button" class="btn quiet" disabled>${t("previous")}</button><span class="small">${t("pageOne")}</span><button type="button" class="btn quiet" disabled>${t("next")}</button></div></div></div>${feedback()}`;
}
function updateReviewProducts() {
  const rows = [
    {
      code: "DEMO-FG-001",
      unitCode: "UNIT-DEMO-001",
      name: "productOne",
      quantity: 24,
      productStatus: "ready",
      status: "stored",
      tone: "success",
      pallets: 2,
    },
    {
      code: "DEMO-FG-002",
      unitCode: "UNIT-DEMO-002",
      name: "productTwo",
      quantity: 12,
      productStatus: "ready",
      status: "awaiting",
      tone: "warning",
      pallets: 1,
    },
    {
      code: "DEMO-FG-003",
      unitCode: "UNIT-DEMO-003",
      name: "productThree",
      quantity: 36,
      productStatus: "draftStatus",
      status: "measure",
      tone: "pending",
      pallets: 3,
    },
  ].filter(
    (row) =>
      (!catalogueFiltered ||
        (catalogueView === "products"
          ? row.productStatus === "ready"
          : row.status === "stored")) &&
      `${row.code} ${t(row.name)}`
        .toLowerCase()
        .includes(productQuery.trim().toLowerCase()),
  );
  document.querySelector("#product-rows").innerHTML = rows
    .map(
      (row) =>
        `<tr><td><strong>${catalogueView === "products" ? t(row.name) : row.unitCode}</strong><span class="table-description mono">${row.code}</span></td><td>${quietBadge(catalogueView === "products" ? (row.productStatus === "ready" ? "success" : "neutral") : row.tone, t(catalogueView === "products" ? row.productStatus : row.status))}</td><td class="numeric">${catalogueView === "products" ? row.quantity : row.quantity / row.pallets} ${t("cartons")}${catalogueView === "products" ? `<span class="table-description">${row.pallets} ${t("productBreakdown")}</span>` : ""}</td></tr>`,
    )
    .join("");
  document.querySelector("#catalogue-empty").innerHTML = rows.length
    ? ""
    : `<div class="empty-example catalogue-no-results"><strong>${t("noResults")}</strong><p>${t("noResultsHint")}</p><button class="btn outline" type="button" id="clear-search">${t("clearFilters")}</button></div>`;
  document.querySelector("#product-count").textContent =
    `${rows.length} ${t("recordScope")}`;
}
function renderReviewFloor() {
  const zones = [
    {
      code: "FG1-L01",
      x: 24,
      y: 30,
      w: 96,
      h: 54,
      size: "4.8 × 2.7 m",
      pallets: 0,
    },
    {
      code: "FG1-L02",
      x: 24,
      y: 140,
      w: 96,
      h: 54,
      size: "4.8 × 2.7 m",
      pallets: 0,
    },
    {
      code: "FG1-R01",
      x: 190,
      y: 30,
      w: 80,
      h: 164,
      size: "4.0 × 8.2 m",
      pallets: 2,
    },
  ];
  const selected = zones.find((zone) => zone.code === floorSelection);
  return `<div class="workflow-title"><div><h3>${t("floorTitle")}</h3><p>${t("floorSummary")}</p></div></div>${reviewMode === "viewOnly" ? notice(t("viewOnlyState"), t("viewOnlyCopy")) : ""}
  <div class="floor-layout"><div><div class="floor-map"><svg viewBox="0 0 300 240" role="group" aria-label="${t("floorTab")}"><rect x="0" y="0" width="300" height="240" fill="none" stroke="var(--scene-boundary)"/><rect class="walkway" x="136" y="18" width="30" height="204"/><text class="walkway-text" x="151" y="126" text-anchor="middle" transform="rotate(-90 151 126)">${t("walkway")}</text>${zones.map((zone) => `<g role="button" tabindex="0" data-zone="${zone.code}" aria-label="${t("selectLocation")} ${zone.code}" aria-pressed="${zone.code === floorSelection}"><rect class="${zone.code === floorSelection ? "zone-selected" : "zone"}" x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" rx="2"/><text x="${zone.x + zone.w / 2}" y="${zone.y + 25}" text-anchor="middle">${zone.code}</text>${zone.pallets ? '<rect class="pallet" x="202" y="76" width="26" height="36" rx="1"/><rect class="pallet" x="234" y="76" width="26" height="36" rx="1"/>' : ""}</g>`).join("")}</svg></div><div class="floor-legend"><span><i class="legend-line"></i>${t("location")}</span><span><i class="legend-line selected"></i>${t("selected")}</span></div></div>
  <aside class="floor-inspector" aria-label="${t("floorLocation")}">${selected ? `<h4>${selected.code}</h4><dl><div><dt>${t("floorDimensions")}</dt><dd class="mono">${selected.size}</dd></div><div><dt>${t("floorContents")}</dt><dd>${reviewMode === "unknown" ? t("unavailable") : `${selected.pallets} ${t("productBreakdown")}`}</dd></div></dl><button class="btn outline" type="button" data-demo="floorNotice">${t("inspect")}</button>` : `<p>${t("selectLocation")}</p>`}</aside></div>${feedback()}`;
}
function hrRequests() {
  return `<section class="correction-example"><div><h4>${t("requests")}</h4>${demoLink("viewAll")}</div><p class="small muted">${t("noRequests")}</p></section>`;
}
function renderReviewHr() {
  if (reviewMode === "unlinked")
    return notice(t("unlinkedTitle"), t("unlinkedHint")) + feedback();
  const pending = reviewMode === "pending";
  const uncertain = reviewMode === "uncertain";
  const unresolved = reviewMode === "unresolved";
  let writeNotice = "";
  if (uncertain) writeNotice = notice(t("uncertainTitle"), t("uncertainCopy"));
  if (pending) writeNotice = notice(t("pendingCopy"));
  if (reviewMode === "refused")
    writeNotice = notice(t("refusedTitle"), t("refusedCopy"));
  if (reviewMode === "denied")
    writeNotice = notice(t("deniedTitle"), t("deniedCopy"));
  if (unresolved)
    writeNotice = notice(t("unresolvedTitle"), t("unresolvedCopy"));
  return `<div class="workflow-title"><div><h3>${t("hrTitle")}</h3><p>${t("hrSummary")}</p></div>${quietBadge(clockedOut ? "success" : "accent", t(clockedOut ? "clockedOut" : "clockedIn"))}</div>
  <div class="time-grid"><div class="time-cell"><p>${t("clockIn")}</p><strong class="recorded">08:29</strong></div><div class="time-cell"><p>${t("clockOut")}</p><strong class="${clockedOut ? "recorded" : "unrecorded"}">${clockedOut ? "17:31" : "--:--"}</strong>${!clockedOut ? `<span class="small muted">${t("unrecorded")}</span>` : ""}</div></div>${demoLink("viewDay")}
  <div class="shift-strip"><span>${t("plannedShift")} <strong>08:30–17:30 · ${t("break")}</strong></span><span>${t("site")} <strong>${t("sampleSite")}</strong></span></div>${writeNotice}
  <div class="hr-action-row">${uncertain ? `<button id="safe-clock-retry" class="btn primary" type="button">${svg("pending")}${t("safeRetry")}</button>` : unresolved ? `<button class="btn outline" type="button" data-demo="attendanceNotice">${t("correctDay")}</button>` : reviewMode === "denied" ? "" : clockedOut ? `<p>${t("receipt")} · ${demoLink("timeHistory")}</p>` : pending ? `<button id="sample-clock-out" class="btn primary" type="button" aria-disabled="true" aria-busy="true">${savingIcon}${t("saving")}</button>` : `<button id="sample-clock-out" class="btn primary" type="button">${svg("pending")}${t("clockOutAction")}</button>`}</div><p class="hr-policy">${t("hrPolicy")}</p>${hrRequests()}${feedback()}`;
}
const modesByScreen = {
  scan: [
    ["normal", "normalState"],
    ["reading", "readingState"],
    ["viewOnly", "viewOnlyState"],
  ],
  catalogue: [
    ["normal", "normalState"],
    ["loading", "loadingState"],
    ["unavailable", "unavailableState"],
    ["viewOnly", "viewOnlyState"],
  ],
  floor: [
    ["normal", "normalState"],
    ["unknown", "unknownState"],
    ["viewOnly", "viewOnlyState"],
  ],
  hr: [
    ["normal", "normalState"],
    ["pending", "pendingState"],
    ["uncertain", "uncertainState"],
    ["refused", "refusedState"],
    ["denied", "deniedState"],
    ["unlinked", "unlinkedState"],
    ["unresolved", "unresolvedState"],
  ],
};
const modeRow = document.createElement("div");
modeRow.className = "review-mode";
document.querySelector(".specimen-tabs").after(modeRow);
renderWorkflow = function () {
  window.sheetControls?.unmount(modeRow);
  window.sheetControls?.unmount(document.querySelector("#workflow-panel"));
  modeRow.innerHTML = `<label for="review-state">${t("reviewState")}</label>${selectControl(`<select id="review-state">${modesByScreen[screen].map(([value, key]) => `<option value="${value}" ${reviewMode === value ? "selected" : ""}>${t(key)}</option>`).join("")}</select>`)}`;
  const panel = document.querySelector("#workflow-panel");
  panel.setAttribute("aria-labelledby", `tab-${screen}`);
  panel.innerHTML = {
    scan: renderReviewScan,
    catalogue: renderReviewCatalogue,
    floor: renderReviewFloor,
    hr: renderReviewHr,
  }[screen]();
  document.querySelector("#workflow-caption").textContent = t(
    `${screen}Caption`,
  );
  if (screen === "scan") updateScanValidation();
  if (screen === "catalogue") updateReviewProducts();
  panel
    .querySelectorAll("#ticket-deliveryDate, #ticket-manufacturingDate")
    .forEach((input) => {
      input.dataset.sheetDate = "";
      // Optional ticket dates: clearing is an explicit action in the popup.
      input.dataset.sheetClearable = "";
    });
  window.sheetControls?.mount(modeRow);
  window.sheetControls?.mount(panel);
  mountControlsFallbacks(modeRow);
  mountControlsFallbacks(panel);
};
const originalSelectScreen = selectScreen;
selectScreen = function (next, focus = false) {
  reviewMode = "normal";
  originalSelectScreen(next, focus);
};
modeRow.addEventListener("change", (event) => {
  reviewMode = event.target.value;
  if (screen === "hr") clockedOut = false;
  scanSaved = false;
  renderWorkflow();
  (
    document.querySelector("#review-state-control") ??
    document.querySelector("#review-state")
  ).focus();
});
const reviewPanel = document.querySelector("#workflow-panel");
reviewPanel.addEventListener(
  "input",
  (event) => {
    if (event.target.dataset.draft) {
      event.stopImmediatePropagation();
      const key = event.target.dataset.draft;
      draft[key] = event.target.value;
      aiFields.delete(key);
      event.target.closest(".field").querySelector(".origin")?.remove();
      updateScanValidation();
      window.sheetControls?.refresh();
    }
    if (event.target.id === "product-search") {
      event.stopImmediatePropagation();
      productQuery = event.target.value;
      updateReviewProducts();
    }
  },
  true,
);
reviewPanel.addEventListener("change", (event) => {
  if (event.target.dataset.draft) {
    draft[event.target.dataset.draft] = event.target.value;
    updateScanValidation();
    window.sheetControls?.refresh();
  }
});
reviewPanel.addEventListener("focusout", (event) => {
  if (
    ["factoryOrder", "productBarcodeText"].includes(event.target.dataset.draft)
  ) {
    scanTouched.add(event.target.dataset.draft);
    updateScanValidation();
    window.sheetControls?.refresh();
  }
});
reviewPanel.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (scanBlocker() || !scanHasTicket) return;
    scanSaved = true;
    renderWorkflow();
    document.querySelector("#scan-more").focus();
  },
  true,
);
reviewPanel.addEventListener(
  "click",
  (event) => {
    const target = event.target.closest("button, [data-zone]");
    if (!target || target.disabled) return;
    // Busy/aria-disabled actions stay focusable but never repeat the action.
    if (target.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const handle = () => event.stopImmediatePropagation();
    if (target.dataset.capture) {
      handle();
      scanMethod = target.dataset.capture;
      if (scanMethod === "manual" && !scanHasTicket) {
        resetScanDraft();
        scanHasTicket = true;
      }
      renderWorkflow();
      document.querySelector("#workflow-feedback").textContent = t(
        scanMethod === "photo"
          ? "photoNotice"
          : scanMethod === "barcode"
            ? "barcodeNotice"
            : "manualNotice",
      );
      if (scanMethod === "manual")
        document.querySelector("#ticket-factoryOrder").focus();
    }
    if (target.id === "remove-ticket") {
      handle();
      scanHasTicket = false;
      renderWorkflow();
      document.querySelector("#add-ticket").focus();
    }
    if (["add-ticket", "scan-more"].includes(target.id)) {
      handle();
      scanHasTicket = true;
      scanSaved = false;
      resetScanDraft();
      renderWorkflow();
      document.querySelector("#ticket-factoryOrder").focus();
    }
    if (target.dataset.catalogueView) {
      handle();
      catalogueView = target.dataset.catalogueView;
      catalogueFiltered = false;
      productQuery = "";
      renderWorkflow();
      document
        .querySelector(`[data-catalogue-view="${catalogueView}"]`)
        .focus();
    }
    if (
      ["review-filter", "clear-catalogue-filter", "clear-search"].includes(
        target.id,
      )
    ) {
      handle();
      catalogueFiltered =
        target.id === "review-filter" ? !catalogueFiltered : false;
      if (target.id === "clear-search") productQuery = "";
      renderWorkflow();
      document
        .querySelector(
          target.id === "clear-search" ? "#product-search" : "#review-filter",
        )
        .focus();
    }
    if (target.dataset.zone) {
      handle();
      floorSelection =
        floorSelection === target.dataset.zone ? "" : target.dataset.zone;
      renderWorkflow();
      document.querySelector(`[data-zone="${target.dataset.zone}"]`).focus();
    }
    if (["sample-clock-out", "safe-clock-retry"].includes(target.id)) {
      handle();
      clockedOut = true;
      reviewMode = "normal";
      renderWorkflow();
      document.querySelector("#workflow-feedback").textContent =
        t("hrSampleClock");
      document.querySelector(".hr-action-row button").focus();
    }
  },
  true,
);

// Separate domain outcomes: a finished-goods error is not an HR uncertain write.
const stateGrid = document.querySelector(".state-specimens");
stateGrid.insertAdjacentHTML(
  "beforeend",
  `<div class="state-example"><h3 data-i18n="hrDomain"></h3><div class="error-example"><strong data-i18n="refusedTitle"></strong><p data-i18n="refusedCopy"></p></div></div><div class="state-example"><h3 data-i18n="uncertainState"></h3><div class="error-example"><strong data-i18n="uncertainTitle"></strong><p data-i18n="uncertainCopy"></p><button class="btn outline" type="button" id="review-uncertain" data-i18n="safeRetry"></button><p class="small muted" data-i18n="hrDomain"></p></div></div><div class="state-example"><h3 data-i18n="viewOnlyState"></h3><div class="empty-example"><p data-i18n="viewOnlyCopy"></p></div></div>`,
);
document.querySelector("#review-uncertain").addEventListener("click", () => {
  selectScreen("hr");
  reviewMode = "uncertain";
  renderWorkflow();
  document.querySelector("#safe-clock-retry").focus();
});
const adoption = document.createElement("section");
adoption.className = "adoption-section";
adoption.innerHTML = `<div class="section-heading"><h2 data-i18n="adoptionTitle"></h2><p class="small muted" data-i18n="adoptionStatus"></p></div><p data-i18n="adoptionCopy"></p><p class="small muted" data-i18n="adoptionScope"></p><div class="adoption-links"><a href="system-implementation-plan.md" data-i18n="reviewedPlan"></a><a href="kiro-audit.md" data-i18n="auditLink"></a></div>`;
document.querySelector(".sheet-footer").before(adoption);
// The React islands mount after this script. Until then their sources keep
// their space without showing; if the bundle never mounts, show labelled
// read-only values with an explicit error. Never expose native picker popups.
document.documentElement.classList.add("sheet-controls-pending");
const controlsFallback = document.createElement("p");
controlsFallback.id = "controls-fallback";
controlsFallback.className = "controls-fallback";
controlsFallback.setAttribute("role", "status");
controlsFallback.dataset.i18n = "controlsFallback";
controlsFallback.hidden = true;
document.querySelector("main").prepend(controlsFallback);
function mountControlsFallbacks(scope = document) {
  if (!document.documentElement.classList.contains("sheet-controls-failed"))
    return;
  for (const source of scope.querySelectorAll(
    ".select-input > select, input[data-sheet-date], input[data-sheet-time]",
  )) {
    const id = `${source.id}-fallback`;
    let valueField = document.getElementById(id);
    if (!valueField) {
      valueField = document.createElement("input");
      valueField.type = "text";
      valueField.id = id;
      valueField.className = "sheet-fallback-field";
      valueField.readOnly = true;
      valueField.setAttribute(
        "aria-describedby",
        [source.getAttribute("aria-describedby"), "controls-fallback"]
          .filter(Boolean)
          .join(" "),
      );
      for (const label of Array.from(source.labels ?? [])) label.htmlFor = id;
      source.hidden = true;
      source.tabIndex = -1;
      source.setAttribute("aria-hidden", "true");
      source.after(valueField);
    }
    valueField.value =
      source instanceof HTMLSelectElement
        ? (source.selectedOptions[0]?.text ?? "")
        : source.value;
  }
}
function checkControlsMounted() {
  const root = document.documentElement;
  root.classList.remove("sheet-controls-pending");
  if (root.classList.contains("sheet-controls-ready")) return;
  root.classList.add("sheet-controls-failed");
  controlsFallback.hidden = false;
  mountControlsFallbacks();
}
if (document.readyState === "complete") checkControlsMounted();
else window.addEventListener("load", checkControlsMounted, { once: true });

// Errors follow the current value in every locale, including after a switch.
function syncFieldErrors() {
  const required = document.querySelector("#demo-required");
  const missing = !required.value.trim();
  required.setAttribute("aria-invalid", String(missing));
  document.querySelector("#required-error").textContent = missing
    ? t("requiredError")
    : "";
  for (const error of document.querySelectorAll("[data-error-for]")) {
    const source = document.getElementById(error.dataset.errorFor);
    const empty = !source.value.trim();
    source.setAttribute("aria-invalid", String(empty));
    error.textContent = empty ? t(error.dataset.errorKey) : "";
  }
}
document
  .querySelector("#demo-required")
  .addEventListener("input", syncFieldErrors);
document
  .querySelector(".picker-states")
  .addEventListener("input", syncFieldErrors);

// A stable theme name; aria-pressed alone reports whether dark mode is on.
const originalUpdateAppearance = updateAppearance;
updateAppearance = function () {
  originalUpdateAppearance();
  document
    .querySelector("#theme-toggle")
    .setAttribute("aria-label", t("themeName"));
};
// Print is light. Drop .dark while printing so inks and readouts match.
let restoreDarkAfterPrint = false;
window.addEventListener("beforeprint", () => {
  if (!dark) return;
  restoreDarkAfterPrint = true;
  dark = false;
  updateAppearance();
});
window.addEventListener("afterprint", () => {
  if (!restoreDarkAfterPrint) return;
  restoreDarkAfterPrint = false;
  dark = true;
  updateAppearance();
});

const originalRenderLanguage = renderLanguage;
renderLanguage = function () {
  originalRenderLanguage();
  document
    .querySelector(".wordmark")
    .setAttribute("aria-label", t("wordmarkName"));
  document
    .querySelector(".sheet-nav")
    .setAttribute("aria-label", t("sectionsName"));
  document
    .querySelector(".specimen-tabs")
    .setAttribute("aria-label", t("workflowTabsName"));
  document.querySelector("#proposal-date").textContent = t("proposalDate");
  // The accessible name starts with the visible label (ไทย / EN).
  document
    .querySelector("#language-toggle")
    .setAttribute("aria-label", t("languageName"));
  document.querySelector("#language-label").lang =
    language === "en" ? "th" : "en";
  syncFieldErrors();
  document
    .querySelector("#semantic-statuses")
    .insertAdjacentHTML("beforeend", quietBadge("accent", t("clockedIn")));
  document.querySelector("#status-proposal").textContent = t("statusProposal");
  document.querySelector("#app-ink-example").innerHTML =
    `${t("appInk")} · <span class="badge app-success">${svg("check")}${t("success")}</span>`;
  window.sheetControls?.refresh();
  mountControlsFallbacks();
};
document
  .querySelector("#semantic-statuses")
  .insertAdjacentHTML(
    "beforebegin",
    '<p id="status-proposal" class="small muted"></p>',
  );
document
  .querySelector("#semantic-statuses")
  .insertAdjacentHTML(
    "afterend",
    '<p id="app-ink-example" class="small muted"></p>',
  );
renderLanguage();
