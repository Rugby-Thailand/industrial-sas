/*
 * Exercises the built React islands (dist/controls.js) together with the
 * sheet's vanilla handlers in jsdom, with regression cases for every
 * reproduced audit finding (DS-A01…DS-A21). Build first:
 *   pnpm build:design-sheet && node docs/design-sheet/evidence/check-controls.cjs
 * jsdom does not lay out, paint, print or emulate devices: geometry, print
 * rendering and screen-reader output stay browser/device checks. Color/state
 * assertions read the cascade with each var() mapped to a unique sentinel
 * color, so they prove which token wins, not the rendered pixel.
 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const { JSDOM, VirtualConsole } = require("jsdom");
const axe = require("axe-core");
const { getByRole, queryByRole } = require("@testing-library/dom");
const userEvent = require("@testing-library/user-event").default;

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const report = {
  checkedAt: new Date().toISOString(),
  gitHead: (() => {
    try {
      return execSync("git rev-parse --short HEAD", { cwd: root })
        .toString()
        .trim();
    } catch {
      return null;
    }
  })(),
  surface:
    "index.html + sheet.js + review.js + built dist/controls.js (React islands) in jsdom; CSS cascade with var() sentinels",
  notVerified: [
    "Browser layout, popup geometry and short-viewport scrolling (DS-A21 is source/attribute checked only)",
    "Rendered print output",
    "Rendered contrast and pixels",
    "Physical touch devices and coarse-pointer density",
    "Screen readers",
    "Production application",
  ],
  assertions: 0,
  findings: {},
  errors: [],
};
const check = (id, value, message) => {
  assert.ok(value, `${id}: ${message}`);
  report.assertions++;
  (report.findings[id] ??= []).push(message);
};

function create({ controls = true, css = null } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => errors.push(error.message));
  let html = read("index.html");
  if (css) html = html.replace("</head>", `<style>${css}</style></head>`);
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "http://localhost:3211/",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  w.addEventListener("error", (event) => errors.push(event.message));
  w.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  w.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  w.Element.prototype.hasPointerCapture = () => false;
  w.Element.prototype.setPointerCapture = () => {};
  w.Element.prototype.releasePointerCapture = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  w.eval(
    ["sheet.js", "review.js", ...(controls ? ["dist/controls.js"] : [])]
      .map(read)
      .join("\n"),
  );
  return {
    dom,
    w,
    doc: w.document,
    errors,
    user: userEvent.setup({ document: w.document }),
  };
}
const tick = (w, ms = 10) => new Promise((r) => w.setTimeout(r, ms));
const loaded = (w) =>
  new Promise((r) =>
    w.document.readyState === "complete"
      ? r()
      : w.addEventListener("load", () => r(), { once: true }),
  );

// Map every var(--name) to a unique rgb() so jsdom's cascade reports which
// token wins for color properties.
function sentinelCss(files) {
  const names = new Map();
  const css = files
    .map(read)
    .join("\n")
    .replace(/var\((--[\w-]+)(?:,[^()]*(?:\([^()]*\))?[^()]*)?\)/g, (_, n) => {
      if (!names.has(n)) names.set(n, names.size + 1);
      const i = names.get(n);
      return `rgb(1, ${2 + Math.floor(i / 250)}, ${i % 250})`;
    });
  const token = (value) => {
    for (const [n, i] of names)
      if (value === `rgb(1, ${2 + Math.floor(i / 250)}, ${i % 250})`) return n;
    return value;
  };
  return { css, token };
}

const visibleText = (el) => el.textContent.replace(/\s+/g, " ").trim();
const popover = (doc) => doc.querySelector(".sheet-picker-content");

(async () => {
  // ---------------------------------------------------------------- main
  const c = create();
  const { doc, w, user } = c;
  await loaded(w);
  await tick(w);
  const $ = (id) => doc.getElementById(id);
  const select = async (id, option) => {
    await user.click($(`${id}-control`) ?? $(id));
    await user.click(
      getByRole(doc.body, "option", { name: option, exact: true }),
    );
    await tick(w);
  };

  check(
    "base",
    doc.documentElement.classList.contains("sheet-controls-ready"),
    "islands mounted and marked ready",
  );
  check(
    "base",
    [...doc.querySelectorAll("select")].every(
      (el) => el.hidden || el.getAttribute("aria-hidden") === "true",
    ),
    "no exposed native selects",
  );
  check(
    "base",
    !doc.querySelector('input[type="date"],input[type="time"]'),
    "no native date/time pickers",
  );

  // DS-A01: confirming the selected date keeps it.
  const demoDate = $("demo-date");
  await user.click($("demo-date-control"));
  await tick(w);
  check(
    "DS-A01",
    doc.activeElement?.dataset.civilDate === "2026-10-14",
    "selected day receives focus on open",
  );
  await user.keyboard("{Enter}");
  await tick(w);
  check(
    "DS-A01",
    demoDate.value === "2026-10-14",
    "Enter on selected day keeps value",
  );
  check("DS-A01", !popover(doc), "Enter on selected day closes popup");
  check(
    "DS-A01",
    visibleText($("demo-date-control")) === "14 Oct 2026",
    "trigger still shows the date",
  );
  check(
    "DS-A01",
    doc.activeElement === $("demo-date-control"),
    "focus returns to trigger",
  );
  await user.click($("demo-date-control"));
  await user.click(doc.querySelector('button[data-civil-date="2026-10-14"]'));
  await tick(w);
  check(
    "DS-A01",
    demoDate.value === "2026-10-14",
    "clicking selected day keeps value",
  );

  // Base behavior retained: Radix select and draft retention.
  await select("ticket-storageFormat", "Package / box");
  check(
    "base",
    $("ticket-storageFormat").value === "BOX",
    "Radix selection updates draft",
  );
  $("tab-catalogue").click();
  $("tab-scan").click();
  check(
    "base",
    visibleText($("ticket-storageFormat-control")) === "Package / box",
    "draft retained after remount",
  );

  // DS-A01 in the scan ticket: re-confirming does not erase the draft.
  doc.querySelector(".detail-disclosure").open = true;
  const filled = () => doc.querySelector("#filled-count").textContent;
  const filledBefore = filled();
  await user.click($("ticket-deliveryDate-control"));
  await tick(w);
  await user.keyboard("{Enter}");
  await tick(w);
  check(
    "DS-A01",
    $("ticket-deliveryDate").value === "2026-10-12" &&
      filled() === filledBefore,
    "ticket delivery date survives Enter on its selected day",
  );
  await user.click($("ticket-deliveryDate-control"));
  await user.click(
    doc.querySelector('.sheet-calendar button[data-civil-date="2026-10-15"]'),
  );
  await tick(w);
  check(
    "base",
    $("ticket-deliveryDate").value === "2026-10-15",
    "calendar stores civil ISO date",
  );
  check("base", !popover(doc), "calendar closes after selection");
  await user.click($("ticket-deliveryDate-control"));
  await user.click(getByRole(doc.body, "button", { name: "Clear date" }));
  await tick(w);
  check(
    "DS-A01",
    $("ticket-deliveryDate").value === "",
    "explicit Clear date clears",
  );
  await user.click($("ticket-deliveryDate-control"));
  check(
    "DS-A01",
    !queryByRole(doc.body, "button", { name: "Clear date" }),
    "Clear date is not offered for an empty value",
  );
  await user.keyboard("{Escape}");
  await tick(w);

  // DS-A05 (behavior part) and retained Reading disabled specimens.
  await select("review-state", "Reading");
  check(
    "base",
    doc.activeElement === $("review-state-control") &&
      !doc.querySelector('[role="listbox"]'),
    "Review state selection returns focus to its trigger",
  );
  check(
    "DS-A20",
    $("ticket-storageFormat-control").disabled,
    "select disabled while reading",
  );
  check(
    "DS-A20",
    $("ticket-deliveryDate-control").disabled,
    "calendar disabled while reading",
  );
  check(
    "DS-A05",
    [
      ...doc.querySelectorAll("#ticket-form input, #ticket-form .field-scan"),
    ].every((el) => el.disabled),
    "reading disables every text input and in-field scanner",
  );
  await select("review-state", "Normal");

  // Browser follow-up: Enter must not click the freshly remounted trigger.
  let selectionEnterPrevented = false;
  const captureSelectionEnter = (event) => {
    if (event.key === "Enter") selectionEnterPrevented = event.defaultPrevented;
  };
  doc.addEventListener("keydown", captureSelectionEnter);
  await user.click($("review-state-control"));
  await tick(w);
  await user.keyboard("{ArrowDown}{Enter}");
  await tick(w);
  doc.removeEventListener("keydown", captureSelectionEnter);
  check(
    "keyboard-follow-up",
    $("review-state").value === "reading",
    "keyboard selection commits the new review state",
  );
  check(
    "keyboard-follow-up",
    selectionEnterPrevented,
    "selection consumes native Enter activation across the remount",
  );
  check(
    "keyboard-follow-up",
    !doc.querySelector('[role="listbox"]') &&
      doc.activeElement === $("review-state-control"),
    "keyboard selection closes the menu and returns focus to the new trigger",
  );
  await select("review-state", "Normal");

  // DS-A02: time is a popup draft.
  const demoTime = $("demo-time");
  await user.click($("demo-time-control"));
  await select("demo-time-control-hour", "23");
  check(
    "DS-A02",
    demoTime.value === "08:30",
    "hour choice does not commit while open",
  );
  await user.keyboard("{Escape}");
  await tick(w);
  check("DS-A02", !popover(doc), "Escape closes the time popup");
  check("DS-A02", demoTime.value === "08:30", "Escape discards the draft");
  check(
    "DS-A02",
    doc.activeElement === $("demo-time-control"),
    "Escape returns focus",
  );
  await user.click($("demo-time-control"));
  check(
    "DS-A02",
    visibleText($("demo-time-control-hour")) === "08",
    "reopening starts from the committed value",
  );
  await select("demo-time-control-hour", "23");
  await user.click($("sheet-title"));
  await tick(w);
  check(
    "DS-A02",
    !popover(doc) && demoTime.value === "08:30",
    "outside click discards the draft",
  );
  await user.click($("demo-time-control"));
  await select("demo-time-control-hour", "23");
  await select("demo-time-control-minute", "59");
  check(
    "DS-A02",
    demoTime.value === "08:30",
    "both parts still uncommitted before Done",
  );
  await user.click(
    getByRole(doc.body, "button", { name: "Done", exact: true }),
  );
  await tick(w);
  check(
    "DS-A02",
    demoTime.value === "23:59",
    "Done commits a 24-hour HH:mm value",
  );
  check(
    "DS-A02",
    visibleText($("demo-time-control")) === "23:59",
    "trigger shows committed time",
  );

  // DS-A11: empty, incomplete and clear are defined.
  const emptyTime = $("state-empty-time");
  const emptyTrigger = $("state-empty-time-control");
  check(
    "DS-A11",
    visibleText(emptyTrigger) === "Pick a time" &&
      emptyTrigger.hasAttribute("data-placeholder"),
    "empty time shows a muted placeholder, not a value",
  );
  await user.click(emptyTrigger);
  check(
    "DS-A11",
    visibleText($("state-empty-time-control-hour")) === "HH" &&
      visibleText($("state-empty-time-control-minute")) === "mm",
    "empty time opens with both parts empty",
  );
  const done = () =>
    getByRole(doc.body, "button", { name: "Done", exact: true });
  check("DS-A11", done().disabled, "Done disabled while nothing is chosen");
  check(
    "DS-A11",
    visibleText($("state-empty-time-control-status")) ===
      "Choose both hour and minute.",
    "incomplete draft explains what is missing",
  );
  await select("state-empty-time-control-minute", "45");
  check(
    "DS-A11",
    done().disabled && emptyTime.value === "",
    "minute alone cannot commit",
  );
  await select("state-empty-time-control-hour", "09");
  check("DS-A11", !done().disabled, "Done enabled once both parts are chosen");
  await user.click(done());
  await tick(w);
  check("DS-A11", emptyTime.value === "09:45", "complete draft commits HH:mm");
  await user.click(emptyTrigger);
  await user.click(getByRole(doc.body, "button", { name: "Clear time" }));
  await tick(w);
  check(
    "DS-A11",
    emptyTime.value === "",
    "explicit Clear time empties the value",
  );
  emptyTime.value = ":45";
  w.sheetControls.refresh();
  check(
    "DS-A11",
    visibleText(emptyTrigger) === "Pick a time",
    "malformed HH:mm is not shown as a time",
  );
  await user.click(emptyTrigger);
  check(
    "DS-A11",
    visibleText($("state-empty-time-control-minute")) === "mm",
    "malformed value never seeds a part",
  );
  await user.keyboard("{Escape}");
  await tick(w);
  check(
    "DS-A11",
    emptyTime.value === ":45",
    "cancel leaves the source untouched",
  );
  emptyTime.value = "";
  w.sheetControls.refresh();

  // DS-A20: state specimens.
  const pendingSelect = $("state-pending-select-control");
  check(
    "DS-A20",
    pendingSelect.getAttribute("aria-busy") === "true" &&
      pendingSelect.getAttribute("aria-disabled") === "true" &&
      !pendingSelect.disabled,
    "pending select is busy, focusable and not disabled",
  );
  await user.click(pendingSelect);
  await tick(w);
  check(
    "DS-A20",
    !doc.querySelector('[role="listbox"]'),
    "pending select does not open",
  );
  pendingSelect.focus();
  await user.keyboard("o");
  await tick(w);
  check(
    "DS-A20",
    $("state-pending-select").value === "BOX",
    "typeahead cannot change a pending select",
  );
  const pendingDate = $("state-pending-date-control");
  await user.click(pendingDate);
  await tick(w);
  check(
    "DS-A20",
    !popover(doc) && pendingDate.getAttribute("aria-busy") === "true",
    "pending date stays closed and busy",
  );
  check(
    "DS-A20",
    pendingDate.getAttribute("aria-describedby") === "state-pending-date-hint",
    "pending field points at its visible status",
  );
  const readonlyDate = $("state-readonly-date-control");
  check(
    "DS-A20",
    readonlyDate.tagName === "INPUT" &&
      readonlyDate.readOnly &&
      readonlyDate.value === "9 Oct 2026",
    "read-only date is a legible read-only text box",
  );
  check(
    "DS-A20",
    $("state-readonly-text").readOnly,
    "read-only text field exists",
  );
  check(
    "DS-A20",
    $("state-disabled-select-control").disabled &&
      $("state-disabled-time-control").disabled,
    "disabled select and time specimens",
  );
  const invalidDate = $("state-invalid-date-control");
  check(
    "DS-A20",
    invalidDate.getAttribute("aria-invalid") === "true" &&
      invalidDate.getAttribute("aria-describedby") ===
        "state-invalid-date-error" &&
      visibleText($("state-invalid-date-error")) ===
        "Choose a date before saving.",
    "invalid date is associated with its recovery text",
  );
  await user.click(invalidDate);
  check(
    "DS-A20",
    !queryByRole(doc.body, "button", { name: "Clear date" }),
    "a required date offers no Clear action",
  );
  await user.click(
    doc.querySelector('.sheet-calendar button[data-civil-date="2026-10-14"]'),
  );
  await tick(w);
  check(
    "DS-A20",
    $("state-invalid-date").value === "2026-10-14" &&
      $("state-invalid-date-control").getAttribute("aria-invalid") === null &&
      visibleText($("state-invalid-date-error")) === "",
    "choosing a date clears the error",
  );
  await user.click($("state-invalid-time-control"));
  await select("state-invalid-time-control-hour", "07");
  await select("state-invalid-time-control-minute", "05");
  await user.click(done());
  await tick(w);
  check(
    "DS-A20",
    $("state-invalid-time").value === "07:05" &&
      visibleText($("state-invalid-time-error")) === "",
    "completing the time clears its error",
  );
  await user.click($("state-bounded-date-control"));
  await tick(w);
  const day = (iso) =>
    doc.querySelector(`.sheet-calendar button[data-civil-date="${iso}"]`);
  check(
    "DS-A20",
    day("2026-10-04").disabled &&
      day("2026-10-24").disabled &&
      !day("2026-10-05").disabled &&
      !day("2026-10-23").disabled,
    "example range disables days outside 5–23 Oct only",
  );
  check(
    "DS-A20",
    [...doc.querySelectorAll(".rdp-button_previous, .rdp-button_next")].every(
      (b) => b.getAttribute("aria-disabled") === "true",
    ),
    "month navigation stays within the example range",
  );
  await user.click(day("2026-10-24"));
  await tick(w);
  check(
    "DS-A20",
    $("state-bounded-date").value === "2026-10-14",
    "out-of-range day cannot be chosen",
  );
  // DS-A21: the popup receives Radix's available height and scrolls.
  check(
    "DS-A21",
    /--radix-popover-content-available-height/.test(
      popover(doc).parentElement.getAttribute("style") +
        popover(doc).getAttribute("style"),
    ),
    "Radix supplies the available-height variable to the popup",
  );
  await user.keyboard("{Escape}");
  await tick(w);

  // DS-A03 (English half): en-GB names, Monday first.
  await user.click($("demo-date-control"));
  await tick(w);
  check(
    "DS-A03",
    doc.querySelector(".rdp-weekday")?.getAttribute("aria-label") === "Monday",
    "English week starts on Monday",
  );
  check(
    "DS-A03",
    /14 October 2026/.test(day("2026-10-14").getAttribute("aria-label")),
    "English day name uses en-GB order",
  );
  await user.keyboard("{Escape}");
  await tick(w);
  // Controls with popups open: structural axe in English.
  const structuralRules = [
    "button-name",
    "label",
    "select-name",
    "aria-valid-attr",
    "aria-valid-attr-value",
    "aria-required-attr",
    "aria-allowed-attr",
    "aria-allowed-role",
    "aria-prohibited-attr",
    "aria-input-field-name",
    "aria-toggle-field-name",
    "duplicate-id-aria",
    "nested-interactive",
  ];
  w.eval(axe.source);
  const integrity = (where) => {
    const ids = [...doc.querySelectorAll("[id]")].map((e) => e.id);
    check("DS-A19", new Set(ids).size === ids.length, `${where}: unique IDs`);
    const refs = [
      ...doc.querySelectorAll(
        "[aria-labelledby],[aria-describedby],[aria-controls]",
      ),
    ].flatMap((el) =>
      ["aria-labelledby", "aria-describedby", "aria-controls"].flatMap((a) =>
        (el.getAttribute(a) || "").split(/\s+/).filter(Boolean),
      ),
    );
    check(
      "DS-A19",
      refs.every((id) => $(id)),
      `${where}: ARIA references resolve`,
    );
    check(
      "DS-A19",
      [...doc.querySelectorAll("label[for]")].every((l) => $(l.htmlFor)),
      `${where}: labels point at mounted controls`,
    );
  };
  const runAxe = async (where) => {
    const result = await w.axe.run(doc, {
      runOnly: { type: "rule", values: structuralRules },
    });
    check(
      "DS-A19",
      result.violations.length === 0,
      `${where}: structural axe on mounted controls ${JSON.stringify(result.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]))}`,
    );
    integrity(where);
  };
  await runAxe("en closed");
  await user.click($("demo-date-control"));
  await runAxe("en date open");
  await user.keyboard("{Escape}");
  await user.click($("demo-time-control"));
  await runAxe("en time open");
  await user.click($("demo-time-control-hour"));
  await runAxe("en time hour listbox open");
  await user.keyboard("{Escape}");
  await user.keyboard("{Escape}");
  await tick(w);

  // DS-A07 (behavior part): Radix exposes separate highlight and checked state.
  await user.click($("ticket-storageFormat-control"));
  await user.keyboard("{ArrowDown}");
  await tick(w);
  const checkedItem = doc.querySelector(
    '[data-slot="select-item"][data-state="checked"]',
  );
  const highlighted = doc.querySelector(
    '[data-slot="select-item"][data-highlighted]',
  );
  check(
    "DS-A07",
    checkedItem &&
      highlighted &&
      checkedItem !== highlighted &&
      !checkedItem.hasAttribute("data-highlighted"),
    "moving focus separates highlighted from checked",
  );
  await user.keyboard("{Escape}");
  await tick(w);

  // DS-A13: a valid Job No. stays valid across locales.
  await user.type($("demo-required"), "JOB-1");
  check(
    "DS-A13",
    visibleText($("required-error")) === "",
    "typing clears the error",
  );

  // DS-A15: names contain visible labels; theme name is stable.
  const languageButton = $("language-toggle");
  check(
    "DS-A15",
    languageButton
      .getAttribute("aria-label")
      .startsWith(visibleText($("language-label"))),
    "language button name starts with its visible label (English)",
  );
  const themeButton = $("theme-toggle");
  const themeName = themeButton.getAttribute("aria-label");
  themeButton.click();
  check(
    "DS-A15",
    themeButton.getAttribute("aria-label") === themeName &&
      themeButton.getAttribute("aria-pressed") === "true" &&
      themeName === "Dark mode",
    "theme toggle keeps one name while aria-pressed reports state",
  );

  // DS-A08: printing from dark mode uses the light presentation and readout.
  check(
    "DS-A08",
    doc.documentElement.classList.contains("dark"),
    "dark mode before print",
  );
  const darkCanvas = $("canvas-value").textContent;
  w.dispatchEvent(new w.Event("beforeprint"));
  check(
    "DS-A08",
    !doc.documentElement.classList.contains("dark") &&
      $("canvas-value").textContent === "oklch(0.985 0 0)",
    "beforeprint switches to the light palette and readout",
  );
  w.dispatchEvent(new w.Event("afterprint"));
  check(
    "DS-A08",
    doc.documentElement.classList.contains("dark") &&
      $("canvas-value").textContent === darkCanvas &&
      themeButton.getAttribute("aria-pressed") === "true",
    "afterprint restores dark mode",
  );

  // Locale switch.
  languageButton.click();
  await tick(w);
  check(
    "DS-A13",
    $("demo-required").value === "JOB-1",
    "value kept across locale",
  );
  check(
    "DS-A13",
    visibleText($("required-error")) === "" &&
      $("demo-required").getAttribute("aria-invalid") === "false",
    "valid field shows no error after switching to Thai",
  );
  await user.clear($("demo-required"));
  check(
    "DS-A13",
    visibleText($("required-error")) === "กรอกเลขที่ Job ก่อนบันทึก",
    "empty field shows the Thai error",
  );
  check(
    "DS-A15",
    languageButton
      .getAttribute("aria-label")
      .startsWith(visibleText($("language-label"))) &&
      $("language-label").lang === "en",
    "language button name starts with its visible label (Thai)",
  );
  check(
    "DS-A16",
    doc.querySelector(".wordmark").getAttribute("aria-label") ===
      "Storage Planner แผ่นออกแบบ",
    "Thai wordmark name",
  );
  check(
    "DS-A16",
    doc.querySelector(".sheet-nav").getAttribute("aria-label") ===
      "ส่วนต่าง ๆ ของแผ่นออกแบบ",
    "Thai section navigation name",
  );
  check(
    "DS-A16",
    doc.querySelector(".specimen-tabs").getAttribute("aria-label") ===
      "ตัวอย่างขั้นตอนงาน",
    "Thai tablist name",
  );
  check(
    "DS-A16",
    visibleText($("proposal-date")) === "9 ตุลาคม 2569",
    "Thai proposal date uses the Buddhist year",
  );
  check(
    "DS-A16",
    $("demo-saving").tagName === "BUTTON" &&
      !$("demo-saving").hasAttribute("aria-label") &&
      $("demo-saving").getAttribute("aria-busy") === "true" &&
      visibleText($("demo-saving")) === "กำลังบันทึก…",
    "saving specimen is a busy button named by its localized text",
  );
  check(
    "DS-A15",
    themeButton.getAttribute("aria-label") === "โหมดมืด",
    "Thai theme name is stable",
  );

  // DS-A03 (Thai half): visible and accessible years agree.
  check(
    "DS-A03",
    visibleText($("demo-date-control")) === "14 ต.ค. 2569",
    "Thai trigger shows Buddhist year",
  );
  check(
    "DS-A03",
    /2569/.test($("demo-date-control").getAttribute("aria-label")),
    "Thai trigger name uses Buddhist year",
  );
  check(
    "DS-A03",
    demoDate.value === "2026-10-14",
    "locale keeps canonical Gregorian value",
  );
  await user.click($("demo-date-control"));
  await tick(w);
  const caption = visibleText(doc.querySelector(".rdp-caption_label"));
  const grid = doc
    .querySelector('.sheet-calendar [role="grid"]')
    .getAttribute("aria-label");
  const selectedName = day("2026-10-14").getAttribute("aria-label");
  report.thaiCalendar = { caption, grid, selectedName };
  check("DS-A03", caption === "ตุลาคม 2569", "Thai caption uses Buddhist year");
  check("DS-A03", grid === "ตุลาคม 2569", "Thai grid name uses Buddhist year");
  check(
    "DS-A03",
    /2569/.test(selectedName) && !/2026/.test(selectedName),
    "Thai day name uses Buddhist year only",
  );
  check(
    "DS-A03",
    ![...doc.querySelectorAll(".sheet-calendar *")].some((el) =>
      /[๐-๙]/.test(el.textContent + (el.getAttribute("aria-label") ?? "")),
    ),
    "Thai calendar uses Latin digits",
  );
  check(
    "DS-A03",
    /จันทร์/.test(doc.querySelector(".rdp-weekday").getAttribute("aria-label")),
    "Thai week starts on Monday",
  );
  check(
    "DS-A03",
    /ไปเดือน/.test(
      doc.querySelector(".rdp-button_previous").getAttribute("aria-label"),
    ),
    "Thai navigation names",
  );
  await runAxe("th date open");
  await user.click(day("2026-10-15"));
  await tick(w);
  check(
    "DS-A03",
    demoDate.value === "2026-10-15",
    "Thai selection stores the Gregorian civil date",
  );
  check(
    "DS-A20",
    $("state-readonly-date-control").value === "9 ต.ค. 2569",
    "Thai read-only date",
  );
  check(
    "base",
    visibleText($("demo-time-control")) === "23:59",
    "time retained on locale change",
  );
  await user.click($("demo-time-control"));
  check(
    "base",
    getByRole(doc.body, "button", { name: "เสร็จ" }) &&
      visibleText(doc.querySelector('label[for="demo-time-control-hour"]')) ===
        "ชั่วโมง",
    "Thai time popup labels",
  );
  await runAxe("th time open");
  await user.keyboard("{Escape}");
  await tick(w);
  check(
    "base",
    doc.activeElement === $("demo-time-control"),
    "Escape returns focus after locale change",
  );
  check(
    "base",
    doc.querySelectorAll('[id="demo-date-control"]').length === 1,
    "no duplicate roots on language remount",
  );
  languageButton.click();
  themeButton.click();
  await tick(w);

  // DS-A04/A15/A17 behavior: catalogue toggles, chip name, loading strip.
  $("tab-catalogue").click();
  const views = () => [...doc.querySelectorAll("[data-catalogue-view]")];
  check(
    "DS-A04",
    views().every((b) => b.className === "btn outline") &&
      views()
        .map((b) => b.getAttribute("aria-pressed"))
        .join() === "true,false",
    "view switch uses a styled class with aria-pressed",
  );
  $("review-filter").click();
  const chip = $("clear-catalogue-filter");
  check(
    "DS-A15",
    chip.getAttribute("aria-label") === `Remove filter: ${visibleText(chip)}`,
    "filter chip name contains its visible label",
  );
  $("review-filter").click();
  const reviewState = $("review-state");
  reviewState.value = "loading";
  reviewState.dispatchEvent(new w.Event("change", { bubbles: true }));
  const strip = doc.querySelector(".stat-strip");
  check(
    "DS-A17",
    strip.getAttribute("aria-busy") === "true",
    "loading totals are marked busy",
  );
  check(
    "DS-A17",
    [...strip.querySelectorAll("dd")].every(
      (dd) =>
        dd.querySelector('[aria-hidden="true"]').textContent === "…" &&
        dd.querySelector(".sr-only").textContent === "Loading",
    ),
    "each loading total has a text equivalent",
  );

  // DS-A06: HR pending is busy, not disabled, and blocks repeats.
  $("tab-hr").click();
  $("review-state").value = "pending";
  $("review-state").dispatchEvent(new w.Event("change", { bubbles: true }));
  const clockOut = $("sample-clock-out");
  check(
    "DS-A06",
    !clockOut.disabled &&
      clockOut.getAttribute("aria-busy") === "true" &&
      clockOut.getAttribute("aria-disabled") === "true",
    "pending clock-out is busy and aria-disabled, not disabled",
  );
  clockOut.click();
  check(
    "DS-A06",
    $("sample-clock-out") &&
      /Saving/.test(visibleText($("sample-clock-out"))) &&
      !doc.querySelector("#workflow-panel .badge.success"),
    "activating a pending action does nothing",
  );
  check(
    "base",
    c.errors.length === 0,
    `no runtime errors (interaction run) ${c.errors.join("; ")}`.trim(),
  );
  c.dom.window.close();

  // ------------------------------------------------- cascade (var sentinels)
  const { css, token } = sentinelCss([
    "tokens.css",
    "styles.css",
    "review.css",
    "dist/controls.css",
  ]);
  const s = create({ css });
  await loaded(s.w);
  await tick(s.w);
  const sd = s.doc;
  const cs = (el, prop) => s.w.getComputedStyle(el).getPropertyValue(prop);
  const tok = (el, prop) => token(cs(el, prop));
  const state = (value) => {
    const e = sd.getElementById("review-state");
    e.value = value;
    e.dispatchEvent(new s.w.Event("change", { bubbles: true }));
  };
  // DS-A04 pressed vs unpressed.
  const capture = [...sd.querySelectorAll("[data-capture]")];
  const pressed = capture.find(
    (b) => b.getAttribute("aria-pressed") === "true",
  );
  const unpressed = capture.find(
    (b) => b.getAttribute("aria-pressed") === "false",
  );
  check(
    "DS-A04",
    tok(pressed, "background-color") === "--token-accent-surface" &&
      tok(unpressed, "background-color") === "--token-surface",
    "pressed capture method has a selected surface",
  );
  check(
    "DS-A04",
    tok(pressed, "color") === "--token-link" &&
      tok(pressed, "border-top-color") === "--token-link" &&
      tok(unpressed, "color") === "--token-text",
    "pressed capture method has link ink and edge",
  );
  sd.getElementById("tab-catalogue").click();
  const [products, units] = sd.querySelectorAll("[data-catalogue-view]");
  check(
    "DS-A04",
    tok(products, "background-color") === "--token-accent-surface" &&
      tok(units, "background-color") === "--token-surface",
    "selected catalogue view is visible",
  );
  sd.getElementById("review-filter").click();
  check(
    "DS-A04",
    tok(sd.getElementById("review-filter"), "background-color") ===
      "--token-accent-surface",
    "pressed Filters is visible",
  );
  // DS-A05 Reading lock.
  sd.getElementById("tab-scan").click();
  state("reading");
  const lockedInput = sd.getElementById("ticket-factoryOrder");
  const scanner = sd.querySelector(".field-scan");
  check(
    "DS-A05",
    tok(lockedInput, "background-color") === "--token-disabled-surface" &&
      tok(lockedInput, "color") === "--token-disabled" &&
      tok(lockedInput, "border-top-color") === "--token-border",
    "disabled text input uses the disabled surface, ink and edge",
  );
  check(
    "DS-A05",
    tok(
      sd.getElementById("ticket-storageFormat-control"),
      "background-color",
    ) === "--token-disabled-surface",
    "neighboring select uses the same disabled surface",
  );
  check(
    "DS-A05",
    ["transparent", "rgba(0, 0, 0, 0)"].includes(
      cs(scanner, "background-color"),
    ) && tok(scanner, "color") === "--token-disabled",
    "disabled in-field scanner gains no fill",
  );
  state("normal");
  // DS-A20 read-only vs disabled vs pending appearance.
  const roText = sd.getElementById("state-readonly-text");
  check(
    "DS-A20",
    ["transparent", "rgba(0, 0, 0, 0)"].includes(
      cs(roText, "background-color"),
    ) && tok(roText, "border-top-color") === "--token-border",
    "read-only text is transparent with a quiet edge",
  );
  const pendingTrigger = sd.getElementById("state-pending-select-control");
  check(
    "DS-A06",
    tok(pendingTrigger, "background-color") === "--token-surface" &&
      cs(pendingTrigger, "cursor") === "progress",
    "pending field keeps its resting surface",
  );
  check(
    "DS-A20",
    tok(sd.getElementById("state-invalid-date-control"), "border-top-color") ===
      "--token-danger",
    "invalid picker has the danger edge",
  );
  check(
    "DS-A09",
    tok(sd.getElementById("state-empty-time-control"), "color") ===
      "--token-muted",
    "empty picker placeholder uses muted ink",
  );
  // DS-A06 HR pending appearance.
  sd.getElementById("tab-hr").click();
  state("pending");
  check(
    "DS-A06",
    tok(sd.getElementById("sample-clock-out"), "background-color") ===
      "--token-accent",
    "pending primary action keeps the primary surface",
  );
  // DS-A07 item states (attributes as produced by Radix, checked above).
  const item = (attrs) => {
    const el = sd.createElement("div");
    el.dataset.slot = "select-item";
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    sd.body.append(el);
    return el;
  };
  const onlyChecked = item({ "data-state": "checked" });
  const onlyHighlighted = item({ "data-highlighted": "" });
  check(
    "DS-A07",
    ["transparent", "rgba(0, 0, 0, 0)", ""].includes(
      cs(onlyChecked, "background-color"),
    ) && cs(onlyChecked, "font-weight") === "600",
    "checked option: weight and check, no fill",
  );
  check(
    "DS-A07",
    tok(onlyHighlighted, "background-color") === "--accent",
    "highlighted option: fill",
  );
  // DS-A12 calendar normalization.
  sd.getElementById("tab-scan").click();
  const demo = sd.getElementById("demo-date-control");
  demo.dispatchEvent(new s.w.MouseEvent("click", { bubbles: true }));
  await tick(s.w);
  const selectedDay = sd.querySelector(".rdp-selected .rdp-day_button");
  const plainDay = sd.querySelector('button[data-civil-date="2026-10-20"]');
  check(
    "DS-A12",
    selectedDay &&
      cs(selectedDay, "font-size") === cs(plainDay, "font-size") &&
      cs(selectedDay, "font-weight") === cs(plainDay, "font-weight"),
    "selected numeral matches other days",
  );
  const chevron = sd.querySelector(".rdp-chevron");
  check(
    "DS-A12",
    chevron.getAttribute("fill") === "none" &&
      chevron.matches(".sheet-calendar .rdp-chevron") &&
      /\.sheet-calendar \.rdp-chevron\s*\{[^}]*fill:\s*none/.test(
        read("controls.css"),
      ) &&
      ["none", "rgba(0, 0, 0, 0)"].includes(cs(chevron, "fill")),
    "navigation chevrons are unfilled outlines",
  );
  check(
    "DS-A12",
    ["", "1"].includes(cs(sd.querySelector(".rdp-weekday"), "opacity")) &&
      tok(sd.querySelector(".rdp-weekday"), "color") === "--token-muted",
    "weekdays use muted ink at full opacity",
  );
  check(
    "base",
    s.errors.length === 0,
    `no runtime errors (cascade run) ${s.errors.join("; ")}`.trim(),
  );
  s.dom.window.close();

  // ------------------------------------------------- script failure (DS-A14)
  const f = create({ controls: false, css: read("review.css") });
  check(
    "DS-A14",
    f.doc.documentElement.classList.contains("sheet-controls-pending") &&
      f.w.getComputedStyle(f.doc.getElementById("demo-date")).visibility ===
        "hidden",
    "sources keep their space but are not shown while the bundle loads",
  );
  await loaded(f.w);
  await tick(f.w);
  const fallback = f.doc.getElementById("controls-fallback");
  check(
    "DS-A14",
    f.doc.documentElement.classList.contains("sheet-controls-failed") &&
      !fallback.hidden &&
      /did not load/.test(fallback.textContent),
    "a failed bundle shows a labelled fallback notice",
  );
  check(
    "DS-A14",
    ["demo-date", "demo-time", "review-state"].every((id) => {
      const source = f.doc.getElementById(id);
      const replacement = f.doc.getElementById(`${id}-fallback`);
      const st = f.w.getComputedStyle(replacement);
      return (
        source.hidden &&
        replacement.readOnly &&
        replacement.labels.length > 0 &&
        st.display !== "none" &&
        st.visibility !== "hidden"
      );
    }),
    "failed controls retain labelled read-only values without native pickers",
  );
  check(
    "DS-A14",
    f.doc.getElementById("demo-date-fallback").value === "2026-10-14" &&
      f.doc.getElementById("demo-time-fallback").value === "08:30",
    "failure fallback retains the committed values",
  );
  f.doc.getElementById("language-toggle").click();
  f.doc.getElementById("tab-catalogue").click();
  check(
    "DS-A14",
    [...f.doc.querySelectorAll("select")].every((el) => el.hidden) &&
      f.doc.getElementById("sample-page-size-fallback").readOnly,
    "locale and workflow changes do not expose native selects after failure",
  );
  check(
    "DS-A14",
    f.doc.getElementById("review-state-fallback").value ===
      f.doc.getElementById("review-state").selectedOptions[0].text &&
      !fallback.textContent.includes("did not load"),
    "failure values and notice follow the selected locale",
  );
  check(
    "DS-A14",
    f.errors.length === 0,
    `sheet scripts run without errors when the bundle is missing ${f.errors.join("; ")}`.trim(),
  );
  f.dom.window.close();

  // ------------------------------------------------------------ source/build
  const dist = fs.readdirSync(path.join(root, "dist")).sort();
  check(
    "DS-A18",
    JSON.stringify(dist) === '["controls.css","controls.js"]',
    `dist holds only the islands (${dist})`,
  );
  check(
    "DS-A18",
    /publicDir:\s*false/.test(read("vite.config.mjs")),
    "Vite publicDir disabled",
  );
  const distCss = read("dist/controls.css");
  const distJs = read("dist/controls.js");
  const islandSources = [
    "controls.tsx",
    ...fs
      .readdirSync(path.join(root, "ui"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `ui/${f}`),
  ];
  check(
    "DS-A09",
    islandSources.every((f) => !/from\s+["']@\//.test(read(f))),
    "islands import no application source",
  );
  check(
    "DS-A09",
    islandSources.every(
      (f) =>
        !/className=(?:\{?["'`][^"'`]*(?:\b(?:px|py|bg|text|min-h|rounded|size)-|[a-z-]+:[a-z]))/.test(
          read(f),
        ),
    ),
    "no Tailwind utility class contracts in island sources",
  );
  check(
    "DS-A09",
    !/--tw-|dense:|data-placeholder:text-muted|focus:bg-selected|aria-invalid:border/.test(
      distCss + distJs,
    ),
    "bundle carries no Tailwind contracts",
  );
  check(
    "DS-A12",
    !/font-size:\s*large|--rdp-accent-color/.test(distCss),
    "react-day-picker default stylesheet not bundled",
  );
  check(
    "DS-A21",
    /\.sheet-picker-content\s*\{[^}]*--radix-popover-content-available-height[^}]*overflow-y:\s*auto/s.test(
      read("controls.css"),
    ),
    "picker popups cap height to available space and scroll",
  );

  // DS-A08: every dark-mode variable the sheet uses is reset for print.
  const sheetCss = ["tokens.css", "styles.css", "review.css", "controls.css"];
  const cssom = new JSDOM(`<style>${sheetCss.map(read).join("\n")}</style>`)
    .window.document.styleSheets[0];
  const decl = { root: new Map(), dark: new Map(), print: new Set() };
  const printSelectors = new Set();
  const darkSelectors = [];
  for (const rule of cssom.cssRules) {
    if (rule.media?.mediaText === "print") {
      for (const r of rule.cssRules) {
        if (!r.selectorText) continue;
        r.selectorText
          .split(",")
          .forEach((sel) => printSelectors.add(sel.trim()));
        if (
          /:root|\.dark/.test(r.selectorText) &&
          !/\s/.test(r.selectorText.replace(/,\s*/g, ","))
        )
          for (let i = 0; i < r.style.length; i++) decl.print.add(r.style[i]);
      }
      continue;
    }
    if (!rule.selectorText || rule.media) continue;
    for (const sel of rule.selectorText.split(",").map((x) => x.trim())) {
      if (sel === ":root" || sel === ".dark")
        for (let i = 0; i < rule.style.length; i++)
          decl[sel === ":root" ? "root" : "dark"].set(
            rule.style[i],
            rule.style.getPropertyValue(rule.style[i]).trim(),
          );
      else if (sel.startsWith(".dark ")) darkSelectors.push(sel);
    }
  }
  const used = new Set();
  for (const f of ["styles.css", "review.css", "controls.css"])
    for (const m of read(f).matchAll(/var\((--[\w-]+)/g)) used.add(m[1]);
  const unresolved = [];
  const resolve = (name, seen = new Set()) => {
    if (seen.has(name)) return;
    seen.add(name);
    if (decl.print.has(name)) return;
    if (decl.dark.has(name) && decl.dark.get(name) !== decl.root.get(name))
      unresolved.push(name);
    for (const m of (decl.root.get(name) ?? "").matchAll(/var\((--[\w-]+)/g))
      resolve(m[1], seen);
  };
  used.forEach((name) => resolve(name));
  check(
    "DS-A08",
    unresolved.length === 0,
    `dark-only variables reset for print (${unresolved})`,
  );
  check(
    "DS-A08",
    darkSelectors.every((sel) => printSelectors.has(sel)),
    `dark-only rules overridden in print (${darkSelectors.filter((sel) => !printSelectors.has(sel))})`,
  );
  check(
    "DS-A10",
    /## Preview and application differences/.test(read("DESIGN.md")),
    "DESIGN.md lists intentional preview/application differences",
  );

  report.passed = true;
  fs.writeFileSync(
    path.join(root, "evidence/controls-checks.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        assertions: report.assertions,
        findings: Object.fromEntries(
          Object.entries(report.findings).map(([k, v]) => [k, v.length]),
        ),
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
