import { decodeCamera } from "./decoder.js";
const $ = (s) => document.querySelector(s);
const icon = (name) => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const words = {
  th: {
    preview: "HTML preview · ข้อมูลตัวอย่าง",
    locationTab: "ตำแหน่ง",
    productTab: "สินค้า / JOB",
    reset: "เริ่มใหม่",
    goods: "สินค้าสำเร็จรูป",
    stock: "สต็อกสินค้า",
    heading: "สแกนใบ Job",
    localNote: "ตัวอย่างนี้ไม่บันทึกเข้าระบบจริง",
    intro: "ระบุตำแหน่ง แล้วสแกน JOB และบาร์โค้ดสินค้าเพื่อบันทึกใบงาน",
    locationHeading: "ระบุตำแหน่ง",
    locationIntro: "สแกนบาร์โค้ดหรือ QR ของตำแหน่ง หรือค้นหาจากรหัส",
    locationScan: "สแกนตำแหน่ง",
    productScan: "อ่านบาร์โค้ดจากภาพ",
    productField: "สแกนบาร์โค้ดสินค้า",
    jobField: "สแกน JOB No.",
    choose: "เลือกภาพ",
    camera: "ใช้กล้อง",
    drop: "เลือกภาพจากเครื่องเพื่ออ่านบาร์โค้ด",
    formats: "JPEG, PNG หรือ WebP · ไม่เกิน 25 MB",
    privacy: "อ่านบาร์โค้ดบนเครื่อง ไม่ใช้ AI และไม่อัปโหลดภาพ",
    samples: "ลองภาพที่แนบมา",
    normal: "ภาพ 3 · ฉลากปกติ",
    curved: "ภาพ 2 · ฉลากโค้ง",
    reading: "กำลังอ่านบาร์โค้ด…",
    readingHelp: "กำลังหาบาร์โค้ดและปรับมุมภาพ",
    cancel: "ยกเลิก",
    found: "อ่านบาร์โค้ดแล้ว",
    review: "ตรวจสอบก่อนใช้",
    reviewTitle: "ฉลากโค้งหรือเส้นไม่ชัด",
    reviewHelp: "เทียบรหัสสินค้าด้านล่างกับฉลากก่อนยืนยัน",
    apply: "ใช้รหัสที่อ่านได้",
    confirm: "ตรวจแล้ว ใช้รหัสนี้",
    again: "เลือกภาพใหม่",
    noCode: "ยังอ่านบาร์โค้ดไม่ได้",
    noCodeHelp:
      "ถ่ายใกล้ขึ้น ให้เห็นปลายบาร์โค้ดทั้งสองด้าน และหลีกเลี่ยงแสงสะท้อน",
    denied: "เปิดกล้องไม่ได้",
    deniedHelp: "อนุญาตการใช้กล้องในเบราว์เซอร์ หรือเลือกภาพจากเครื่องแทน",
    scanHint: "ให้เห็นบาร์โค้ดทั้งเส้น และถือกล้องให้นิ่ง",
    change: "เปลี่ยน",
    located: "ระบุตำแหน่งแล้ว",
    locationDescription: "อาคาร F2 · ชั้น 2 · ช่อง L28 / 18",
    ticket: "ใบงาน 1",
    barcode: "บาร์โค้ดสินค้า",
    optional: "รายละเอียดเพิ่มเติม (ไม่บังคับ)",
    manual: "กรอกเอง",
    barcodeAction: "สแกนบาร์โค้ด",
    photoAI: "รูปถ่าย (AI)",
    save: "บันทึก 1 ใบงาน",
    requiredHelp: "ต้องมี JOB No. และบาร์โค้ดสินค้า",
    readyHelp: "บันทึกที่ตำแหน่ง",
    manualNote:
      "บาร์โค้ดให้เฉพาะรหัส · จำนวน วันที่ และรายละเอียดอื่นกรอกเพิ่มได้",
    search: "ค้นหา",
    searchPlaceholder: "พิมพ์รหัสตำแหน่ง เช่น F2-L28-18",
    continue: "ใช้ตำแหน่งนี้",
    locationFound: "พบตำแหน่ง",
    unknown: "อ่านรหัสแล้ว แต่ไม่พบตำแหน่ง",
    unknownHelp: "ตรวจสอบรหัสและคลังที่เลือก หรือค้นหาตำแหน่งอื่น",
    editCode: "แก้ไขรหัส",
    previewStates: "สถานะตัวอย่าง",
    stateIdle: "พร้อมเลือกภาพ",
    stateReview: "ฉลากโค้ง · รอยืนยัน",
    stateNoCode: "อ่านภาพไม่สำเร็จ",
    stateDenied: "ไม่ได้อนุญาตกล้อง",
    stateWrong: "สแกน JOB ในช่องสินค้า",
    stateUnknown: "ตำแหน่งไม่พบในคลัง",
    stateMapped: "ตำแหน่งที่พบในคลัง",
    wrong: "นี่คือ JOB No. ไม่ใช่บาร์โค้ดสินค้า",
    wrongHelp: "สแกนบาร์โค้ดสินค้าที่อยู่ด้านล่างของฉลาก",
    wrongJob: "นี่ไม่ใช่ JOB No.",
    wrongJobHelp: "สแกนรหัสที่อยู่ใต้หัวข้อ JOB NO. ของฉลาก",
    replace: "แทนที่ค่าปัจจุบัน?",
    current: "ค่าปัจจุบัน",
    scanned: "ค่าที่อ่านใหม่",
    replaceAction: "แทนที่ค่า",
    keep: "ใช้ค่าเดิม",
    pickCode: "พบหลายรหัส เลือกรหัสที่ต้องการ",
    saved: "บันทึกใบงานแล้ว",
    savedHelp: "ข้อมูลตัวอย่างถูกเก็บไว้เฉพาะในหน้านี้",
    next: "สแกนใบงานถัดไป",
    unsupported: "ชนิดไฟล์ไม่รองรับ เลือก JPEG, PNG หรือ WebP",
    oversized: "ภาพใหญ่เกินไป เลือกไฟล์ไม่เกิน 25 MB",
    corrupt: "เปิดภาพไม่ได้ ลองเลือกภาพอื่น",
    part: "ชื่อสินค้า",
    customer: "ชื่อลูกค้า",
    delivery: "วันที่ส่งสินค้า",
    mfg: "วันที่ผลิต",
    quantity: "จำนวน",
    producer: "ผู้ผลิต",
    checker: "ผู้ตรวจสอบ",
    cropNote:
      "หากยังอ่านไม่ได้ ให้ครอปภาพเหลือบาร์โค้ดพร้อมขอบขาว แล้วเลือกใหม่",
    codeLabel: "รหัสตำแหน่ง",
    dismiss: "ปิด",
    sampleMapping: "ผลค้นหาตำแหน่งในตัวอย่างนี้เป็นข้อมูลจำลอง",
    cleared: "ล้างข้อมูลใบงานแล้ว",
    remove: "ล้างใบงาน",
    samplePhoto: "ภาพฉลากที่แนบมา",
    aiDisabled: "ไม่ได้เปิดใช้ในตัวอย่างบาร์โค้ดนี้",
    initialCode: "ลองค้นหา F2-L28-18",
    fieldHelp: "เลือกภาพหรือใช้กล้อง รหัสที่อ่านได้ต้องตรงกับช่องนี้",
    loadingFile: "กำลังเตรียมภาพ…",
    jobMissing: "ยังไม่พบ JOB No. ให้สแกนหรือกรอกเพิ่ม",
    tooLargePixels: "ภาพมีความละเอียดสูงเกินไป เลือกภาพไม่เกิน 12 ล้านพิกเซล",
  },
  en: {
    preview: "HTML preview · Sample data",
    locationTab: "Location",
    productTab: "Product / JOB",
    reset: "Reset",
    goods: "Finished goods",
    stock: "Product stock",
    heading: "Scan Job ticket",
    localNote: "This preview does not save to the live system",
    intro:
      "Choose a location, then scan the JOB and product barcode to record a ticket.",
    locationHeading: "Choose location",
    locationIntro: "Scan a location barcode or QR, or search by code.",
    locationScan: "Scan location",
    productScan: "Read barcodes from image",
    productField: "Scan product barcode",
    jobField: "Scan JOB No.",
    choose: "Choose image",
    camera: "Use camera",
    drop: "Choose a photo to read its barcodes",
    formats: "JPEG, PNG or WebP · Up to 25 MB",
    privacy: "Read on your device. No AI or image upload.",
    samples: "Try the attached photos",
    normal: "Photo 3 · Normal label",
    curved: "Photo 2 · Curved label",
    reading: "Reading barcodes…",
    readingHelp: "Finding barcodes and adjusting the image angle",
    cancel: "Cancel",
    found: "Barcodes read",
    review: "Check before using",
    reviewTitle: "Curved label or faint bars",
    reviewHelp:
      "Compare the product code below with the label before confirming.",
    apply: "Use scanned codes",
    confirm: "Checked — use this code",
    again: "Choose another image",
    noCode: "Could not read a barcode",
    noCodeHelp:
      "Move closer, include both ends of the barcode, and avoid reflections.",
    denied: "Camera could not open",
    deniedHelp:
      "Allow camera access in your browser, or choose an image instead.",
    scanHint: "Keep the entire barcode in view and hold the camera steady.",
    change: "Change",
    located: "Location selected",
    locationDescription: "Building F2 · Floor 2 · Slot L28 / 18",
    ticket: "Ticket 1",
    barcode: "Product barcode",
    optional: "Additional details (optional)",
    manual: "Enter manually",
    barcodeAction: "Scan barcode",
    photoAI: "Photo (AI)",
    save: "Save 1 ticket",
    requiredHelp: "JOB No. and product barcode are required",
    readyHelp: "Save at",
    manualNote:
      "Barcodes provide identities. Enter quantities, dates, and other details separately.",
    search: "Search",
    searchPlaceholder: "Enter a location code, e.g. F2-L28-18",
    continue: "Use this location",
    locationFound: "Location found",
    unknown: "Code read, but location not found",
    unknownHelp:
      "Check the code and selected warehouse, or search for another location.",
    editCode: "Edit code",
    previewStates: "Sample states",
    stateIdle: "Ready to choose image",
    stateReview: "Curved label · Awaiting confirmation",
    stateNoCode: "Unreadable image",
    stateDenied: "Camera permission denied",
    stateWrong: "JOB scanned in product field",
    stateUnknown: "Location absent from warehouse",
    stateMapped: "Location found in warehouse",
    wrong: "This is a JOB No., not a product barcode",
    wrongHelp: "Scan the product barcode near the bottom of the label.",
    wrongJob: "This is not a JOB No.",
    wrongJobHelp: "Scan the code under JOB NO. on the label.",
    replace: "Replace the current value?",
    current: "Current value",
    scanned: "New scanned value",
    replaceAction: "Replace value",
    keep: "Keep current value",
    pickCode: "Several codes found. Choose one.",
    saved: "Ticket saved",
    savedHelp: "Sample data is kept only on this page.",
    next: "Scan the next ticket",
    unsupported: "Unsupported file. Choose JPEG, PNG or WebP.",
    oversized: "Image too large. Choose a file up to 25 MB.",
    corrupt: "Could not open the image. Choose another photo.",
    part: "Part name",
    customer: "Customer",
    delivery: "Delivery date",
    mfg: "Manufacturing date",
    quantity: "Quantity",
    producer: "Producer",
    checker: "Checker",
    cropNote:
      "If reading still fails, crop to the barcode with white margins and choose the image again.",
    codeLabel: "Location code",
    dismiss: "Close",
    sampleMapping: "Location lookup in this preview uses sample data.",
    cleared: "Ticket fields cleared",
    remove: "Clear ticket",
    samplePhoto: "Attached label photo",
    aiDisabled: "Unavailable in this barcode preview",
    initialCode: "Try searching F2-L28-18",
    fieldHelp:
      "Choose an image or use the camera. The code must match this field.",
    loadingFile: "Preparing image…",
    jobMissing: "No JOB No. found yet. Scan or enter it separately.",
    tooLargePixels:
      "Image resolution too high. Choose an image up to 12 megapixels.",
  },
};
const query = new URLSearchParams(location.search);
let lang = query.get("lang") === "en" ? "en" : "th";
let theme = query.get("theme") === "light" ? "light" : "dark";
const state = {
  page: query.get("page") === "location" ? "location" : "product",
  job: "",
  product: "",
  optional: {},
  scan: { phase: "idle" },
  panel: true,
  locationResult: null,
  locationCode: "",
  dialog: null,
  saved: false,
  source: "manual",
};
let photoWorker = null;
let generation = 0,
  stream = null,
  objectUrl = null,
  cameraTimer = null,
  toastTimer;
