// THROWAWAY: compare a compact workspace, an overlaid map finder and a grouped
// location browser. UI state only; no production writes or persistence.
const icons = {
  building:
    '<rect x="4" y="3" width="12" height="18" rx="2"/><path d="M8 7h4m-4 4h4m-4 4h4m4-6h4v12H9v-4h3v4"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15m6-12v15"/>',
  table: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
  split:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M13 4v16m3-11h2m-2 4h2m-2 4h2"/>',
  boxes:
    '<path d="m12 3 5 3v6l-5 3-5-3V6Zm0 6 5-3m-5 3L7 6m5 3v6M7 9 2 12v6l5 3 5-3m5-9 5 3v6l-5 3-5-3v-3"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h3v3H7zm7 0h3v3h-3zm-7 7h3v3H7zm7 0h3v3h-3z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  sliders:
    '<path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11M8 3v6m6 0v6M6 15v6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  sort: '<path d="M8 3v18m-4-4 4 4 4-4M16 21V3m-4 4 4-4 4 4"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.map}</svg>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
const $ = (id) => document.getElementById(id);
const narrow = () => matchMedia("(max-width:700px)").matches;
const names = {
  A: "Compact workspace",
  B: "Map + finder",
  C: "Location browser",
};
const url = new URL(location.href);
const state = {
  variant: names[url.searchParams.get("variant")]
    ? url.searchParams.get("variant")
    : "A",
  view: ["map", "list", "split"].includes(url.searchParams.get("view"))
    ? url.searchParams.get("view")
    : "list",
  floor: url.searchParams.get("floor") === "1" ? 1 : 2,
  search: url.searchParams.get("q") || "",
  filter: "all",
  sort: "code",
  reverse: false,
  page: 0,
  pageSize: 12,
  selected: null,
  group: "all",
  finderOpen: true,
  zoom: 1,
};
let plan, floors, noticeTimer;
const statuses = { empty: "ว่าง", stored: "มีสินค้า", reserved: "จองแล้ว" };
const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const codeSort = new Intl.Collator("en", { numeric: true });
function buildData() {
  const pd = plan.cells.map((cell, index) => ({
    ...cell,
    group: cell.code.match(/L\d+/)?.[0] || "อื่น ๆ",
    status:
      index === 7
        ? "empty"
        : index % 17 === 5
          ? "stored"
          : index % 23 === 4
            ? "reserved"
            : "empty",
    units: index % 17 === 5 ? (index % 3) + 1 : 0,
    height: 3300,
  }));
  const ground = Array.from({ length: 72 }, (_, i) => ({
    code: `PD-F1-L${Math.floor(i / 12) + 1}-${(i % 12) + 1}`,
    group: `L${Math.floor(i / 12) + 1}`,
    xMm: 1200 + Math.floor(i / 12) * 9400,
    yMm: 1000 + (i % 12) * 850,
    widthMm: 8200,
    depthMm: 750,
    height: 3300,
    status: i % 7 === 2 ? "stored" : "empty",
    units: i % 7 === 2 ? 2 : 0,
  }));
  floors = {
    2: { ...plan, cells: pd },
    1: { widthMm: 61500, depthMm: 11960, cells: ground, blocks: [] },
  };
}
const floor = () => floors[state.floor];
function rows() {
  const q = state.search.trim().toLowerCase();
  return floor()
    .cells.filter(
      (c) =>
        (!q || c.code.toLowerCase().includes(q)) &&
        (state.filter === "all" || c.status === state.filter) &&
        (state.variant !== "C" ||
          state.group === "all" ||
          c.group === state.group),
    )
    .sort((a, b) => {
      const value =
        state.sort === "units"
          ? a.units - b.units
          : state.sort === "status"
            ? a.status.localeCompare(b.status)
            : codeSort.compare(a.code, b.code);
      return (
        (state.reverse ? -1 : 1) * (value || codeSort.compare(a.code, b.code))
      );
    });
}
function dims(c) {
  return `${(c.widthMm / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} × ${(c.depthMm / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} × ${c.height / 1000} ม.`;
}
function btn(action, label, name, extra = "") {
  const classes = extra.match(/class="([^"]*)"/)?.[1] || "";
  return `<button class="icon-button ${classes}" data-action="${action}" aria-label="${label}" title="${label}" ${extra.replace(/class="[^"]*"/, "")}>${icon(name)}</button>`;
}
function floorSelect(className = "floor-select") {
  return `<select class="${className}" data-select="floor" aria-label="เลือกชั้น"><option value="2" ${state.floor === 2 ? "selected" : ""}>ชั้น 2</option><option value="1" ${state.floor === 1 ? "selected" : ""}>ชั้น 1</option></select>`;
}
function views() {
  return `<div class="view-switch" role="group" aria-label="มุมมองพื้นที่ทำงาน">${["map", "list", ...(state.variant === "A" ? ["split"] : [])].map((v) => `<button class="icon-button ${v === "split" ? "split-option" : ""}" data-view="${v}" aria-label="${{ map: "แผนผัง", list: "รายการ", split: "แสดงคู่" }[v]}" title="${{ map: "แผนผัง", list: "รายการ", split: "แสดงคู่" }[v]}" aria-pressed="${state.view === v}">${icon(v === "list" ? "table" : v)}</button>`).join("")}</div>`;
}
function searchTools() {
  return `<div class="search-tools"><label class="search-field">${icon("search")}<input id="search" type="text" inputmode="search" aria-label="ค้นหาจุดจัดเก็บ" placeholder="ค้นหารหัสจุดจัดเก็บ…" value="${esc(state.search)}" autocomplete="off"/>${state.search ? btn("clear-search", "ล้างคำค้น", "close") : ""}</label>${btn("filters", "กรองสถานะ", "sliders", `class="filter-button ${state.filter !== "all" ? "active" : ""}" aria-pressed="${state.filter !== "all"}"`)}</div>`;
}
function compactToolbar() {
  return `<header class="compact-tools"><div class="context-tools">${floorSelect()}<span class="floor-count">${floor().cells.length} จุด</span></div>${searchTools()}<div class="tool-end">${views()}${btn("workspace-options", "เพิ่มเติม", "more", 'class="more-actions"')}</div></header>`;
}
function listMeta() {
  const count = rows().length;
  return `<div class="list-meta"><strong>${state.search ? "ผลค้นหา" : "จุดจัดเก็บ"}</strong><span>${count} / ${floor().cells.length} จุด${state.filter !== "all" ? ` · ${statuses[state.filter]}` : ""}</span><button class="sort-trigger" data-action="sort" aria-label="เรียงรายการ">${{ code: "รหัส", units: "จำนวน", status: "สถานะ" }[state.sort]} ${icon(state.reverse ? "down" : "up")}</button></div>`;
}
function detail(c) {
  return `<div class="record-detail"><span>จัดเก็บ <strong>${c.units}</strong></span><span>จอง <strong>${c.status === "reserved" ? 1 : 0}</strong></span><span>ยังไม่วัด <strong>0</strong></span><div class="detail-actions"><button data-locate="${c.code}">${icon("map")}ดูในแผนผัง</button><button data-action="edit">เพิ่มเติม ${icon("right")}</button></div></div>`;
}
function record(c) {
  const expanded = state.selected === c.code;
  return `<li><button class="record record-grid" data-code="${c.code}" aria-expanded="${expanded}" aria-label="${c.code} · ${statuses[c.status]} · ${c.units} หน่วย"><span class="record-title"><i class="status-dot ${c.status}"></i>${c.code}</span><span class="record-dimensions">${dims(c)}</span><span class="record-units">${c.units} หน่วย</span><span class="record-status">${statuses[c.status]}</span><span class="chevron">${icon(expanded ? "down" : "right")}</span></button>${expanded ? detail(c) : ""}${expanded && state.variant === "C" ? `<div class="browser-inline-map">${mapHTML(true)}</div>` : ""}</li>`;
}
function pager() {
  const count = rows().length,
    pages = Math.max(1, Math.ceil(count / state.pageSize));
  return `<footer class="pager"><span class="page-count">${count ? state.page * state.pageSize + 1 : 0}–${Math.min(count, (state.page + 1) * state.pageSize)} / ${count} จุด</span>${pages > 1 ? `<select data-select="page-size" aria-label="จำนวนรายการต่อหน้า">${[12, 25, 50].map((n) => `<option value="${n}" ${state.pageSize === n ? "selected" : ""}>${n} / หน้า</option>`).join("")}</select>${btn("previous-page", "หน้าก่อน", "left", state.page === 0 ? "disabled" : "")}<span>${state.page + 1}/${pages}</span>${btn("next-page", "หน้าถัดไป", "right", state.page >= pages - 1 ? "disabled" : "")}` : state.search || state.filter !== "all" ? '<button class="single-result" data-action="clear-all">ล้างการค้นหา</button>' : ""}</footer>`;
}
function listHTML({ grouped = false } = {}) {
  const visible = rows().slice(
    state.page * state.pageSize,
    (state.page + 1) * state.pageSize,
  );
  let body;
  if (!visible.length)
    body =
      '<div class="empty-result">ไม่พบจุดจัดเก็บที่ตรงกัน<button class="text-button" data-action="clear-all">ล้างการค้นหา</button></div>';
  else if (grouped) {
    const groups = Map.groupBy(visible, (c) => c.group);
    body = [...groups]
      .map(
        ([g, cells]) =>
          `<div class="group-heading"><strong>${g}</strong><span>${rows().filter((c) => c.group === g).length} จุด</span></div><ul class="location-list">${cells.map(record).join("")}</ul>`,
      )
      .join("");
  } else
    body = `<ul class="location-list">${visible.map(record).join("")}</ul>`;
  return `${listMeta()}<div class="column-labels" aria-hidden="true"><span>รหัสจุดจัดเก็บ</span><span>ขนาด ก. × ย. × ส.</span><span>จำนวน</span><span class="status-heading">สถานะ</span><span></span></div><div class="list-scroll">${body}</div>${pager()}`;
}
function drawing() {
  const f = floor(),
    matches = new Set(rows().map((c) => c.code));
  const groups = Map.groupBy(f.cells, (c) => c.group);
  const groupNames = [...groups]
    .map(([name, cells]) => {
      const x = Math.min(...cells.map((c) => c.xMm)),
        y = Math.min(...cells.map((c) => c.yMm));
      return `<text x="${x + 180}" y="${y - 200}" font-size="430">${name}</text>`;
    })
    .join("");
  return `<svg class="plan" viewBox="-900 -1700 ${f.widthMm + 1800} ${f.depthMm + 2600}" aria-label="แผนผังชั้น ${state.floor}" role="img"><g transform="translate(${((1 - state.zoom) * f.widthMm) / 2} ${((1 - state.zoom) * f.depthMm) / 2}) scale(${state.zoom})"><rect width="${f.widthMm}" height="${f.depthMm}" fill="var(--floor)" stroke="var(--wall)" stroke-width="130"/>${f.blocks.map((b) => `<rect x="${b.xMm}" y="${b.yMm}" width="${b.widthMm}" height="${b.depthMm}" fill="${b.color}" opacity=".9"/>`).join("")}${f.cells.map((c) => `<rect data-code="${c.code}" tabindex="0" role="button" aria-label="${c.code}" aria-pressed="${state.selected === c.code}" x="${c.xMm}" y="${c.yMm}" width="${c.widthMm}" height="${c.depthMm}" fill="${c.status === "stored" ? "var(--stored)" : "var(--empty)"}" stroke="${state.selected === c.code ? "var(--accent)" : c.status === "stored" ? "var(--stored-stroke)" : "var(--wall)"}" stroke-width="${state.selected === c.code ? 190 : 40}" ${c.status === "reserved" ? 'stroke-dasharray="120 65"' : ""} opacity="${matches.has(c.code) ? 1 : 0.18}"/>`).join("")}${groupNames}<text x="${f.widthMm / 2}" y="-1000" text-anchor="middle" font-size="530">${f.widthMm / 1000} ม.</text></g></svg>`;
}
function mapDetail(c) {
  return `<aside class="map-detail" aria-label="รายละเอียด ${c.code}"><div class="map-detail-header"><i class="status-dot ${c.status}"></i><strong>${c.code}</strong>${btn("close-details", "ปิดรายละเอียด", "close")}</div><p>ชั้น ${state.floor} · ${dims(c)}</p><div class="map-detail-foot"><span>${statuses[c.status]} · ${c.units} หน่วย</span><button class="text-button" data-action="open-list">ดูรายการ ${icon("right")}</button></div></aside>`;
}
function mapHTML(mini = false) {
  const c = floor().cells.find((c) => c.code === state.selected);
  return `<div class="map-stage"><div class="floor-floating">${icon("layers")}${floorSelect("canvas-floor-select")}</div><div class="canvas-controls"><button class="icon-button projection" aria-label="ผัง 2D" aria-pressed="true">2D</button>${btn("zoom-out", "ย่อแผนผัง", "minus")}${btn("zoom-in", "ขยายแผนผัง", "plus")}${btn("fit", "พอดีหน้าจอ", "fit")}</div>${drawing()}<div class="map-legend"><span><i></i>ว่าง</span><span><i class="stored"></i>มีสินค้า</span><span><i class="reserved"></i>จองแล้ว</span></div><span class="map-scale">ชั้น ${state.floor} · ${floor().cells.length} จุด</span>${c && !mini ? mapDetail(c) : ""}</div>`;
}
export function VariantA() {
  return `${compactToolbar()}${state.view === "map" ? mapHTML() : state.view === "split" && !narrow() ? `<div class="split-layout">${mapHTML()}<section class="list-panel" aria-label="รายการจุดจัดเก็บ">${listHTML()}</section></div>` : `<section class="list-panel" aria-label="รายการจุดจัดเก็บ">${listHTML()}</section>`}`;
}
export function VariantB() {
  if (state.view === "list")
    return `${compactToolbar()}<section class="list-panel" aria-label="รายการจุดจัดเก็บ">${listHTML()}</section>`;
  return `<header class="finder-toolbar"><div class="finder-title"><h2>ผังจัดเก็บ</h2><span>ชั้น ${state.floor} · ${floor().cells.length} จุด</span></div><div class="tool-end">${btn("toggle-finder", state.finderOpen ? "ซ่อนผลค้นหา" : "ค้นหาจุด", "search", `aria-expanded="${state.finderOpen}"`)}${views()}${btn("workspace-options", "เพิ่มเติม", "more")}</div></header><div class="finder-shell ${state.finderOpen ? "" : "finder-closed"}">${mapHTML()}${state.finderOpen ? `<section class="finder-panel" aria-label="ค้นหาในแผนผัง">${searchTools()}${listHTML()}</section>` : ""}</div>`;
}
export function VariantC() {
  const groups = [...Map.groupBy(floor().cells, (c) => c.group)].sort(
    ([a], [b]) => codeSort.compare(a, b),
  );
  const tabs = `<nav class="group-tabs" aria-label="เลือกกลุ่มจุดจัดเก็บ"><button class="group-tab" data-group="all" aria-pressed="${state.group === "all"}">ทุกกลุ่ม <span>${floor().cells.length}</span></button>${groups.map(([g, cells]) => `<button class="group-tab" data-group="${g}" aria-pressed="${state.group === g}">${g} <span>${cells.length}</span></button>`).join("")}</nav>`;
  const selected = floor().cells.find((c) => c.code === state.selected);
  return `${compactToolbar()}${state.view === "map" ? mapHTML() : `${tabs}<div class="browser-layout"><section class="browser-main" aria-label="รายการแยกกลุ่ม">${listHTML({ grouped: true })}</section><aside class="browser-context" aria-label="ตำแหน่งในแผนผัง"><h3>${selected ? selected.code : "ตำแหน่งในแผนผัง"}</h3>${mapHTML(true)}${selected ? mapDetail(selected) : "<p>เลือกจุดจากรายการเพื่อดูตำแหน่งและรายละเอียด</p>"}<p class="context-hint">${selected ? dims(selected) : "แสดงรายละเอียดเฉพาะจุดที่เลือก"}</p></aside></div>`}`;
}
function syncURL() {
  const next = new URL(location.href);
  next.searchParams.set("variant", state.variant);
  next.searchParams.set("floor", state.floor);
  next.searchParams.set("view", state.view);
  if (state.search) next.searchParams.set("q", state.search);
  else next.searchParams.delete("q");
  history.replaceState(null, "", next);
}
function render({ keepFocus = false } = {}) {
  if (!floors) return;
  const focused = document.activeElement?.id === "search",
    caret = focused ? document.activeElement.selectionStart : 0;
  const scroll = $("workspace").querySelector(".list-scroll")?.scrollTop || 0;
  const pages = Math.max(1, Math.ceil(rows().length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  $("workspace").dataset.variant = state.variant;
  $("workspace").innerHTML = { A: VariantA, B: VariantB, C: VariantC }[
    state.variant
  ]();
  $("variant-select").value = state.variant;
  $("scenario").textContent =
    state.search === "PD-L1-8" ? "ดูทุกจุด" : "ลองค้นหา 1 จุด";
  $("prototype-state").textContent =
    `${state.variant} · ชั้น ${state.floor} · ${state.variant === "B" ? "แผนผัง + ผลค้นหา" : { map: "แผนผัง", list: "รายการ", split: "แสดงคู่" }[state.view]} · ${rows().length}/${floor().cells.length} จุด${state.selected ? " · " + state.selected : ""}`;
  window.__prototypeState = { ...state, count: rows().length };
  if (keepFocus && focused) {
    $("search")?.focus();
    $("search")?.setSelectionRange(caret, caret);
  }
  if (keepFocus) {
    const el = $("workspace").querySelector(".list-scroll");
    if (el) el.scrollTop = scroll;
  }
  syncURL();
}
function changeVariant(key) {
  state.variant = key;
  state.group = "all";
  state.page = 0;
  state.selected = null;
  state.finderOpen = true;
  state.view = key === "B" ? "map" : "list";
  render();
}
function cycle(dir) {
  const keys = Object.keys(names);
  changeVariant(keys[(keys.indexOf(state.variant) + dir + 3) % 3]);
}
function dialog(title, content) {
  $("options-content").innerHTML =
    `<h3 id="options-title">${title}${btn("close-dialog", "ปิด", "close")}</h3>${content}`;
  $("options-dialog").showModal();
}
function notify(text) {
  $("notice").textContent = text;
  $("notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $("notice").hidden = true;
  }, 2500);
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("button,[data-code]");
  if (!target) return;
  if (target.dataset.cycle) {
    cycle(Number(target.dataset.cycle));
    return;
  }
  if (target.dataset.view) {
    state.view = target.dataset.view;
    render();
    return;
  }
  if (target.dataset.code) {
    state.selected =
      state.selected === target.dataset.code ? null : target.dataset.code;
    render({ keepFocus: true });
    return;
  }
  if (target.dataset.locate) {
    state.selected = target.dataset.locate;
    state.view = "map";
    if (state.variant === "B") state.finderOpen = false;
    render();
    return;
  }
  if (target.dataset.group) {
    state.group = target.dataset.group;
    state.page = 0;
    render();
    return;
  }
  if (target.dataset.filter) {
    state.filter = target.dataset.filter;
    state.page = 0;
    $("options-dialog").close();
    render();
    return;
  }
  if (target.dataset.sort) {
    state.sort = target.dataset.sort;
    state.reverse = target.dataset.order === "desc";
    state.page = 0;
    $("options-dialog").close();
    render();
    return;
  }
  const action = target.dataset.action;
  if (action === "workspace-options") {
    dialog(
      `ชั้น ${state.floor}`,
      `<button class="option" data-action="add">เพิ่มจุดจัดเก็บ ${icon("plus")}</button><button class="option" data-action="edit">แก้ไขผังชั้น ${state.floor} ${icon("right")}</button><button class="option" data-action="settings">การแสดงผลแผนผัง ${icon("sliders")}</button>`,
    );
    return;
  }
  if (action === "filters") {
    dialog(
      "กรองสถานะ",
      ["all", "empty", "stored", "reserved"]
        .map(
          (s) =>
            `<button class="option" data-filter="${s}" aria-pressed="${state.filter === s}">${s === "all" ? "ทุกสถานะ" : statuses[s]}${state.filter === s ? icon("check") : ""}</button>`,
        )
        .join(""),
    );
    return;
  }
  if (action === "sort") {
    dialog(
      "เรียงรายการ",
      ["code", "units", "status"]
        .map(
          (s) =>
            `<button class="option" data-sort="${s}" data-order="asc" aria-pressed="${state.sort === s && !state.reverse}">${{ code: "รหัสจุด · น้อยไปมาก", units: "จำนวน · น้อยไปมาก", status: "สถานะ" }[s]}${state.sort === s && !state.reverse ? icon("check") : ""}</button>`,
        )
        .join("") +
        `<button class="option" data-sort="code" data-order="desc" aria-pressed="${state.sort === "code" && state.reverse}">รหัสจุด · มากไปน้อย${state.sort === "code" && state.reverse ? icon("check") : ""}</button>`,
    );
    return;
  }
  if (action === "close-dialog") {
    $("options-dialog").close();
    return;
  }
  if (action === "clear-search" || action === "clear-all") {
    state.search = "";
    state.page = 0;
    if (action === "clear-all") {
      state.filter = "all";
      state.group = "all";
    }
    render();
    $("search")?.focus();
    return;
  }
  if (action === "previous-page" || action === "next-page") {
    state.page += action === "next-page" ? 1 : -1;
    render();
    return;
  }
  if (action === "toggle-finder") {
    state.finderOpen = !state.finderOpen;
    render();
    if (state.finderOpen) $("search")?.focus();
    return;
  }
  if (action === "close-details") {
    state.selected = null;
    render();
    return;
  }
  if (action === "open-list") {
    state.view = "list";
    state.finderOpen = true;
    render();
    return;
  }
  if (action === "zoom-in" || action === "zoom-out" || action === "fit") {
    state.zoom =
      action === "fit"
        ? 1
        : Math.max(
            1,
            Math.min(2.5, state.zoom + (action === "zoom-in" ? 0.25 : -0.25)),
          );
    render();
    return;
  }
  if (["add", "edit", "settings", "building"].includes(action)) {
    $("options-dialog").close();
    notify("ตัวอย่างตำแหน่งปุ่มในดีไซน์ · ยังไม่เชื่อมการบันทึกข้อมูล");
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "search") {
    state.search = event.target.value;
    state.page = 0;
    render({ keepFocus: true });
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "variant-select") {
    changeVariant(event.target.value);
    return;
  }
  if (event.target.dataset.select === "floor") {
    state.floor = Number(event.target.value);
    state.page = 0;
    state.selected = null;
    state.group = "all";
    state.zoom = 1;
    render();
  }
  if (event.target.dataset.select === "page-size") {
    state.pageSize = Number(event.target.value);
    state.page = 0;
    render();
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.target.matches("[data-code]") &&
    ["Enter", " "].includes(event.key)
  ) {
    event.preventDefault();
    event.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return;
  }
  if (event.key === "Escape" && !$("options-dialog").open) {
    state.selected = null;
    render();
  }
  if (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target.closest("input,textarea,select,[contenteditable]") ||
    $("options-dialog").open
  )
    return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    cycle(event.key === "ArrowLeft" ? -1 : 1);
  }
});
$("scenario").onclick = () => {
  state.search = state.search === "PD-L1-8" ? "" : "PD-L1-8";
  state.floor = 2;
  state.group = "all";
  state.filter = "all";
  state.page = 0;
  state.selected = null;
  state.finderOpen = true;
  render();
};
$("theme").onclick = () => {
  const light = document.documentElement.dataset.theme !== "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  $("theme").innerHTML = icon(light ? "moon" : "sun");
};
window.addEventListener("resize", () => render({ keepFocus: true }));
if (url.searchParams.get("embedded") === "1")
  document.body.classList.add("embedded");
