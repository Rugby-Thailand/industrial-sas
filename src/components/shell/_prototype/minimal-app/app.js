// THROWAWAY: source-based visual proposals. No auth, camera, AI, upload, or database calls.
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  box: '<path d="m12 3 9 5-9 5-9-5Zm-9 5v9l9 5 9-5V8M12 13v9"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 8v8m3-8v8m4-8v8m3-8v8"/>',
  records:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6m-6 4h6m-6 4h4"/>',
  building: '<path d="M3 21V7l9-4 9 4v14H3Zm5-9h8v9M8 7v1m4-2v2m4-1v1"/>',
  camera: '<path d="M4 7h4l2-3h4l2 3h4v13H4Z"/><circle cx="12" cy="13" r="4"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
const requested = new URL(location.href);
function pageFromPath(path) {
  if (path.endsWith("/scan/records")) return "records";
  if (path.endsWith("/scan")) return "scan";
  if (path === "/finished-goods") return "finished-goods";
  if (path === "/finished-goods/new") return "product";
  if (path.includes("/products/"))
    return path.endsWith("/packing") ? "packing" : "product";
  if (path.includes("/batches/")) return "batch";
  if (path.includes("/pallets/")) {
    const suffix = path.split("/").at(-1);
    return ["measure", "storage", "move", "stack"].includes(suffix)
      ? suffix
      : "pallet";
  }
  if (path === "/master-data/storage-layouts") return "buildings";
  if (path.endsWith("/storage-layouts/new")) return "building";
  if (path.includes("/storage-layouts/"))
    return path.endsWith("/review") ? "review" : "floor";
  return "scan";
}
function buildingFromPath(path) {
  return path.startsWith("/master-data/storage-layouts/")
    ? decodeURIComponent(path.split("/")[3] || "BLDG-A")
    : "BLDG-A";
}
function sourcePath(page, item = "") {
  const u = encodeURIComponent(item || state.unit),
    p = encodeURIComponent(item || state.product),
    b = encodeURIComponent(item || state.building || "BLDG-A");
  const paths = {
    scan: "/finished-goods/scan",
    records: "/finished-goods/scan/records",
    "finished-goods": "/finished-goods",
    product:
      p === "new" ? "/finished-goods/new" : `/finished-goods/products/${p}`,
    packing: `/finished-goods/products/${p}/packing`,
    batch: "/finished-goods/batches/LOT-6907",
    pallet: `/finished-goods/pallets/${u}`,
    measure: `/finished-goods/pallets/${u}/measure`,
    storage: `/finished-goods/pallets/${u}/storage`,
    move: `/finished-goods/pallets/${u}/move`,
    stack: `/finished-goods/pallets/${u}/stack`,
    buildings: "/master-data/storage-layouts",
    building: "/master-data/storage-layouts/new",
    floor: `/master-data/storage-layouts/${b}`,
    review: `/master-data/storage-layouts/${b}/review`,
  };
  return paths[page] || "/finished-goods/scan";
}
const variants = {
  A: "Inline tickets",
  B: "Photo & fields",
  C: "List & editor",
};
const requiredFields = ["factoryOrder", "productBarcodeText"];
const detailFields = [
  "partName",
  "customer",
  "deliveryDate",
  "manufacturingDate",
  "quantity",
  "factoryQuantity",
  "customerQuantity",
];
const numericFields = new Set([
  "quantity",
  "factoryQuantity",
  "customerQuantity",
]);
const state = {
  variant: variants[requested.searchParams.get("variant")]
    ? requested.searchParams.get("variant")
    : "A",
  page: requested.searchParams.get("page") || pageFromPath(requested.pathname),
  locale: requested.searchParams.get("lang") === "en" ? "en" : "th",
  theme: requested.searchParams.get("theme") === "light" ? "light" : "dark",
  catalogueTab: "products",
  query: "",
  recordFilter: "UNMAPPED",
  selectedRecords: [],
  product:
    requested.pathname === "/finished-goods/new"
      ? "new"
      : requested.pathname.includes("/products/")
        ? decodeURIComponent(requested.pathname.split("/")[3])
        : "SPT-RSC450",
  unit: requested.pathname.includes("/pallets/")
    ? decodeURIComponent(requested.pathname.split("/")[3])
    : "PLT-0001",
  floor: Number(requested.searchParams.get("floor")) === 2 ? 2 : 1,
  zone: "F1-L1-2",
  editing: requested.searchParams.get("editing") === "1",
  building:
    requested.searchParams.get("building") ||
    buildingFromPath(requested.pathname),
  catalogueMode: "buildings",
  buildingStatus: "ALL",
  mapView: "map",
  warehouse: "Top Gold",
  measureUnit: "m",
  dimensions: { length: "1.2", width: "1", height: "1.1" },
  verified: false,
  placed: false,
  movePhase: "RESERVED",
  readOnly: false,
};
const tr = (th, en) => (state.locale === "th" ? th : en);
const missingLabels = new Set();
window.previewDiagnostics = { missingLabels };
function t(namespace, key, args = {}) {
  let result = key
    .split(".")
    .reduce((v, k) => v?.[k], REFERENCE.messages[state.locale][namespace]);
  if (typeof result !== "string") {
    missingLabels.add(`${namespace}.${key}`);
    return key;
  }
  for (const [k, v] of Object.entries(args))
    result = result.replaceAll(`{${k}}`, String(v));
  return result;
}
const j = (key, args) => t("JobScan", key, args);
const f = (key) =>
  key === "status"
    ? tr("สถานะ", "Status")
    : t(
        "FinishedGoods",
        `copy.${key === "storage-format" ? "packing-format" : key}`,
      );
const l = (key, args) => t("StorageLayouts", key, args);
const nav = [
  ["finished-goods", "finishedGoods", "box"],
  ["scan", "jobScan", "scan"],
  ["records", "jobScanRecords", "records"],
  ["buildings", "storageLayouts", "building"],
];
const fixtureValues = {
  factoryOrder: "FO69070145",
  productBarcodeText: "SPT-RSC450-BOX-01A",
  partName: "CARTON BOX RSC 450x350x300 Rev.01",
  customer: "บริษัท สยามพาร์ท จำกัด",
  deliveryDate: "12/7/2569",
  manufacturingDate: "10/7/2569",
  quantity: "2400",
  factoryQuantity: "400",
  customerQuantity: "400",
};
function newTicket(source = "MANUAL", values = {}) {
  return {
    key: crypto.randomUUID(),
    source,
    status: "ready",
    values: { ...values },
    aiFields: [],
    expanded: false,
  };
}
function photoTicket() {
  return {
    ...newTicket("AI", fixtureValues),
    aiFields: [...requiredFields, ...detailFields],
    imageUrl: "assets/ticket-1.jpg",
    notice: "aiFilled",
  };
}
const draft = {
  location: {
    text: "F1-L1-2",
    code: "F1-L1-2",
    name: "F1-L1-2",
    zoneId: "demo-zone",
  },
  tickets: [photoTicket()],
  selected: null,
  saved: null,
};
draft.selected = draft.tickets[0].key;
const catalogue = [
  {
    sku: "SPT-RSC450",
    name: "CARTON BOX RSC 450x350x300 Rev.01",
    unit: tr("แผ่น", "sheets"),
    quantity: 2400,
    format: "PALLET",
    status: "ACTIVE",
  },
  {
    sku: "BXVMI004",
    name: "VMI BOX TRAY BXVMI004 Rev.02",
    unit: tr("แผ่น", "sheets"),
    quantity: 1000,
    format: "BOX",
    status: "ACTIVE",
  },
  {
    sku: "TOP-CARTON",
    name: "CARTON BOX",
    unit: tr("แผ่น", "sheets"),
    quantity: 0,
    format: "OTHER",
    status: "DRAFT",
  },
];
const storageUnits = [
  {
    code: "PLT-0001",
    sku: "SPT-RSC450",
    quantity: 400,
    status: "STORED",
    location: "F1-L1-2",
    lot: "LOT-6907",
    dimensions: "1.20 × 1.00 × 1.10 m",
  },
  {
    code: "PLT-0002",
    sku: "SPT-RSC450",
    quantity: 400,
    status: "AWAITING_PLACEMENT",
    location: "—",
    lot: "LOT-6907",
    dimensions: "1.20 × 1.00 × 1.10 m",
  },
  {
    code: "PLT-0003",
    sku: "SPT-RSC450",
    quantity: 400,
    status: "AWAITING_MEASUREMENT",
    location: "—",
    lot: "LOT-6907",
    dimensions: "—",
  },
];
const scanRecords = [
  {
    ...fixtureValues,
    id: "record-1",
    source: "AI",
    imageUrl: "assets/ticket-1.jpg",
    locationText: "F1-L1-2",
    locationCode: "F1-L1-2",
    mapped: true,
  },
  {
    ...fixtureValues,
    factoryOrder: "FO69070146",
    id: "record-2",
    source: "BARCODE",
    locationText: "หน้าอาคาร A",
    mapped: false,
  },
  {
    ...fixtureValues,
    factoryOrder: "FO69070147",
    id: "record-3",
    source: "MANUAL",
    locationText: "จุดรับสินค้า",
    mapped: false,
  },
];
const buildings = [
  {
    code: "BLDG-A",
    name: "อาคาร A",
    floors: 2,
    width: 24,
    depth: 18,
    height: 4,
    status: "ACTIVE",
  },
  {
    code: "BLDG-B",
    name: "อาคาร B",
    floors: 1,
    width: 18,
    depth: 12,
    height: 4,
    status: "DRAFT",
  },
];
const product = () =>
  catalogue.find((p) => p.sku === state.product) || catalogue[0];