const t = (key) => words[lang][key] || key;
const button = (key, action, kind = "", symbol = "") =>
  `<button class="button ${kind}" data-action="${action}">${symbol ? icon(symbol) : ""}${t(key)}</button>`;
const label = (key, id, value = "", type = "text") =>
  `<div class="field"><label for="${id}">${t(key)}</label><div class="field-input"><input id="${id}" data-optional="${key}" type="${type}" value="${esc(value)}" /></div></div>`;
function stopAcquisition() {
  generation++;
  photoWorker?.terminate();
  photoWorker = null;
  clearTimeout(cameraTimer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}
function releaseImage() {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
}
function title(text) {
  return `<div class="page-title">${state.page === "product" ? `<a class="icon-button" href="?page=location&lang=${lang}&theme=${theme}" aria-label="${t("change")}">${icon("back")}</a>` : icon("pin")}<h1>${text}</h1></div>`;
}
function fileInput() {
  return '<input class="photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden />';
}
function scanner(target = "product", dialog = false) {
  const s = state.scan;
  const head = dialog
    ? ""
    : `<div class="panel-head"><h3>${t(target === "location" ? "locationScan" : "productScan")}</h3><button class="icon-button" data-action="hide-panel" aria-label="${t("dismiss")}">${icon("close")}</button></div>`;
  let body = "";
  if (
    s.phase === "idle" ||
    s.phase === "error" ||
    s.phase === "denied" ||
    s.phase === "wrong"
  ) {
    if (s.phase !== "idle")
      body += `<div class="notice ${s.phase === "denied" ? "neutral" : "error"}" role="alert"><strong>${t(s.phase === "denied" ? "denied" : s.phase === "wrong" ? (target === "job" ? "wrongJob" : "wrong") : "noCode")}</strong>${esc(s.error || t(s.phase === "denied" ? "deniedHelp" : s.phase === "wrong" ? (target === "job" ? "wrongJobHelp" : "wrongHelp") : "noCodeHelp"))}${s.phase === "wrong" && s.codes ? `<p class="mono meta">${esc(s.codes[0])}</p>` : ""}</div>`;
    body += `<div class="drop-target">${icon("image")}<strong>${t("drop")}</strong><small>${t("formats")}</small></div><div class="scan-choice">${button("choose", "choose", "primary", "image")}${button("camera", "camera", "", "camera")}</div><p class="footnote">${t("privacy")}</p>`;
    if (s.phase === "error") body += `<p class="footnote">${t("cropNote")}</p>`;
  } else if (s.phase === "camera") {
    body += `<div class="camera-view"><video id="camera-video" muted playsinline autoplay></video><div class="scan-frame"></div></div><p class="footnote">${t("scanHint")}</p><div class="scan-choice">${button("choose", "choose", "", "image")}${button("cancel", "cancel")}</div>`;
  } else {
    body += `<div class="result-layout">${s.image ? `<a href="${esc(s.image)}" target="_blank" rel="noopener" aria-label="${t("samplePhoto")}"><img class="photo" src="${esc(s.image)}" alt="${t("samplePhoto")}"/></a>` : icon("scan")}<div class="result-details"><div class="status ${s.phase === "reading" ? "loading" : s.review ? "warning" : ""}">${s.phase === "reading" ? '<span class="spinner" aria-hidden="true"></span>' : icon(s.review ? "alert" : "check")}<span role="status">${t(s.phase === "reading" ? "reading" : s.review ? "review" : "found")}</span></div>${s.phase === "reading" ? `<p class="meta">${t("readingHelp")}</p>` : `<dl class="identity">${s.jobs?.length && target === "product" && !dialog ? `<dt>JOB No.</dt><dd>${esc(s.jobs.join(" / "))}</dd>` : ""}<dt>${target === "location" ? t("codeLabel") : target === "job" ? "JOB No." : t("barcode")}</dt><dd>${esc(s.codes.join(" / "))}</dd></dl>`}</div></div>`;
    if (s.phase === "reading")
      body += `<div class="result-actions">${button("cancel", "cancel")}</div>`;
    else {
      if (s.review)
        body += `<div class="notice"><strong>${t("reviewTitle")}</strong>${t("reviewHelp")}</div>`;
      if (s.codes.length > 1)
        body += `<p class="footnote">${t("pickCode")}</p><div class="result-actions">${s.codes.map((code, i) => `<button class="button primary mono" data-action="pick-code" data-index="${i}">${esc(code)}</button>`).join("")}</div>`;
      else
        body += `<div class="result-actions">${button(s.review ? "confirm" : "apply", "apply", "primary", "check")}${button("again", "scan-again")}</div>`;
    }
  }
  if (target !== "location")
    body += `<div class="samples"><span>${t("samples")}</span><button data-action="sample" data-image="3.jpg">${t("normal")}</button><button data-action="sample" data-image="2.jpg">${t("curved")}</button></div>`;
  return `<section class="scan-panel" aria-label="${t(target === "location" ? "locationScan" : target === "job" ? "jobField" : "productField")}">${head}${body}${fileInput()}</section>`;
}
function scenarios() {
  return `<div class="preview-scenarios"><label for="scenario">${t("previewStates")}</label><select id="scenario"><option value="idle">${t("stateIdle")}</option>${(state.page === "location" ? ["mapped", "unknown", "denied", "noCode"] : ["review", "noCode", "denied", "wrong"]).map((key) => `<option value="${key}">${t({ mapped: "stateMapped", unknown: "stateUnknown", review: "stateReview", noCode: "stateNoCode", denied: "stateDenied", wrong: "stateWrong" }[key])}</option>`).join("")}</select></div>`;
}
function locationPage() {
  return `${title(t("locationHeading"))}<p class="intro">${t("locationIntro")}</p>${state.panel ? scanner("location") : button("locationScan", "show-panel", "", "scan")}<section class="section"><h2>${t("search")}</h2><form id="location-search" class="search-row"><div class="field-input"><input aria-label="${t("codeLabel")}" id="location-code" class="mono" placeholder="${t("searchPlaceholder")}" value="${esc(state.locationCode)}"/></div><button class="button" type="submit">${icon("search")}${t("search")}</button></form><p class="footnote">${t("initialCode")}</p>${state.locationResult === "mapped" ? `<div class="location-result">${icon("pin")}<div><strong class="mono">F2-L28-18</strong><p class="meta">${t("locationDescription")}</p><span class="badge good">${icon("check")}${t("locationFound")}</span></div>${button("continue", "continue", "primary", "arrow")}</div>` : state.locationResult === "unknown" ? `<div class="notice error" role="alert"><strong>${t("unknown")}</strong><p class="mono">${esc(state.locationCode)}</p><p>${t("unknownHelp")}</p><button class="link-button" data-action="edit-location">${t("editCode")}</button></div>` : ""}<p class="footnote">${t("sampleMapping")}</p></section>${scenarios()}`;
}
function productPage() {
  if (state.saved)
    return `${title(t("heading"))}<section class="saved">${icon("check")}<h2>${t("saved")}</h2><p class="intro">${t("savedHelp")}</p><dl class="receipt"><div><dt>${t("locationTab")}</dt><dd class="mono">F2-L28-18</dd></div><div><dt>JOB No.</dt><dd class="mono">${esc(state.job)}</dd></div><div><dt>${t("barcode")}</dt><dd class="mono">${esc(state.product)}</dd></div>${Object.entries(
      state.optional,
    )
      .filter(([, v]) => v)
      .map(([k, v]) => `<div><dt>${t(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join(
        "",
      )}</dl>${button("next", "new-ticket", "primary", "scan")}</section>`;
  return `${title(t("heading"))}<p class="intro">${t("intro")}</p><div class="location-context">${icon("pin")}<div><strong class="mono">F2-L28-18</strong><p class="meta">${t("locationDescription")}</p><span class="badge good">${icon("check")}${t("located")}</span></div><a class="link-button" href="?page=location&lang=${lang}&theme=${theme}">${t("change")}</a></div><div class="toolbar"><button class="button" disabled title="${t("aiDisabled")}">${icon("camera")}${t("photoAI")}</button>${button("barcodeAction", "show-panel", state.panel ? "soft" : "", "scan")}${button("manual", "manual", "", "keyboard")}</div>${state.panel ? scanner() : ""}<section class="ticket"><div class="ticket-head"><h2>${t("ticket")}</h2><span class="badge">${state.source === "barcode" ? t("barcodeAction") : t("manual")}</span><button class="icon-button" data-action="clear" aria-label="${t("remove")}">${icon("trash")}</button></div><div class="fields">${identityField("job", "JOB No.")}${identityField("product", t("barcode"))}</div><details class="details"><summary>${t("optional")}${icon("chevron")}</summary><div class="optional-fields"><div class="fields">${label("part", "part", state.optional.part)}${label("customer", "customer", state.optional.customer)}</div><div class="fields">${label("delivery", "delivery", state.optional.delivery, "date")}${label("mfg", "mfg", state.optional.mfg, "date")}</div><div class="fields">${label("quantity", "quantity", state.optional.quantity, "number")}${label("producer", "producer", state.optional.producer)}</div><div class="fields">${label("checker", "checker", state.optional.checker)}</div></div></details><p class="footnote">${t("manualNote")}</p></section>${scenarios()}<footer class="sticky-footer"><div class="footer-inner"><small>${state.job && state.product ? `${t("readyHelp")} <span class="mono">F2-L28-18</span>` : t("requiredHelp")}</small><button class="button primary" id="save" data-action="save" ${valid() ? "" : "disabled"}>${icon("check")}${t("save")}</button></div></footer>`;
}
function identityField(key, text) {
  return `<div class="field"><label for="ticket-${key}">${text} <span class="required">*</span></label><div class="field-input"><input class="mono" id="ticket-${key}" data-identity="${key}" value="${esc(state[key])}" placeholder="${key === "job" ? "FO69070018" : "TDK-MPD-0131070-TRW-F"}" required/><button class="icon-button" data-action="field" data-field="${key}" aria-label="${t(key === "job" ? "jobField" : "productField")}">${icon("scan")}</button></div></div>`;
}
function valid() {
  return (
    /^FO\d{4,}$/i.test(state.job.trim()) &&
    !!state.product.trim() &&
    !/^FO\d+$/i.test(state.product.trim())
  );
}
function render() {
  document.documentElement.lang = lang;
  document.documentElement.dataset.theme = theme;
  $("#language").value = lang;
  document
    .querySelectorAll("[data-copy]")
    .forEach((el) => (el.textContent = t(el.dataset.copy)));
  document.querySelectorAll(".preview-bar a").forEach((el, i) => {
    el.href = `?page=${i ? "product" : "location"}&lang=${lang}&theme=${theme}`;
    el.setAttribute(
      "aria-current",
      state.page === (i ? "product" : "location") ? "page" : "false",
    );
  });
  $("#main").innerHTML =
    state.page === "location" ? locationPage() : productPage();
  renderDialog();
}
function renderDialog() {
  const d = state.dialog;
  if (!d) return;
  const titleKey = d.field === "job" ? "jobField" : "productField";
  $("#dialog-content").innerHTML =
    `<div class="dialog-head"><h2 id="dialog-title">${t(d.replace ? "replace" : titleKey)}</h2><button class="icon-button" data-action="close-dialog" aria-label="${t("dismiss")}">${icon("close")}</button></div>${d.replace ? `<div class="replacement"><div><span>${t("current")}</span><p class="mono">${esc(state[d.field])}</p></div><div><span>${t("scanned")}</span><p class="mono">${esc(d.replace)}</p></div></div><div class="result-actions">${button("keep", "close-dialog")}${button("replaceAction", "replace", "primary")}</div>` : `<p class="intro">${t("fieldHelp")}</p>${scanner(d.field, true)}`}`;
}
function target() {
  return (
    state.dialog?.field || (state.page === "location" ? "location" : "product")
  );
}
function notify(text) {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function setScan(scan) {
  state.scan = scan;
  state.panel = true;
  if (state.dialog) renderDialog();
  else render();
}
function acceptCodes(codes, extra = {}) {
  const kind = target();
  const good = codes.filter(
    (code) =>
      kind === "location" ||
      (kind === "job" ? /^FO\d{4,}$/i.test(code) : !/^FO\d+$/i.test(code)),
  );
  if (!good.length) {
    setScan({ phase: "wrong", codes, ...extra });
    return;
  }
  setScan({ phase: "result", codes: good, ...extra });
}
async function readImage(url) {
  stopAcquisition();
  const version = generation;
  const kind = target();
  setScan({ phase: "reading", image: url });
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (version !== generation) return;
    if (image.naturalWidth * image.naturalHeight > 12_000_000)
      throw new Error(t("tooLargePixels"));
    const bitmap = await createImageBitmap(image);
    if (version !== generation) {
      bitmap.close();
      return;
    }
    const worker = new Worker("/reader-worker.js");
    photoWorker = worker;
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        resolve(null);
      }, 20000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timeout);
        worker.terminate();
        data.error ? reject(new Error(data.error)) : resolve(data.result);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error("Decoder unavailable"));
      };
      worker.postMessage({ image: bitmap, target: kind }, [bitmap]);
    });
    if (version !== generation) return;
    if (!result) {
      setScan({ phase: "error", image: url });
      return;
    }
    acceptCodes(result.codes, {
      image: url,
      jobs: result.jobs,
      review: result.review,
    });
  } catch (error) {
    if (version !== generation || error.name === "AbortError") return;
    console.error(error);
    setScan({
      phase: "error",
      error:
        error.message === t("tooLargePixels") ? error.message : t("corrupt"),
    });
  }
}
async function startCamera() {
  stopAcquisition();
  const version = generation;
  setScan({ phase: "reading" });
  try {
    const next = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    if (version !== generation) {
      next.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = next;
    setScan({ phase: "camera" });
    const video = $("#camera-video");
    video.srcObject = stream;
    await video.play();
    const loop = async () => {
      if (version !== generation) return;
      try {
        const codes = await decodeCamera(video);
        if (version !== generation) return;
        if (codes.length) {
          stopAcquisition();
          acceptCodes([...new Set(codes)]);
          return;
        }
      } catch (error) {
        console.error(error);
      }
      cameraTimer = setTimeout(loop, 500);
    };
    cameraTimer = setTimeout(loop, 500);
  } catch {
    if (version === generation) {
      stopAcquisition();
      setScan({ phase: "denied" });
    }
  }
}
function apply(code) {
  stopAcquisition();
  const s = state.scan,
    kind = target();
  if (kind === "location") {
    state.locationCode = code;
    state.locationResult = code === "F2-L28-18" ? "mapped" : "unknown";
    state.panel = false;
    render();
    return;
  }
  if (state.dialog) {
    const field = state.dialog.field;
    if (state[field] && state[field] !== code) {
      state.dialog.replace = code;
      renderDialog();
      return;
    }
    state[field] = code;
    state.source = "barcode";
    closeDialog();
    return;
  }
  const job = s.jobs?.length === 1 ? s.jobs[0] : "";
  // Preserve existing values. A batch scan never silently replaces a typed identity.
  if (
    (state.product && state.product !== code) ||
    (job && state.job && state.job !== job)
  ) {
    state.dialog = {
      field: state.product && state.product !== code ? "product" : "job",
      replace: state.product && state.product !== code ? code : job,
      batch: { code, job },
    };
    renderDialog();
    $("#field-dialog").showModal();
    return;
  }
  state.product = code;
  if (job) state.job = job;
  state.source = "barcode";
  state.panel = false;
  render();
  if (!state.job) notify(t("jobMissing"));
}
function closeDialog() {
  const field = state.dialog?.field;
  stopAcquisition();
  state.dialog = null;
  $("#field-dialog").close();
  state.scan = { phase: "idle" };
  render();
  if (field) $(`[data-action="field"][data-field="${field}"]`)?.focus();
}
function sampleState(value) {
  stopAcquisition();
  state.panel = true;
  state.locationResult = null;
  if (value === "review")
    state.scan = {
      phase: "result",
      image: "/images/2.jpg",
      codes: ["SSD-OB3P422T-BOX-F"],
      jobs: ["FO69090109"],
      review: true,
    };
  else if (value === "wrong")
    state.scan = { phase: "wrong", codes: ["FO69070018"] };
  else if (value === "denied") state.scan = { phase: "denied" };
  else if (value === "noCode") state.scan = { phase: "error" };
  else if (value === "mapped" || value === "unknown") {
    state.scan = { phase: "idle" };
    state.panel = false;
    state.locationCode = value === "mapped" ? "F2-L28-18" : "F2-L28-99";
    state.locationResult = value;
  } else state.scan = { phase: "idle" };
  render();
  $("#scenario").value = value;
}
document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const action = el.dataset.action;
  if (action === "choose")
    $(
      state.dialog ? "#field-dialog .photo-input" : "#main .photo-input",
    ).click();
  else if (action === "sample") {
    releaseImage();
    void readImage(`/images/${el.dataset.image}`);
  } else if (action === "camera") void startCamera();
  else if (action === "apply") apply(state.scan.codes[0]);
  else if (action === "pick-code")
    apply(state.scan.codes[Number(el.dataset.index)]);
  else if (action === "cancel" || action === "scan-again") {
    stopAcquisition();
    setScan({ phase: "idle" });
  } else if (action === "hide-panel" || action === "manual") {
    stopAcquisition();
    state.panel = false;
    render();
    if (action === "manual") $("#ticket-job")?.focus();
  } else if (action === "show-panel") {
    stopAcquisition();
    state.panel = true;
    state.scan = { phase: "idle" };
    render();
  } else if (action === "continue") {
    stopAcquisition();
    state.page = "product";
    state.panel = true;
    state.scan = { phase: "idle" };
    history.replaceState({}, "", `?page=product&lang=${lang}&theme=${theme}`);
    render();
  } else if (action === "edit-location") $("#location-code").focus();
  else if (action === "field") {
    stopAcquisition();
    state.dialog = { field: el.dataset.field };
    state.scan = { phase: "idle" };
    renderDialog();
    $("#field-dialog").showModal();
  } else if (action === "close-dialog") closeDialog();
  else if (action === "replace") {
    const d = state.dialog;
    if (d.batch) {
      if (
        d.field === "product" &&
        d.batch.job &&
        state.job &&
        state.job !== d.batch.job
      ) {
        state.dialog = { field: "job", replace: d.batch.job, batch: d.batch };
        renderDialog();
        return;
      }
      state.product = d.batch.code;
      if (d.batch.job) state.job = d.batch.job;
      state.panel = false;
    } else state[d.field] = d.replace;
    state.source = "barcode";
    closeDialog();
  } else if (action === "clear" || action === "new-ticket") {
    stopAcquisition();
    state.job = "";
    state.product = "";
    state.optional = {};
    state.saved = false;
    state.source = "manual";
    state.scan = { phase: "idle" };
    state.panel = action === "new-ticket";
    render();
    if (action === "clear") notify(t("cleared"));
  } else if (action === "save" && valid()) {
    stopAcquisition();
    state.saved = true;
    state.panel = false;
    render();
    scrollTo(0, 0);
  }
});
document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset.identity) {
    if (state.scan.phase === "reading") {
      stopAcquisition();
      state.scan = { phase: "idle" };
      const panel = $("#main .scan-panel");
      if (panel) panel.outerHTML = scanner();
    }
    state[el.dataset.identity] = el.value;
    $("#save").disabled = !valid();
    const help = $(".footer-inner small");
    help.textContent = valid()
      ? `${t("readyHelp")} F2-L28-18`
      : t("requiredHelp");
  }
  if (el.dataset.optional) state.optional[el.dataset.optional] = el.value;
  if (el.id === "location-code") state.locationCode = el.value;
});
document.addEventListener("change", async (event) => {
  const el = event.target;
  if (el.classList.contains("photo-input")) {
    const file = el.files[0];
    if (!file) return;
    stopAcquisition();
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setScan({ phase: "error", error: t("unsupported") });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setScan({ phase: "error", error: t("oversized") });
      return;
    }
    releaseImage();
    objectUrl = URL.createObjectURL(file);
    await readImage(objectUrl);
  }
  if (el.id === "scenario") sampleState(el.value);
});
document.addEventListener("submit", (event) => {
  if (event.target.id !== "location-search") return;
  event.preventDefault();
  stopAcquisition();
  state.locationCode = $("#location-code").value.trim();
  state.locationResult =
    state.locationCode === "F2-L28-18" ? "mapped" : "unknown";
  render();
});
$("#language").addEventListener("change", (event) => {
  stopAcquisition();
  if (state.scan.phase === "reading" || state.scan.phase === "camera")
    state.scan = { phase: "idle" };
  lang = event.target.value === "en" ? "en" : "th";
  render();
});
$("#theme").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
});
$("#reset").addEventListener("click", () => {
  stopAcquisition();
  releaseImage();
  state.job = "";
  state.product = "";
  state.optional = {};
  state.panel = true;
  state.saved = false;
  state.locationResult = null;
  state.locationCode = "";
  state.source = "manual";
  state.scan = { phase: "idle" };
  state.dialog = null;
  $("#field-dialog").close();
  render();
});
$("#field-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
window.addEventListener("pagehide", () => {
  stopAcquisition();
  releaseImage();
});
render();
if (query.has("scenario")) sampleState(query.get("scenario"));