window.__setPrototypeScenario = (single) => {
  state.search = single ? "PD-L1-8" : "";
  state.floor = 2;
  state.group = "all";
  state.filter = "all";
  state.page = 0;
  state.selected = null;
  state.finderOpen = true;
  render();
};
if (url.searchParams.get("compare") === "mobile") {
  document.body.classList.add("comparison");
  document.body.innerHTML = `<main class="compare-shell"><header class="compare-heading"><div><h1>Storage Planner · ดีไซน์ที่ประหยัดพื้นที่</h1><p>เทียบมือถือ 3 แบบ · กดรายการ / ค้นหา / เปลี่ยนชั้นได้ในแต่ละจอ</p></div><button class="text-button" id="compare-scenario">ลองค้นหา 1 จุด</button></header><div class="phone-grid">${Object.entries(
    names,
  )
    .map(
      ([key, name]) =>
        `<section class="phone-option"><header><h2>${key} · ${name}${key === "A" ? "<span>แนะนำ</span>" : ""}</h2><p>${{ A: "toolbar กระชับ · list ไม่ยืดพื้นที่", B: "แผนผังเต็มพื้นที่ · ผลค้นหาใน dock", C: "รายการแยกกลุ่ม · แผนผังใต้แถวที่เลือก" }[key]}</p><a href="?variant=${key}&view=${key === "B" ? "map" : "list"}">เปิดแบบ ${key} ${icon("right")}</a></header><iframe title="ดีไซน์ ${key} ${name}" src="?variant=${key}&view=${key === "B" ? "map" : "list"}&embedded=1"></iframe></section>`,
    )
    .join("")}</div></main>`;
  let single = false;
  $("compare-scenario").onclick = () => {
    single = !single;
    document
      .querySelectorAll("iframe")
      .forEach((frame) => frame.contentWindow.__setPrototypeScenario(single));
    $("compare-scenario").textContent = single ? "ดูทุกจุด" : "ลองค้นหา 1 จุด";
  };
} else {
  plan = await fetch("floor-reference.json").then((r) => r.json());
  buildData();
  render();
}