const unit = () =>
  storageUnits.find((p) => p.code === state.unit) || storageUnits[0];
const complete = (ticket) =>
  requiredFields.every((field) => ticket.values[field]?.trim());
function blocker() {
  if (draft.tickets.some((ticket) => ticket.status === "reading"))
    return j("waitReading");
  if (draft.tickets.some((ticket) => !complete(ticket)))
    return j("saveBlocked");
  return "";
}
function navButton(page, label, classes = "text-button", item = "") {
  return `<a href="${sourcePath(page, item)}" class="${classes}" data-nav="${page}" data-item="${esc(item)}">${label}</a>`;
}
function head(title, description = "", action = "", back = "") {
  return `${back ? `<button class="crumb" data-nav="${back}">← ${back === "pallet" ? esc(state.unit) : back === "product" ? esc(state.product) : back === "buildings" ? l("title") : f("finished-goods")}</button>` : ""}<div class="page-head"><div class="head-copy"><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ""}</div>${action}</div>`;
}
function field(label, name, value = "", options = {}) {
  return `<label class="field"><span class="field-label">${esc(label)}${options.required ? '<span class="required">*</span>' : ""}</span><input name="${esc(name)}" value="${esc(value)}" ${options.type ? `type="${options.type}"` : ""} ${options.required ? "required" : ""} ${options.disabled ? "disabled" : ""} ${options.type === "number" ? 'min="0.001" step="any"' : ""} maxlength="200" /></label>`;
}
function ticketInput(ticket, name) {
  const value = ticket.values[name] || "",
    required = requiredFields.includes(name),
    ai = ticket.aiFields.includes(name);
  return `<label class="field" data-ai="${ai}"><span class="field-label">${j(name)}${required ? '<span class="required">*</span>' : ""}${ai ? '<span class="ai-marker">AI</span>' : ""}</span><input id="field-${ticket.key}-${name}" aria-label="${j(name)}" data-ticket="${ticket.key}" data-field="${name}" value="${esc(value)}" ${required ? 'required aria-required="true"' : ""} aria-invalid="${required && !value.trim()}" ${numericFields.has(name) ? 'inputmode="decimal"' : ""} ${ticket.status === "reading" || state.readOnly ? "disabled" : ""} autocomplete="off" spellcheck="false" maxlength="200" /></label>`;
}
function locationSummary(location = draft.location) {
  if (!location) return "";
  return `${icon("pin")}<strong class="mono">${esc(location.code || location.text)}</strong>${location.name && location.name !== location.code ? `<span class="muted">${esc(location.name)}</span>` : ""}<span class="status ${location.zoneId ? "success" : "warning"}">${j(location.zoneId ? "mapped" : "unmapped")}</span>`;
}
function ticketMarkup(ticket, index, photo = true) {
  const image = ticket.imageUrl || ticket.previewUrl;
  return `<div class="ticket-meta"><span>#${index + 1} · ${j(`source.${ticket.source}`)}</span>${ticket.status === "reading" ? `<span class="warning">${j("reading")}</span>` : ""}<button class="icon-button" data-action="remove-ticket" data-key="${ticket.key}" aria-label="${j("remove")} #${index + 1}" ${state.readOnly ? "disabled" : ""}>${icon("trash")}</button></div>${ticket.notice ? `<p class="ticket-notice ${ticket.notice === "aiFailed" || ticket.notice === "uploadFailed" ? "danger" : ""}"><span>${j(ticket.notice)}</span></p>` : ""}<div class="ticket-body ${!photo || !image ? "no-photo" : ""}">${photo && image ? `<a href="${esc(image)}" target="_blank" rel="noreferrer" aria-label="${j("openPhoto")}"><img class="ticket-photo" src="${esc(image)}" alt="${tr("รูปใบ Job ต้นฉบับ", "Original job ticket")}"/><span class="photo-caption">${j("openPhoto")} ↗</span></a>` : ""}<div class="identity-fields">${requiredFields.map((name) => ticketInput(ticket, name)).join("")}</div></div><details class="disclosure" data-details="${ticket.key}" ${ticket.expanded ? "open" : ""}><summary>${j("moreDetails")} <small>${j("filledCount", { count: detailFields.filter((name) => ticket.values[name]?.trim()).length })}</small></summary><div class="fields">${detailFields.map((name) => ticketInput(ticket, name)).join("")}</div></details>`;
}
function scanScreen() {
  if (state.readOnly)
    return (
      head(j("title")) +
      `<p class="empty">${f("you-can-view-products-and-storage-units-creating-or-changing-records-req")}</p>`
    );
  if (draft.saved)
    return `<div class="saved">${icon("check")}${head(j("saved", { count: draft.saved.count }))}<p>${j("savedAt", { location: draft.saved.location.code || draft.saved.location.text })}</p><button class="button primary" data-action="scan-more">${j("scanMore")}</button> ${navButton("records", j("viewRecords"), "button secondary")}</div>`;
  if (!draft.location)
    return (
      head(j("title"), j("subtitle")) +
      `<section class="section"><h2>${j("locationStepTitle")}</h2><p class="muted">${j("locationStepHint")}</p><button class="button secondary" data-action="location">${icon("pin")}${j("selectLocation")}</button></section>`
    );
  let tickets = "";
  if (!draft.tickets.length) tickets = `<p class="empty">${j("noTickets")}</p>`;
  else if (state.variant === "A")
    tickets = `<ol class="ticket-list">${draft.tickets.map((ticket, index) => `<li class="ticket">${ticketMarkup(ticket, index)}</li>`).join("")}</ol>`;
  else if (state.variant === "B")
    tickets = draft.tickets
      .map(
        (ticket, index) =>
          `<section class="ticket photo-review"><div>${ticket.imageUrl ? `<a href="${ticket.imageUrl}" target="_blank" rel="noreferrer" aria-label="${j("openPhoto")}"><img class="large-photo" src="${ticket.imageUrl}" alt="${tr("รูปใบ Job ต้นฉบับ", "Original job ticket")}"/></a><span class="photo-caption">${j("openPhoto")} ↗</span>` : `<p class="empty">${j(`source.${ticket.source}`)}</p>`}</div><div>${ticketMarkup(ticket, index, false)}</div></section>`,
      )
      .join("");
  else {
    const selected =
      draft.tickets.find((ticket) => ticket.key === draft.selected) ||
      draft.tickets[0];
    tickets = `<div class="review-layout"><div class="ticket-queue" role="group" aria-label="${j("records")}">${draft.tickets.map((ticket, index) => `<button class="ticket-select ${ticket.key === selected.key ? "selected" : ""}" data-action="select-ticket" data-key="${ticket.key}" aria-pressed="${ticket.key === selected.key}"><strong class="mono">${esc(ticket.values.factoryOrder || `#${index + 1}`)}</strong><small>${j(`source.${ticket.source}`)} · ${ticket.status === "reading" ? j("reading") : complete(ticket) ? tr("กรอกครบ", "Complete") : tr("ยังกรอกไม่ครบ", "Incomplete")}</small></button>`).join("")}</div><section class="ticket">${ticketMarkup(selected, draft.tickets.indexOf(selected), false)}${selected.imageUrl ? `<a class="text-button" href="${selected.imageUrl}" target="_blank" rel="noreferrer">${j("openPhoto")} ↗</a>` : ""}</section></div>`;
  }
  return (
    head(j("title")) +
    `<div class="location-line">${locationSummary()}<button class="text-button" data-action="location">${j("change")}</button></div><div class="capture-toolbar"><button class="button secondary" data-action="photo">${icon("camera")}${j("photo")}</button><button class="button" data-action="barcode">${icon("scan")}${j("barcode")}</button><button class="button" data-action="manual">${icon("keyboard")}${j("manual")}</button></div>${tickets}`
  );
}
function recordsScreen() {
  const filtered = scanRecords.filter(
    (record) =>
      (state.recordFilter === "ALL" ||
        (state.recordFilter === "MAPPED") == record.mapped) &&
      `${record.factoryOrder} ${record.productBarcodeText} ${record.partName} ${record.locationText}`
        .toLowerCase()
        .includes(state.query.toLowerCase()),
  );
  return (
    head(
      j("records"),
      j("recordsSubtitle"),
      navButton("scan", j("title"), "button primary"),
    ) +
    `<div class="tabs" role="group">${["UNMAPPED", "MAPPED", "ALL"].map((value) => `<button class="tab ${state.recordFilter === value ? "active" : ""}" data-action="record-filter" data-value="${value}" aria-pressed="${state.recordFilter === value}">${j(value === "ALL" ? "all" : value === "MAPPED" ? "mapped" : "unmapped")} <small>${scanRecords.filter((r) => value === "ALL" || (value === "MAPPED") == r.mapped).length}</small></button>`).join("")}</div><div class="toolbar"><label class="search"><input id="search" data-search placeholder="${j("search")}" aria-label="${j("search")}" value="${esc(state.query)}"/></label></div>${filtered.map((record) => `<article class="record-row"><input type="checkbox" data-record="${record.id}" aria-label="${j("select")} ${esc(record.factoryOrder)}" ${state.selectedRecords.includes(record.id) ? "checked" : ""}/><div><div class="record-identities"><strong class="mono">${esc(record.factoryOrder)}</strong><span class="mono muted">${esc(record.productBarcodeText)}</span></div><p>${esc(record.partName)} · ${Number(record.quantity).toLocaleString()}</p><p class="location-line" style="margin:6px 0">${locationSummary({ text: record.locationText, code: record.locationCode, zoneId: record.mapped ? "demo" : "" })}</p>${record.locationCode && record.locationCode !== record.locationText ? `<p class="muted">“${esc(record.locationText)}”</p>` : ""}<small>${j(`source.${record.source}`)} · ${tr("8 ต.ค. 2569 00:23", "8 Oct 2026, 00:23")}</small></div>${record.imageUrl ? `<a href="${record.imageUrl}" target="_blank" rel="noreferrer" aria-label="${j("openPhoto")}"><img src="${record.imageUrl}" alt=""/></a>` : ""}</article>`).join("") || `<p class="empty">${j("empty")}</p>`}`
  );
}
function statusText(status) {
  if (status === "ACTIVE") return tr("ใช้งาน", "Active");
  const keys = {
    ACTIVE: "active",
    DRAFT: "draft",
    STORED: "stored",
    AWAITING_MEASUREMENT: "awaiting-measurement",
    AWAITING_PLACEMENT: "awaiting-placement",
    RESERVED: "reserved-awaiting-storage",
    MOVE_RESERVED: "awaiting-pickup",
    IN_TRANSIT: "moving",
  };
  const label = f(keys[status] || status);
  return label === keys[status]
    ? tr(
        status === "ACTIVE" ? "ใช้งาน" : "ฉบับร่าง",
        status === "ACTIVE" ? "Active" : "Draft",
      )
    : label;
}
function catalogueScreen() {
  const pallets = state.catalogueTab === "pallets";
  const rows = (pallets ? storageUnits : catalogue).filter((p) =>
    JSON.stringify(p).toLowerCase().includes(state.query.toLowerCase()),
  );
  return (
    head(
      f("finished-goods"),
      f("prepare-goods-scan-packages-and-confirm-their-storage-location"),
      navButton("product", f("add-finished-good"), "button primary", "new"),
    ) +
    `<div class="stats">${[
      ["products", catalogue.length],
      [
        "awaiting-measurement",
        storageUnits.filter((x) => x.status === "AWAITING_MEASUREMENT").length,
      ],
      [
        "awaiting-storage",
        storageUnits.filter((x) => x.status === "AWAITING_PLACEMENT").length,
      ],
      [
        "stored-units",
        storageUnits.filter((x) => x.status === "STORED").length,
      ],
    ]
      .map(
        ([key, count]) =>
          `<div><small>${f(key)}</small><strong>${count}</strong></div>`,
      )
      .join(
        "",
      )}</div><div class="tabs" role="group">${["products", "pallets"].map((tab) => `<button class="tab ${state.catalogueTab === tab ? "active" : ""}" data-action="catalogue-tab" data-value="${tab}" aria-pressed="${state.catalogueTab === tab}">${f(tab === "products" ? "products-f41f9c" : "storage-units-965913")}</button>`).join("")}</div><div class="toolbar"><label class="search"><input id="search" data-search value="${esc(state.query)}" placeholder="${f("search-sku-name-or-storage-unit")}" aria-label="${f("search-sku-name-or-storage-unit")}"/></label><button class="text-button" data-action="catalogue-filters">${tr("ตัวกรอง", "Filters")}</button>${navButton("scan", j("title"))}</div><div class="table-wrap"><table><thead><tr>${(pallets ? [f("storage-unit-ced501"), f("quantity"), f("dimensions"), f("lot"), f("status")] : [f("products"), f("quantity"), f("storage-format"), tr("การจัดเก็บ", "Storage progress"), f("status")]).map((label) => `<th>${esc(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((p) => `<tr><td>${navButton(pallets ? "pallet" : "product", `<strong>${esc(pallets ? p.code : p.name)}</strong>`, "link", pallets ? p.code : p.sku)}<small class="mono">${esc(p.sku)}</small></td><td>${p.quantity.toLocaleString()} <small>${tr("แผ่น", "sheets")}</small></td><td>${pallets ? esc(p.dimensions) : esc(p.format)}</td><td>${pallets ? esc(p.lot) : `${storageUnits.filter((u) => u.sku === p.sku && u.status === "STORED").length} ${f("stored")}`}</td><td><span class="status ${p.status === "STORED" || p.status === "ACTIVE" ? "success" : "warning"}">${esc(statusText(p.status))}</span></td></tr>`).join("")}</tbody></table></div>${!rows.length ? `<p class="empty">${j("empty")}</p>` : ""}`
  );
}
function productScreen() {
  const p =
    state.product === "new"
      ? { sku: "", name: "", unit: "แผ่น", status: "DRAFT" }
      : product();
  return (
    head(
      f(
        state.product === "new"
          ? "create-finished-good"
          : "finished-good-details",
      ),
      "",
      "",
      "finished-goods",
    ) +
    `<form id="product-form" class="form-page"><section class="section"><h2>${f("product-details")}</h2><div class="fields">${field(f("sku"), "sku", p.sku, { required: true })}${field(f("product-name"), "name", p.name, { required: true })}${field(f("counting-unit-78d38c"), "unit", p.unit, { required: true })}</div></section><section class="section"><h2>${f("storage-requirements")}</h2><div class="fields"><label class="field"><span class="field-label">${f("storage-condition")}</span><select name="storageCondition"><option value="ANY">${f("no-special-condition")}</option><option value="DRY">${f("dry-area")}</option><option value="AMBIENT">${f("ambient")}</option><option value="COOL">${f("cool-area")}</option></select></label>${field(f("storage-notes"), "notes", "")}</div></section><details><summary>${f("references-optional")}</summary><div class="fields">${field(f("customer-reference"), "customerReference", "")}${field(f("product-reference"), "productReference", "")}</div></details><p class="inline-notice">${f("quantities-packaging-and-actual-outer-dimensions-belong-to-each-preparat")}</p><button class="button primary" type="submit">${f(state.product === "new" ? "next-packing" : "save-product-details")}</button> ${state.product === "new" ? "" : navButton("packing", f("prepare-more-goods"), "button secondary")}</form>${state.product !== "new" ? `<section class="section" style="margin-top:32px"><h2>${f("preparation-batches")}</h2><div class="list-row"><div><strong>LOT-6907</strong><small>2,400 ${tr("แผ่น", "sheets")} · 6 ${f("units")}</small></div>${navButton("batch", f("batch-details"))}</div></section>` : ""}`
  );
}
function batchScreen() {
  return (
    head(
      f("batch-details"),
      `${product().name} · LOT-6907`,
      navButton("packing", f("edit-available-units"), "button secondary"),
      "product",
    ) +
    `<div class="stats"><div><small>${f("batch-total")}</small><strong>2,400</strong></div><div><small>${f("units")}</small><strong>6</strong></div></div>${storageUnits.map((u) => `<div class="list-row"><div><strong class="mono">${u.code}</strong><small>${u.quantity} ${tr("แผ่น", "sheets")} · ${u.dimensions} · ${statusText(u.status)}</small></div>${navButton("pallet", f("view-storage"), "text-button", u.code)}</div>`).join("")}`
  );
}
function packingScreen() {
  return (
    head(f("storage-and-packing"), product().name, "", "product") +
    `<form id="packing-form" class="form-page"><section class="section"><h2>${f("batch-details")}</h2><div class="fields">${field(f("batch-total"), "total", 2400, { type: "number", required: true })}${field(f("lot"), "lot", "LOT-6907")}</div></section><section class="section"><h2>${f("storage-units-965913")}</h2><div class="fields"><label class="field"><span class="field-label">${f("storage-format")}</span><select name="format"><option>PALLET</option><option>BOX</option><option>OTHER</option></select></label>${field(f("quantity-per-unit"), "quantity", 400, { type: "number", required: true })}${field(tr("จำนวนหน่วยจัดเก็บ", "Storage unit count"), "count", 6, { type: "number", required: true })}${field(f("length"), "length", 1.2, { type: "number", required: true })}${field(f("width"), "width", 1, { type: "number", required: true })}${field(f("height"), "height", 1.1, { type: "number", required: true })}</div><label class="checkline"><input name="checked" type="checkbox" required/>${f("actual-outside-dimensions-checked")}</label></section><button class="button primary" type="submit">${f("review-and-create")}</button></form>`
  );
}
function palletScreen() {
  const u = unit();
  return (
    head(
      u.code,
      `${product().name} · ${u.quantity} ${tr("แผ่น", "sheets")} · ${statusText(u.status)}`,
      "",
      "finished-goods",
    ) +
    `<section class="section"><h2>${f("saved-storage-location")}</h2><div class="location-line">${locationSummary({ text: u.location, code: u.location, zoneId: u.status === "STORED" ? "demo" : "" })}</div><p class="muted">${u.dimensions} · ${u.lot}</p><div class="toolbar">${navButton("measure", f("measure-unit"), "button secondary")}${navButton("storage", f("find-storage"), "button primary")}${u.status === "STORED" ? navButton("move", f("move-unit")) + navButton("stack", f("stack-on-top")) : ""}</div></section><section class="section"><h2>${f("batch-details")}</h2>${navButton("batch", u.lot, "link")}</section>`
  );
}
function measureScreen() {
  return (
    head(
      tr("วัดขนาดพาเลท", "Measure pallet"),
      tr(
        "วัดขนาดภายนอกทั้งหมด รวมฐานพาเลทและบรรจุภัณฑ์",
        "Measure the complete outside, including pallet and packaging.",
      ),
      "",
      "pallet",
    ) +
    `<form id="measure-form" class="form-page"><section class="section"><h2>${tr("พาเลทจริง", "Physical pallet")}</h2><div class="fields">${field(tr("รหัสพาเลท", "Pallet ID"), "code", state.unit, { disabled: true })}${field(tr("จำนวนจริง", "Actual quantity"), "quantity", unit().quantity, { disabled: true })}${field(tr("ล็อต (ไม่บังคับ)", "Lot (optional)"), "lot", unit().lot)}</div></section><section class="section"><h2>${tr("ขนาดภายนอก", "External dimensions")}</h2><div class="tabs"><button type="button" class="tab ${state.measureUnit === "m" ? "active" : ""}" data-action="measure-unit" data-value="m">${tr("เมตร", "Metres")}</button><button type="button" class="tab ${state.measureUnit === "cm" ? "active" : ""}" data-action="measure-unit" data-value="cm">${tr("เซนติเมตร", "Centimetres")}</button></div><div class="fields" style="margin-top:20px">${["length", "width", "height"].map((key) => field(`${f(key)} (${state.measureUnit})`, key, state.dimensions[key], { type: "number", required: true })).join("")}${field(tr("น้ำหนัก กก. (ไม่บังคับ)", "Weight kg (optional)"), "weight", "")}</div></section><button type="submit" class="button primary">${f("recommend-storage")}</button></form>`
  );
}
function storageScreen() {
  return (
    head(
      f("find-storage"),
      `${state.unit} · ${unit().dimensions}`,
      "",
      "pallet",
    ) +
    `<div class="floor-layout"><div><h2>${tr("เลือกตำแหน่งจัดเก็บ", "Choose a storage position")}</h2>${floorMap()}<p class="inline-notice">${tr("ผังตัวอย่างสำหรับเทียบรูปแบบหน้าจอ", "Sample layout for comparing the design")}</p></div><section class="section"><h2>${state.zone}</h2><p class="success">${f("dimensions-fit-inside-the-support")}</p><p class="muted" style="margin-top:12px">${f("storage-condition-is-not-configured-for-this-location-confirm-suitabilit")}</p><button class="button primary" data-action="reserve">${tr("จองพื้นที่และตรวจสอบ", "Reserve & verify")}</button></section></div>`
  );
}
function moveScreen() {
  return (
    head(
      f(
        state.movePhase === "IN_TRANSIT"
          ? "confirm-pallet-move"
          : "move-prepared",
      ),
      state.unit,
      "",
      "pallet",
    ) +
    `<div class="stats"><div><small>${f("from")}</small><strong style="font-size:20px">F1-L1-2</strong></div><div><small>${f("to")}</small><strong style="font-size:20px">${state.zone === "F1-L1-2" ? "F1-L1-3" : state.zone}</strong></div><div><small>${f("status")}</small><strong style="font-size:20px">${statusText(state.movePhase)}</strong></div></div><form id="move-form" class="form-page"><section class="section"><h2>${f(state.movePhase === "IN_TRANSIT" ? "place-at-this-destination" : "pick-up-this-pallet")}</h2>${field(tr("รหัสตำแหน่งปลายทาง", "Destination code"), "verification", state.verified ? state.zone : "", { required: state.movePhase === "IN_TRANSIT" })}<label class="checkline"><input name="physical" type="checkbox" required/>${f(state.movePhase === "IN_TRANSIT" ? "place-the-pallet-at-the-guided-position-before-confirming-storage" : "tick-after-pickup-both-spaces-stay-reserved")}</label><p class="inline-notice">${f("both-the-source-and-destination-stay-held-the-stored-position-changes-on")}</p><button class="button primary" type="submit">${f(state.movePhase === "IN_TRANSIT" ? "confirm-move-complete" : "start-move")}</button></section></form>`
  );
}
function stackScreen() {
  return (
    head(
      f("stack-on-top-c3ca8e"),
      `${f("support-cb893d")} · ${state.unit}`,
      "",
      "pallet",
    ) +
    `<form id="stack-form" class="form-page"><section class="section"><h2>${f("upper-pallet")}</h2><label class="field"><span class="field-label">${f("choose-a-measured-pallet")}</span><select name="upper"><option>PLT-0002</option></select></label><label class="checkline"><input name="stackable" type="checkbox" checked/>${f("may-support-another-pallet")}</label>${field(f("maximum-levels-including-this-pallet"), "levels", 2, { type: "number", required: true })}<p class="inline-notice">${f("footprint-height-collision-and-stack-level-checks-pass")}</p><button class="button primary" type="submit">${f("reserve-stack-and-verify")}</button></section></form>`
  );
}
function buildingModel(b) {
  return `<svg class="building-model" viewBox="0 0 100 90" role="img" aria-label="${esc(b.code)} · ${b.floors} ${l("floors")}">${Array.from({ length: b.floors }, (_, i) => `<path d="M8 ${60 - i * 20} 52 ${80 - i * 20} 92 ${60 - i * 20} 48 ${40 - i * 20}Z" fill="var(--app-token-accent-surface)" stroke="var(--muted)" stroke-width="1"/>`).join("")}</svg>`;
}
function demoGeometry() {
  const b = buildings.find((b) => b.code === state.building) || buildings[0];
  const demo = REFERENCE.floorDemo[state.locale];
  return b.code === "BLDG-A"
    ? demo
    : {
        ...demo,
        widthMm: b.width * 1000,
        depthMm: b.depth * 1000,
        zones: [],
        blocks: [],
      };
}
function usage(b) {
  const demo = REFERENCE.floorDemo[state.locale],
    gross = b.width * b.depth * b.floors;
  const blocked =
    b.code === "BLDG-A"
      ? demo.blocks.reduce(
          (sum, block) => sum + (block.widthMm * block.depthMm) / 1e6,
          0,
        ) * b.floors
      : 0;
  const placed =
    b.code === "BLDG-A" ? demo.zones.flatMap((zone) => zone.placements) : [];
  const stored =
    placed
      .filter((p) => p.status === "STORED")
      .reduce((sum, p) => sum + (p.widthMm * p.depthMm) / 1e6, 0) * b.floors;
  const held =
    placed
      .filter((p) => p.status === "RESERVED")
      .reduce((sum, p) => sum + (p.widthMm * p.depthMm) / 1e6, 0) * b.floors;
  return {
    gross,
    blocked,
    stored,
    held,
    free: gross - blocked - stored - held,
  };
}
function buildingsScreen() {
  const filtered = buildings.filter(
    (b) =>
      `${b.code} ${b.name}`.toLowerCase().includes(state.query.toLowerCase()) &&
      (state.buildingStatus === "ALL" || b.status === state.buildingStatus),
  );
  const rows = REFERENCE.floorDemo[state.locale].zones.filter((zone) =>
    `${zone.code} ${zone.label}`
      .toLowerCase()
      .includes(state.query.toLowerCase()),
  );
  const view = state.catalogueMode === "locations";
  return (
    head(
      l("title"),
      l("description"),
      navButton("building", l("newBuilding"), "button primary", "new"),
    ) +
    `<div class="tabs" role="group"><button class="tab ${!view ? "active" : ""}" data-action="building-mode" data-value="buildings">${tr("อาคาร", "Buildings")}</button><button class="tab ${view ? "active" : ""}" data-action="building-mode" data-value="locations">${tr("จุดจัดเก็บทั้งหมด", "All locations")}</button></div><div class="toolbar"><label class="search"><input id="search" data-search value="${esc(state.query)}" aria-label="${l("search")}" placeholder="${l("search")}"/></label><label class="filter-select"><select data-building-status aria-label="${l("statusFilter")}">${["ALL", "ACTIVE", "DRAFT", "ARCHIVED"].map((value) => `<option value="${value}" ${state.buildingStatus === value ? "selected" : ""}>${l(value === "ALL" ? "allStatuses" : value.toLowerCase())}</option>`).join("")}</select></label></div>${
      view
        ? `<div class="table-wrap"><table><thead><tr>${[tr("จุดจัดเก็บ / รหัส", "Location / code"), tr("อาคาร / ชั้น", "Building / floor"), l("dimensions"), tr("สินค้า / จอง", "Stored / reserved"), l("actions")].map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${state.buildingStatus === "ALL" || state.buildingStatus === "ACTIVE" ? rows.map((zone) => `<tr><td><strong>${esc(zone.label)}</strong><small class="mono">${zone.code}</small></td><td>BLDG-A · 1</td><td>${zone.widthMm / 1000} × ${zone.depthMm / 1000} m</td><td>${zone.placements.filter((p) => p.status === "STORED").length} / ${zone.placements.filter((p) => p.status === "RESERVED").length}</td><td><button class="text-button" data-action="open-demo-zone" data-value="${zone.code}">${tr("เปิดผัง", "Open plan")}</button></td></tr>`).join("") : ""}</tbody></table></div>`
        : filtered
            .map((b) => {
              const area = usage(b);
              return `<article class="building-row"><a href="${sourcePath("floor", b.code)}" data-nav="floor" data-item="${b.code}">${buildingModel(b)}</a><div><small class="mono">${b.code}</small><h2>${navButton("floor", esc(b.name), "link", b.code)}</h2><small>${b.floors} ${l("floors")} · ${b.width} × ${b.depth} m</small></div><div class="occupancy"><button class="text-button" data-action="space-details" data-value="${b.code}">${tr("พื้นที่ว่างคงเหลือ", "Remaining floor space")}<strong>${area.free.toFixed(1)} m²</strong></button></div><div class="building-actions"><button class="text-button status ${b.status === "ACTIVE" ? "success" : "warning"}" data-action="building-status" data-value="${b.code}" aria-pressed="${b.status === "ACTIVE"}">${l(b.status === "ACTIVE" ? "active" : "draft")}</button><button class="text-button" data-action="building-settings" data-value="${b.code}">${l("dimensions")}</button>${navButton("review", l("reviewTitle"), "text-button", b.code)}</div></article>`;
            })
            .join("")
    }<div class="pagination"><small>${view ? rows.length : filtered.length} ${tr("รายการในหน้านี้", "records on this page")}</small><button class="text-button" disabled>←</button><span>1</span><button class="text-button" disabled>→</button></div><p class="inline-notice">${l("planningNotice")} · ${l("planningNoticeBody")}</p>`
  );
}

function buildingScreen() {
  const b =
    state.building === "new"
      ? { code: "BLDG-C", name: "", width: 24, depth: 18, height: 4, floors: 2 }
      : buildings.find((b) => b.code === state.building) || buildings[0];
  return (
    head(
      state.building === "new" ? l("newBuilding") : l("dimensions"),
      state.building === "new" ? "" : b.name,
      "",
      "buildings",
    ) +
    `<form id="building-form" class="form-page"><div class="fields">${field(l("code"), "code", b.code, { required: true, disabled: state.building !== "new" })}${field(l("name"), "name", b.name, { required: true })}${field(l("width"), "width", b.width, { type: "number", required: true })}${field(l("depth"), "depth", b.depth, { type: "number", required: true })}${field(l("height"), "height", b.height, { type: "number", required: true })}${field(l("floors"), "floors", b.floors, { type: "number", required: true })}</div><button class="button primary" type="submit">${l(state.building === "new" ? "create" : "reviewImpact")}</button></form>`
  );
}
function floorMap() {
  const demo = demoGeometry(),
    scale = 540 / demo.widthMm,
    height = demo.depthMm * scale;
  if (!demo.zones.some((zone) => zone.code === state.zone))
    state.zone = demo.zones[0]?.code || "";
  return `<div class="floor-scene" style="margin-top:20px"><svg viewBox="0 0 600 ${height + 90}" role="group" aria-label="${tr("ผัง demo จากโค้ด", "Demo plan from the codebase")}"><rect x="30" y="45" width="540" height="${height}"/><text x="30" y="25">${esc(state.building)} · ${l("floor", { floor: state.floor })} · ${demo.widthMm / 1000} × ${demo.depthMm / 1000} m</text>${demo.blocks.map((block) => `<rect class="reserved-area" x="${30 + block.xMm * scale}" y="${45 + block.yMm * scale}" width="${block.widthMm * scale}" height="${block.depthMm * scale}"/>`).join("")}${demo.zones.map((zone) => `<g><rect class="zone ${state.zone === zone.code ? "selected" : ""}" x="${30 + zone.xMm * scale}" y="${45 + zone.yMm * scale}" width="${zone.widthMm * scale}" height="${zone.depthMm * scale}" tabindex="0" role="button" aria-label="${zone.code}" data-action="zone" data-value="${zone.code}"/>${zone.placements.map((p) => `<rect class="placement ${p.status === "RESERVED" ? "reserved" : ""}" x="${30 + (zone.xMm + p.xMm) * scale + 2}" y="${45 + (zone.yMm + p.yMm) * scale + 2}" width="${p.widthMm * scale - 4}" height="${p.depthMm * scale - 4}"/>`).join("")}<text class="zone-label" x="${30 + zone.xMm * scale + 8}" y="${45 + zone.yMm * scale + zone.depthMm * scale + 16}">${zone.code} · ${zone.placements.length}</text></g>`).join("")}</svg></div>`;
}

function floorScreen() {
  const b = buildings.find((b) => b.code === state.building) || buildings[0],
    demo = demoGeometry();
  if (!demo.zones.some((zone) => zone.code === state.zone))
    state.zone = demo.zones[0]?.code || "";
  const selected = demo.zones.find((zone) => zone.code === state.zone);
  return (
    head(
      b.name,
      `${b.code} · ${l("dimensions")}: ${b.width} × ${b.depth} m`,
      `<button class="text-button" data-action="building-settings" data-value="${b.code}">${l("openSettings")}</button>${navButton("review", l("reviewTitle"), "button secondary", b.code)}`,
      "buildings",
    ) +
    `<div class="toolbar"><div class="tabs">${Array.from({ length: b.floors }, (_, i) => `<button class="tab ${state.floor === i + 1 ? "active" : ""}" data-action="floor" data-value="${i + 1}">${l("floor", { floor: i + 1 })}</button>`).join("")}</div><button class="text-button" data-action="map-view" data-value="${state.mapView === "map" ? "list" : "map"}">${l(state.mapView === "map" ? "mobileList" : "mobileMap")}</button><button class="text-button" data-action="floor-edit">${l(state.editing ? "closeFloorEditing" : "editFloor", { floor: state.floor })}</button></div><div class="floor-layout"><div>${state.mapView === "map" ? floorMap() : `<div class="table-wrap"><table><thead><tr><th>${tr("จุดจัดเก็บ", "Location")}</th><th>${tr("จำนวนหน่วย", "Units")}</th><th>${tr("จัดเก็บ / จอง", "Stored / reserved")}</th></tr></thead><tbody>${demo.zones.map((zone) => `<tr><td><button class="link" data-action="zone" data-value="${zone.code}">${zone.code}</button><small>${esc(zone.label)}</small></td><td>${zone.placements.length}</td><td>${zone.placements.filter((p) => p.status === "STORED").length} / ${zone.placements.filter((p) => p.status === "RESERVED").length}</td></tr>`).join("")}</tbody></table></div>`}<p class="inline-notice">${tr("ผังและสินค้า demo จาก storageFloorDemoData.ts", "Isolated demo layout and inventory from storageFloorDemoData.ts")}</p></div><section class="section"><h2>${selected?.code || tr("ยังไม่มีจุดจัดเก็บ", "No storage locations")}</h2>${selected ? `<p class="muted">${esc(selected.label)}</p><p>${selected.widthMm / 1000} × ${selected.depthMm / 1000} m</p><p class="muted">${selected.placements.length} ${f("units")} · ${selected.placements.filter((p) => p.status === "RESERVED").length} ${tr("จองแล้ว", "reserved")}</p>${state.editing ? `<button class="text-button" data-action="edit-zone">${l("canvasEditLocation")}</button>` : ""}` : ""}</section></div>${state.editing ? `<button class="button primary" data-action="review-floor">${l("reviewImpact")}</button>` : ""}`
  );
}

function reviewScreen() {
  const b = buildings.find((b) => b.code === state.building) || buildings[0],
    area = usage(b);
  return (
    head(
      l("reviewTitle"),
      `${b.code} · ${l("reviewDescription")}`,
      "",
      "buildings",
    ) +
    `<div class="table-wrap"><table><thead><tr>${["floors", "dimensions", "usableArea", "blockedArea", "storageZones"].map((k) => `<th>${l(k)}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: b.floors }, (_, i) => `<tr><td><button class="link" data-action="review-select-floor" data-value="${i + 1}">${l("floor", { floor: i + 1 })}</button></td><td>${b.width} × ${b.depth} × ${b.height} m</td><td>${((area.gross - area.blocked) / b.floors).toFixed(1)} m²</td><td>${(area.blocked / b.floors).toFixed(1)} m²</td><td>${b.code === "BLDG-A" ? 4 : 0}</td></tr>`).join("")}</tbody></table></div><p class="inline-notice">${tr("ข้อมูล demo จาก repo ต้องตรวจสอบโครงสร้างและตำแหน่งจริงก่อนเปิดใช้งาน", "Repository demo data. Review the actual structure and positions before activating.")}</p><button class="button primary" data-action="activate-building">${l("activate")}</button>`
  );
}
const screens = {
  scan: scanScreen,
  records: recordsScreen,
  "finished-goods": catalogueScreen,
  product: productScreen,
  batch: batchScreen,
  packing: packingScreen,
  pallet: palletScreen,
  measure: measureScreen,
  storage: storageScreen,
  move: moveScreen,
  stack: stackScreen,
  buildings: buildingsScreen,
  building: buildingScreen,
  floor: floorScreen,
  review: reviewScreen,
};

function syncURL(push = false) {
  const url = new URL(location.href);
  url.pathname = sourcePath(state.page);
  for (const key of ["page", "variant", "theme"])
    url.searchParams.set(key, state[key]);
  url.searchParams.set("lang", state.locale);
  url.searchParams.set("floor", String(state.floor));
  url.searchParams.set("building", state.building);
  if (state.editing) url.searchParams.set("editing", "1");
  else url.searchParams.delete("editing");
  history[push ? "pushState" : "replaceState"]({}, "", url);
}
function renderShell() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.variant = state.variant;
  document.documentElement.lang = state.locale;
  const active = [
    "product",
    "packing",
    "batch",
    "pallet",
    "measure",
    "storage",
    "move",
    "stack",
  ].includes(state.page)
    ? "finished-goods"
    : ["building", "floor", "review"].includes(state.page)
      ? "buildings"
      : state.page;
  $("sidebar").innerHTML =
    `<a class="brand" href="/finished-goods" data-nav="finished-goods">${icon("building")}Storage Planner</a><div class="nav-section">${t("Navigation", "sectionPlanner")}</div><nav>${nav.map(([page, key, image]) => `<a href="${sourcePath(page)}?variant=${state.variant}&theme=${state.theme}&lang=${state.locale}" data-nav="${page}" class="nav-link ${active === page ? "active" : ""}" ${active === page ? 'aria-current="page"' : ""}>${icon(image)}${t("Navigation", key)}</a>`).join("")}</nav><div class="account"><span class="avatar">TG</span><div>Top Gold<small>${tr("คลังสินค้า", "Warehouse")}</small></div></div>`;
  $("warehouse").hidden = !["finished-goods", "buildings"].includes(state.page);
  $("warehouse").textContent = `${state.warehouse} ⌄`;
  $("locale").textContent = state.locale === "th" ? "🇹🇭 ไทย" : "🇬🇧 EN";
  $("theme").innerHTML = icon(state.theme === "dark" ? "moon" : "sun");
  $("theme").setAttribute("aria-label", t("Navigation", "toggleTheme"));
  $("variant-label").textContent =
    `${state.variant} · ${variants[state.variant]}`;
  document.querySelectorAll("button[data-variant]").forEach((button) => {
    button.classList.toggle("active", button.dataset.variant === state.variant);
    button.setAttribute(
      "aria-pressed",
      button.dataset.variant === state.variant,
    );
  });
}
function renderSavebar() {
  if (
    state.page === "scan" &&
    draft.location &&
    !draft.saved &&
    !state.readOnly
  ) {
    const reason = blocker(),
      count = draft.tickets.length;
    $("savebar").innerHTML =
      `<div class="actionbar"><div class="actionbar-inner"><p class="actionbar-message ${reason ? "danger" : ""}" role="status">${reason || (count ? `${count} ${tr("ใบพร้อมบันทึก", "tickets ready")}` : j("noTickets"))}</p><button class="button primary" data-action="save-tickets" ${!count || reason ? "disabled" : ""}>${j("save", { count })}</button></div></div>`;
  } else if (state.page === "records" && state.selectedRecords.length)
    $("savebar").innerHTML =
      `<div class="actionbar"><div class="actionbar-inner"><span class="actionbar-message">${state.selectedRecords.length} ${tr("รายการที่เลือก", "selected")}</span><button class="button primary" data-action="map-records">${j("mapSelected", { count: state.selectedRecords.length })}</button></div></div>`;
  else $("savebar").innerHTML = "";
}
function render(preserve = false) {
  const active = preserve ? document.activeElement : null,
    id = active?.id,
    start = active?.selectionStart;
  if (!screens[state.page]) state.page = "scan";
  if (["floor", "review"].includes(state.page)) {
    const building =
      buildings.find((b) => b.code === state.building) || buildings[0];
    if (state.floor > building.floors) state.floor = 1;
  }
  renderShell();
  $("main").dataset.page = state.page;
  $("main").innerHTML = screens[state.page]();
  renderSavebar();
  syncURL();
  document.title = `${$("main").querySelector("h1")?.textContent} · ${state.variant} · HTML preview`;
  if (id && $(id)) {
    $(id).focus();
    if (typeof start === "number") $(id).setSelectionRange(start, start);
  }
}
function navigate(page, item = "") {
  state.page = page;
  state.query = "";
  if ($("dialog").open) closeDialog();
  if (page === "move" && state.zone === unit().location) state.zone = "F1-L1-3";
  if (page === "product" && item) state.product = item;
  if (page === "pallet" && item) state.unit = item;
  if (["floor", "review"].includes(page) && item) state.building = item;
  if (page === "building") state.building = "new";
  document.body.classList.remove("nav-open");
  $("backdrop").hidden = true;
  syncURL(true);
  render();
  window.scrollTo(0, 0);
  $("main").focus();
}
let dialogReturn = null;
function showDialog(title, body) {
  dialogReturn = document.activeElement;
  $("dialog-title").textContent = title;
  $("dialog-body").innerHTML = body;
  if (!$("dialog").open) $("dialog").showModal();
}
function closeDialog() {
  $("dialog").close();
  dialogReturn?.isConnected && dialogReturn.focus();
}
let toastTimer;
function notify(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3000);
}
function locationDialog(mapping = false) {
  showDialog(
    j("selectLocation"),
    `<div class="scenario-list">${["F1-L1-1", "F1-L1-2", "F1-L1-3", "F2-L1-1"].map((code) => `<button class="button secondary" data-action="pick-location" data-value="${code}" data-map="${mapping}">${icon("pin")}${code}</button>`).join("")}</div>${mapping ? "" : `<form id="location-form" style="margin-top:24px">${field(j("searchLocation"), "text", "", { required: true })}<p class="inline-notice">${j("unmappedHint")}</p><button type="submit" class="button primary">${tr("บันทึกข้อความไว้ก่อน", "Use location text")}</button></form>`}`,
  );
}
function applyBarcode(code) {
  const field = /^FO\d{4,}$/i.test(code)
    ? "factoryOrder"
    : "productBarcodeText";
  const target = [...draft.tickets]
    .reverse()
    .find(
      (ticket) => ticket.status === "ready" && !ticket.values[field]?.trim(),
    );
  if (target) {
    target.values[field] = code;
    target.aiFields = target.aiFields.filter((name) => name !== field);
  } else {
    const ticket = newTicket("BARCODE", { [field]: code });
    draft.tickets.push(ticket);
    draft.selected = ticket.key;
  }
  notify(j("barcodeAdded", { field: j(field), code }));
}
function chooseScenario(value) {
  draft.saved = null;
  state.readOnly = false;
  draft.location = {
    text: "F1-L1-2",
    code: "F1-L1-2",
    name: "F1-L1-2",
    zoneId: "demo-zone",
  };
  draft.tickets = [photoTicket()];
  if (value === "multi")
    draft.tickets.push(
      {
        ...newTicket("BARCODE", {
          factoryOrder: "FO69070146",
          productBarcodeText: "SPT-RSC450-BOX-01A",
        }),
      },
      newTicket("MANUAL"),
    );
  if (value === "incomplete") draft.tickets = [newTicket("MANUAL")];
  if (value === "reading")
    draft.tickets = [
      {
        ...newTicket("AI"),
        status: "reading",
        imageUrl: "assets/ticket-1.jpg",
      },
    ];
  if (value === "failed")
    draft.tickets = [
      {
        ...newTicket("AI"),
        notice: "aiFailed",
        imageUrl: "assets/ticket-1.jpg",
      },
    ];
  if (value === "uploadFailed") draft.tickets[0].notice = "uploadFailed";
  if (value === "aiMock") draft.tickets[0].notice = "aiMock";
  if (value === "unmapped") draft.location = { text: "หน้าอาคาร A" };
  if (value === "location") draft.location = null;
  if (value === "empty") draft.tickets = [];
  if (value === "viewOnly") state.readOnly = true;
  draft.selected = draft.tickets[0]?.key;
  state.page = "scan";
  closeDialog();
  render();
}
function action(name, element) {
  const value = element?.dataset.value,
    key = element?.dataset.key;
  if (name === "close") return closeDialog();
  if (name === "building-mode") {
    state.catalogueMode = value;
    state.query = "";
    render();
    return;
  }
  if (name === "map-view") {
    state.mapView = value;
    render();
    return;
  }
  if (name === "review-select-floor") {
    state.floor = Number(value);
    navigate("floor", state.building);
    return;
  }
  if (name === "open-demo-zone") {
    state.building = "BLDG-A";
    state.floor = 1;
    state.zone = value;
    navigate("floor", "BLDG-A");
    return;
  }
  if (name === "building-status") {
    const b = buildings.find((b) => b.code === value);
    b.status = b.status === "ACTIVE" ? "DRAFT" : "ACTIVE";
    render();
    notify(tr("เปลี่ยนสถานะในตัวอย่างแล้ว", "Sample status changed"));
    return;
  }
  if (name === "space-details") {
    const b = buildings.find((b) => b.code === value),
      area = usage(b);
    return showDialog(
      `${tr("รายละเอียดพื้นที่", "Space breakdown")} · ${b.name}`,
      `<div class="stats">${[
        [tr("รวม", "Gross"), area.gross],
        [tr("จัดเก็บแล้ว", "Stored"), area.stored],
        [tr("จองแล้ว", "Reserved"), area.held],
        [tr("ว่าง", "Free"), area.free],
      ]
        .map(
          ([label, amount]) =>
            `<div><small>${label}</small><strong>${amount.toFixed(1)}</strong><small>m²</small></div>`,
        )
        .join(
          "",
        )}</div><p class="inline-notice">${tr("คำนวณจาก footprint ของ demo ใน repo", "Calculated from the repository demo footprints")}</p>`,
    );
  }
  if (name === "building-settings") {
    state.building = value;
    const b = buildings.find((b) => b.code === value);
    return showDialog(
      l("dimensions"),
      `<form id="building-settings-form"><p class="muted" style="margin-bottom:20px">${b.code} · ${l("settingsDescription")}</p><div class="fields">${field(l("name"), "name", b.name, { required: true })}${field(l("width"), "width", b.width, { type: "number", required: true })}${field(l("depth"), "depth", b.depth, { type: "number", required: true })}${field(l("height"), "height", b.height, { type: "number", required: true })}</div><button type="submit" class="button primary">${l("reviewImpact")}</button></form>`,
    );
  }
  if (name === "confirm-building") {
    const pending = state.pendingBuilding,
      existing = buildings.find((b) => b.code === pending.code);
    if (existing) Object.assign(existing, pending);
    else buildings.push({ ...pending, status: "DRAFT" });
    state.building = pending.code;
    state.pendingBuilding = null;
    closeDialog();
    navigate("floor", state.building);
    return;
  }
  if (name === "menu") {
    const open = document.body.classList.toggle("nav-open");
    $("backdrop").hidden = !open;
    return;
  }
  if (name === "theme") {
    state.theme = state.theme === "dark" ? "light" : "dark";
    renderShell();
    syncURL();
    return;
  }
  if (name === "locale") {
    state.locale = state.locale === "th" ? "en" : "th";
    render();
    return;
  }
  if (name === "previous" || name === "next") {
    state.variant = "ABC"[
      ("ABC".indexOf(state.variant) + (name === "next" ? 1 : 2)) % 3
    ];
    render();
    return;
  }
  if (name === "sources")
    return showDialog(
      "Main source references",
      `<p class="muted">Kiro Opus 5.5 recommendations, translated into a static HTML proposal. Based on main <strong>${REFERENCE.commit}</strong>. Sample data only.</p><ul class="source-list">${[...REFERENCE.sources.shell, ...(REFERENCE.sources[state.page] || [])].map((path) => `<li>${esc(path)}</li>`).join("")}</ul><p class="muted">The ticket photo and its nine values match the repository fixture. The floor geometry and placements come from storageFloorDemoData.ts; they are isolated demo inventory. The image below is your supplied current page.</p><img class="source-image" src="assets/current-job-scan.png" alt="Current Job scan screenshot supplied by the user"/>`,
    );
  if (name === "scenarios")
    return showDialog(
      "Preview states",
      `<div class="scenario-list">${[
        ["ready", "AI ready"],
        ["multi", "Multiple tickets"],
        ["incomplete", "Required fields missing"],
        ["reading", "AI reading"],
        ["failed", "AI failed"],
        ["uploadFailed", "Upload failed"],
        ["aiMock", "Main mock notice"],
        ["unmapped", "Unmapped location"],
        ["location", "Location first"],
        ["empty", "No tickets"],
        ["viewOnly", "View only"],
      ]
        .map(
          ([key, label]) =>
            `<button class="button secondary" data-action="scenario" data-value="${key}">${label}</button>`,
        )
        .join(
          "",
        )}</div><details style="margin-top:24px"><summary>In-memory state</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px">${esc(JSON.stringify({ state, draft }, null, 2))}</pre></details>`,
    );
  if (name === "scenario") return chooseScenario(value);
  if (name === "warehouse")
    return showDialog(
      t("Workspace", "warehouse"),
      `<button class="button secondary" data-action="pick-warehouse" data-value="Top Gold">Top Gold</button><button class="button secondary" data-action="pick-warehouse" data-value="Top Gold · B">Top Gold · B</button>`,
    );
  if (name === "pick-warehouse") {
    state.warehouse = value;
    closeDialog();
    render();
    return;
  }
  if (name === "location") return locationDialog();
  if (name === "map-records") return locationDialog(true);
  if (name === "pick-location") {
    if (element.dataset.map === "true") {
      scanRecords
        .filter((record) => state.selectedRecords.includes(record.id))
        .forEach((record) => {
          record.mapped = true;
          record.locationCode = value;
        });
      state.selectedRecords = [];
    } else
      draft.location = {
        text: value,
        code: value,
        name: value,
        zoneId: "demo-zone",
      };
    closeDialog();
    render();
    return;
  }
  if (name === "photo")
    return showDialog(
      j("photo"),
      `<img src="assets/ticket-1.jpg" class="large-photo" alt="Repository job ticket fixture"/><p class="inline-notice">${tr("ลองเพิ่มใบ Job จากรูปตัวอย่างในโค้ด", "Add a job ticket using the repository's sample photo")}</p><button class="button primary" data-action="add-photo">${j("sendToAi", { count: 1 })}</button>`,
    );
  if (name === "add-photo") {
    const ticket = photoTicket();
    draft.tickets.push(ticket);
    draft.selected = ticket.key;
    closeDialog();
    render();
    return;
  }
  if (name === "barcode")
    return showDialog(
      j("barcode"),
      `<form id="barcode-form">${field(j("barcode"), "code", "", { required: true })}<p class="inline-notice">${tr("ลอง FO69070146 หรือ SPT-RSC450-BOX-01A", "Try FO69070146 or SPT-RSC450-BOX-01A")}</p><button class="button primary" type="submit">${tr("เพิ่มบาร์โค้ด", "Add barcode")}</button></form>`,
    );
  if (name === "manual") {
    const ticket = newTicket();
    draft.tickets.push(ticket);
    draft.selected = ticket.key;
    render();
    return;
  }
  if (name === "remove-ticket") {
    draft.tickets = draft.tickets.filter((ticket) => ticket.key !== key);
    render();
    return;
  }
  if (name === "select-ticket") {
    draft.selected = key;
    render();
    return;
  }
  if (name === "save-tickets") {
    if (blocker() || !draft.tickets.length || !draft.location) return;
    const count = draft.tickets.length;
    draft.tickets.forEach((ticket) =>
      scanRecords.unshift({
        ...ticket.values,
        id: crypto.randomUUID(),
        source: ticket.source,
        imageUrl: ticket.imageUrl,
        locationText: draft.location.text,
        locationCode: draft.location.code,
        mapped: !!draft.location.zoneId,
      }),
    );
    draft.saved = { count, location: { ...draft.location } };
    draft.tickets = [];
    render();
    return;
  }
  if (name === "scan-more") {
    draft.saved = null;
    render();
    return;
  }
  if (name === "record-filter") {
    state.recordFilter = value;
    state.selectedRecords = [];
    render();
    return;
  }
  if (name === "catalogue-tab") {
    state.catalogueTab = value;
    state.query = "";
    render();
    return;
  }
  if (name === "catalogue-filters")
    return showDialog(
      tr("ตัวกรองรายการ", "Catalogue filters"),
      `<p class="muted">${tr("ตัวกรองอ้างอิง catalogueFilters.ts", "Filters from catalogueFilters.ts")}</p><div class="fields" style="margin-top:20px">${field(f("counting-unit"), "unit", "แผ่น")}${field(f("lot"), "lot", "")}<label class="field"><span class="field-label">${f("storage-format")}</span><select><option>ALL</option><option>PALLET</option><option>BOX</option><option>OTHER</option></select></label><label class="field"><span class="field-label">${f("status")}</span><select><option>ALL</option>${(state.catalogueTab === "products" ? ["DRAFT", "ACTIVE"] : ["AWAITING_MEASUREMENT", "AWAITING_PLACEMENT", "RESERVED", "STORED", "MOVE_RESERVED", "IN_TRANSIT"]).map((status) => `<option>${status}</option>`).join("")}</select></label></div><p class="inline-notice">${tr("แสดงโครงสร้างตัวกรองเพื่อเทียบดีไซน์", "Filter structure shown for design review")}</p>`,
    );
  if (name === "measure-unit") {
    for (const key of ["length", "width", "height"]) {
      const input = document.querySelector(`[name="${key}"]`);
      if (input)
        state.dimensions[key] = String(
          Number(input.value) *
            (value === state.measureUnit ? 1 : value === "cm" ? 100 : 0.01),
        );
    }
    state.measureUnit = value;
    render();
    return;
  }
  if (name === "zone") {
    state.zone = value;
    render();
    return;
  }
  if (name === "floor") {
    state.floor = Number(value);
    state.zone = `F${value}-L1-2`;
    render();
    return;
  }
  if (name === "floor-edit") {
    state.editing = !state.editing;
    render();
    return;
  }
  if (name === "edit-zone")
    return showDialog(
      l("canvasEditLocation"),
      `<form id="zone-form"><div class="fields">${field(l("code"), "code", state.zone, { disabled: true })}${field(l("name"), "name", state.zone)}${field(l("width"), "width", 3, { type: "number", required: true })}${field(l("depth"), "depth", 2, { type: "number", required: true })}</div><button class="button primary" type="submit">${l("saveAndContinue")}</button></form>`,
    );
  if (name === "review-floor")
    return showDialog(
      l("reviewImpact"),
      `<p>${tr("ตรวจสอบการเปลี่ยนแปลงขนาดและตำแหน่งก่อนบันทึก", "Review dimension and position changes before saving")}</p><p class="inline-notice">${tr("ตัวอย่างนี้ไม่เปลี่ยนตำแหน่งของสินค้าจริง", "This sample does not move stored inventory")}</p><button class="button primary" data-action="confirm-floor">${l("confirmChanges")}</button>`,
    );
  if (name === "confirm-floor") {
    state.editing = false;
    closeDialog();
    render();
    notify(l("floorSaved"));
    return;
  }
  if (name === "activate-building")
    return notify(
      tr("เปิดใช้งานอาคารในตัวอย่างแล้ว", "Sample building activated"),
    );
  if (name === "reserve")
    return showDialog(
      tr("ตรวจสอบปลายทาง", "Verify destination"),
      `<form id="storage-form">${field(tr("รหัสตำแหน่ง", "Location code"), "code", "", { required: true })}<p class="inline-notice">${state.zone}</p><label class="checkline"><input name="placed" type="checkbox" required/>${f("place-the-pallet-at-the-guided-position-before-confirming-storage")}</label><button type="submit" class="button primary">${f("confirm-stored")}</button></form>`,
    );
}
document.addEventListener("click", (event) => {
  const summary = event.target.closest("details[data-details] > summary");
  if (summary) {
    event.preventDefault();
    const details = summary.parentElement;
    const ticket = draft.tickets.find(
      (row) => row.key === details.dataset.details,
    );
    ticket.expanded = !details.open;
    details.open = ticket.expanded;
    return;
  }
  const target = event.target.closest(
    "[data-nav],[data-action],button[data-variant]",
  );
  if (!target) return;
  if (target.dataset.nav) {
    event.preventDefault();
    navigate(target.dataset.nav, target.dataset.item);
  } else if (target.dataset.variant) {
    state.variant = target.dataset.variant;
    render();
  } else action(target.dataset.action, target);
});
document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.dataset.ticket) {
    const ticket = draft.tickets.find(
      (ticket) => ticket.key === target.dataset.ticket,
    );
    ticket.values[target.dataset.field] = target.value;
    ticket.aiFields = ticket.aiFields.filter(
      (name) => name !== target.dataset.field,
    );
    target.closest(".field").dataset.ai = "false";
    target.closest(".field").querySelector(".ai-marker")?.remove();
    target.setAttribute(
      "aria-invalid",
      requiredFields.includes(target.dataset.field) && !target.value.trim(),
    );
    renderSavebar();
  }
  if (target.hasAttribute("data-search")) {
    state.query = target.value;
    if (state.page === "records") state.selectedRecords = [];
    render(true);
  }
});
document.addEventListener("change", (event) => {
  if (event.target.hasAttribute("data-building-status")) {
    state.buildingStatus = event.target.value;
    render();
  }
  if (event.target.dataset.record) {
    const id = event.target.dataset.record;
    state.selectedRecords = event.target.checked
      ? [...state.selectedRecords, id]
      : state.selectedRecords.filter((x) => x !== id);
    renderSavebar();
  }
});
document.addEventListener(
  "toggle",
  (event) => {
    if (event.target.dataset.details && event.target.isConnected) {
      const ticket = draft.tickets.find(
        (ticket) => ticket.key === event.target.dataset.details,
      );
      if (ticket) ticket.expanded = event.target.open;
    }
  },
  true,
);
document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target,
    values = Object.fromEntries(new FormData(form));
  if (form.id === "barcode-form") {
    applyBarcode(values.code.trim());
    closeDialog();
    render();
  }
  if (form.id === "location-form") {
    draft.location = { text: values.text.trim() };
    closeDialog();
    render();
  }
  if (form.id === "product-form") {
    const wasNew = state.product === "new";
    const existing = catalogue.find((p) => p.sku === state.product);
    if (existing) Object.assign(existing, values);
    else
      catalogue.push({
        ...values,
        quantity: 0,
        format: "OTHER",
        status: "DRAFT",
      });
    state.product = values.sku;
    navigate(wasNew ? "packing" : "product");
    notify(tr("บันทึกตัวอย่างแล้ว", "Sample saved"));
  }
  if (form.id === "packing-form") {
    if (Number(values.quantity) * Number(values.count) !== Number(values.total))
      return notify(f("allocated-quantity-must-equal-the-batch-total"));
    showDialog(
      f("review-storage-units"),
      `<p>${esc(values.total)} ${tr("แผ่น", "sheets")} · ${esc(values.count)} ${f("units")}</p><p class="muted">${esc(values.length)} × ${esc(values.width)} × ${esc(values.height)} m</p><button class="button primary" data-nav="batch">${tr("ยืนยันตัวอย่าง", "Confirm sample")}</button>`,
    );
  }
  if (form.id === "measure-form") {
    state.dimensions = {
      length: values.length,
      width: values.width,
      height: values.height,
    };
    unit().dimensions =
      ["length", "width", "height"]
        .map((k) => Number(values[k]) * (state.measureUnit === "cm" ? 0.01 : 1))
        .map((x) => x.toFixed(2))
        .join(" × ") + " m";
    navigate("storage");
  }
  if (form.id === "storage-form") {
    if (values.code.trim() !== state.zone)
      return notify(
        tr(
          "รหัสตำแหน่งไม่ตรงกับปลายทาง",
          "Code does not match the destination",
        ),
      );
    unit().status = "STORED";
    unit().location = state.zone;
    closeDialog();
    navigate("pallet");
    notify(f("storage-confirmed"));
  }
  if (form.id === "move-form") {
    if (state.movePhase === "RESERVED") {
      state.movePhase = "IN_TRANSIT";
      render();
    } else {
      if (values.verification.trim() !== state.zone)
        return notify(
          tr(
            "รหัสตำแหน่งไม่ตรงกับปลายทาง",
            "Code does not match the destination",
          ),
        );
      state.movePhase = "RESERVED";
      unit().location = state.zone;
      navigate("pallet");
      notify(f("storage-confirmed"));
    }
  }
  if (form.id === "stack-form") {
    closeDialog();
    navigate("storage");
    notify(
      tr("จองตำแหน่งซ้อนในตัวอย่างแล้ว", "Sample stacking position reserved"),
    );
  }
  if (form.id === "building-form" || form.id === "building-settings-form") {
    const existing = buildings.find((b) => b.code === state.building);
    state.pendingBuilding = {
      code: values.code || existing?.code,
      name: values.name,
      width: Number(values.width),
      depth: Number(values.depth),
      height: Number(values.height),
      floors: Number(values.floors || existing?.floors || 1),
    };
    showDialog(
      l("reviewImpact"),
      `<p>${esc(values.name)} · ${esc(values.width)} × ${esc(values.depth)} × ${esc(values.height)} m</p><p class="inline-notice">${tr("ตรวจสอบผลต่อชั้นและตำแหน่งจัดเก็บก่อนบันทึก", "Review the effect on floors and storage positions before saving")}</p><button class="button primary" data-action="confirm-building">${l("confirmChanges")}</button>`,
    );
  }
  if (form.id === "zone-form") {
    closeDialog();
    notify(l("savedContinueToStorage"));
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.body.classList.remove("nav-open");
    $("backdrop").hidden = true;
  }
  if (
    $("dialog").open ||
    event.target.closest("input,select,textarea,[contenteditable]")
  )
    return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    action(event.key === "ArrowRight" ? "next" : "previous");
  }
  if (
    event.target.matches("rect[data-action]") &&
    (event.key === "Enter" || event.key === " ")
  ) {
    event.preventDefault();
    action(event.target.dataset.action, event.target);
  }
});
$("backdrop").addEventListener("click", () => {
  document.body.classList.remove("nav-open");
  $("backdrop").hidden = true;
});
window.addEventListener("popstate", () => {
  const params = new URL(location.href).searchParams;
  state.page = params.get("page") || pageFromPath(location.pathname);
  state.floor = Number(params.get("floor")) === 2 ? 2 : 1;
  state.editing = params.get("editing") === "1";
  state.building =
    params.get("building") || buildingFromPath(location.pathname);
  state.variant = variants[params.get("variant")] ? params.get("variant") : "A";
  state.locale = params.get("lang") === "en" ? "en" : "th";
  state.theme = params.get("theme") === "light" ? "light" : "dark";
  render();
});
render();
