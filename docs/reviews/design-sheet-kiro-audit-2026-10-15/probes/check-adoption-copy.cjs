/* Copy of evidence/check-adoption.cjs with output redirected to this directory. */
/* Source/DOM checks for the standalone sheet. This does not run a browser. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { JSDOM, VirtualConsole } = require("jsdom");
const axe = require("axe-core");
const root = path.resolve(__dirname, "../../../design-sheet");
const report = {
  date: "2026-10-11",
  checkedAt: new Date().toISOString(),
  scope: "Original standalone sheet adoption revision",
  sourceBaseline: "733c6aca",
  approvedComposition: "8b0ef538",
  method:
    "jsdom local DOM/events; selected axe structural rules; source checks; hex contrast arithmetic",
  checks: 0,
  stateCombinations: 0,
  structuralAxeRuns: 0,
  unverified: [
    "Browser layout/overflow",
    "Computed pointer density",
    "Browser color contrast/axe",
    "Physical devices/camera",
    "Screen reader",
    "Application build/production CSS",
    "Deployed state",
  ],
};
function check(condition, message) {
  assert.ok(condition, message);
  report.checks++;
}
function create(lang, dark) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (err) => errors.push(err.message));
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "index.html"), "utf8"),
    {
      runScripts: "outside-only",
      url: "http://localhost:3211/",
      virtualConsole: vc,
      pretendToBeVisual: true,
    },
  );
  dom.window.addEventListener("error", (e) => errors.push(e.message));
  dom.window.eval(
    fs.readFileSync(path.join(root, "sheet.js"), "utf8") +
      "\n" +
      fs.readFileSync(path.join(root, "review.js"), "utf8"),
  );
  if (lang === "th")
    dom.window.document.querySelector("#language-toggle").click();
  if (dark) dom.window.document.querySelector("#theme-toggle").click();
  return { dom, w: dom.window, doc: dom.window.document, errors };
}
const click = (c, selector) => {
  check(c.doc.querySelector(selector), `missing ${selector}`);
  c.doc.querySelector(selector).click();
};
const input = (c, selector, value) => {
  const e = c.doc.querySelector(selector);
  e.value = value;
  e.dispatchEvent(new c.w.Event("input", { bubbles: true }));
};
const state = (c, value) => {
  const e = c.doc.querySelector("#review-state");
  e.value = value;
  e.dispatchEvent(new c.w.Event("change", { bubbles: true }));
};
const tab = (c, name) => click(c, `[data-screen="${name}"]`);
function integrity(c) {
  const ids = [...c.doc.querySelectorAll("[id]")].map((e) => e.id);
  check(new Set(ids).size === ids.length, "duplicate IDs");
  for (const el of c.doc.querySelectorAll(
    "[aria-labelledby], [aria-describedby]",
  )) {
    for (const attr of ["aria-labelledby", "aria-describedby"])
      for (const id of (el.getAttribute(attr) || "")
        .split(/\s+/)
        .filter(Boolean))
        check(c.doc.getElementById(id), `missing ${attr} ${id}`);
  }
  for (const el of c.doc.querySelectorAll("input,select"))
    check(
      el.getAttribute("aria-label") ||
        c.doc.querySelector(`label[for="${el.id}"]`),
      `unlabelled ${el.id}`,
    );
  check(c.errors.length === 0, c.errors.join("\n"));
}
function linear(hex) {
  return hex
    .match(/[a-f\d]{2}/gi)
    .map((n) => parseInt(n, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
}
function luminance(hex) {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const a = luminance(fg),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
(async () => {
  const structuralRules = [
    "button-name",
    "label",
    "select-name",
    "aria-valid-attr",
    "aria-valid-attr-value",
    "aria-required-attr",
    "aria-allowed-attr",
    "aria-allowed-role",
    "aria-input-field-name",
    "duplicate-id-aria",
  ];
  report.structuralAxeRules = structuralRules;
  for (const lang of ["en", "th"])
    for (const dark of [false, true]) {
      const c = create(lang, dark);
      check(c.doc.documentElement.lang === lang, "locale");
      check(c.doc.documentElement.classList.contains("dark") === dark, "theme");
      for (const name of ["scan", "catalogue", "floor", "hr"]) {
        tab(c, name);
        const modes = [...c.doc.querySelector("#review-state").options].map(
          (e) => e.value,
        );
        for (const mode of modes) {
          state(c, mode);
          report.stateCombinations++;
          integrity(c);
          const panel = c.doc.querySelector("#workflow-panel");
          if (name === "scan") {
            if (mode === "viewOnly")
              check(
                !panel.querySelector("form, input, select"),
                "scan view-only replaces flow",
              );
            else {
              check(
                panel.querySelector("#remove-ticket"),
                "single-ticket remove",
              );
              check(
                panel.querySelectorAll(".field-scan").length === 2,
                "identity scanners",
              );
              check(
                panel.querySelector("#ticket-storageFormat").value === "PALLET",
                "unit type",
              );
              check(
                /7/.test(panel.querySelector("#filled-count").textContent),
                "actual filled count",
              );
              check(
                panel.querySelector("#scan-save").disabled ===
                  (mode === "reading"),
                "reading disabled save",
              );
            }
          }
          if (name === "catalogue") {
            const values = [...panel.querySelectorAll(".stat-strip dd")].map(
              (e) => e.textContent,
            );
            if (mode === "unavailable")
              check(
                values.every((v) => /Unavailable|ไม่พร้อม/.test(v)),
                "unavailable totals",
              );
            else if (mode === "loading")
              check(
                values.every((v) => v === "…"),
                "loading totals",
              );
            else
              check(
                values[0] === "128" && values.at(-1) === "342",
                "warehouse counts independent of three rows",
              );
            const statuses = [
              ...panel.querySelectorAll("#product-rows .badge"),
            ].map((e) => e.textContent);
            check(
              statuses.every((v) => /Ready|Draft|พร้อม|ฉบับร่าง/.test(v)),
              "product statuses only",
            );
            if (mode === "viewOnly")
              check(
                !panel.querySelector('[data-demo="createNotice"]'),
                "catalogue write action hidden",
              );
          }
          if (name === "floor") {
            check(
              panel.querySelectorAll("[data-zone]").length === 3,
              "all zones selectable",
            );
            if (mode === "unknown")
              check(
                /Unavailable|ไม่พร้อม/.test(
                  panel.querySelector(".floor-inspector").textContent,
                ),
                "unknown inventory not zero",
              );
          }
          if (name === "hr") {
            if (mode === "unlinked")
              check(
                !panel.querySelector("#sample-clock-out"),
                "unlinked no clock action",
              );
            else {
              check(panel.querySelector(".badge.accent"), "clocked-in accent");
              check(
                panel.querySelector(".unrecorded").textContent === "--:--",
                "unrecorded actual",
              );
              if (lang === "th")
                check(
                  panel.querySelector("h3").textContent.includes("2569"),
                  "Thai Buddhist business date",
                );
            }
            if (mode === "pending")
              check(
                panel.querySelector("#sample-clock-out").disabled,
                "pending clock locked",
              );
            if (mode === "uncertain")
              check(
                panel.querySelector("#safe-clock-retry") &&
                  !panel.querySelector("#sample-clock-out"),
                "uncertain safe retry only",
              );
            if (mode === "denied")
              check(
                !panel.querySelector("#sample-clock-out"),
                "denied no clock action",
              );
          }
        }
        state(c, "normal");
        c.w.eval(axe.source);
        const result = await c.w.axe.run(c.doc, {
          runOnly: { type: "rule", values: structuralRules },
        });
        check(
          result.violations.length === 0,
          JSON.stringify(
            result.violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => n.target),
            })),
          ),
        );
        report.structuralAxeRuns++;
      }
      tab(c, "scan");
      const factory = c.doc.querySelector("#ticket-factoryOrder").value;
      click(c, '[data-capture="manual"]');
      check(
        c.doc.querySelector(".ticket-heading").textContent.includes("AI"),
        "toolbar does not relabel existing AI source",
      );
      input(c, "#ticket-factoryOrder", "");
      check(
        c.doc.querySelector("#scan-save").disabled,
        "missing identity blocks",
      );
      check(
        c.doc
          .querySelector("#ticket-factoryOrder")
          .getAttribute("aria-invalid") === "false",
        "required validation waits for blur",
      );
      c.doc
        .querySelector("#ticket-factoryOrder")
        .dispatchEvent(new c.w.FocusEvent("focusout", { bubbles: true }));
      check(
        c.doc
          .querySelector("#ticket-factoryOrder")
          .getAttribute("aria-invalid") === "true",
        "blur invalid",
      );
      input(c, "#ticket-factoryOrder", factory);
      input(c, "#ticket-factoryQuantity", "-1");
      check(c.doc.querySelector("#scan-save").disabled, "negative blocked");
      check(
        c.doc.querySelector(".detail-disclosure").open,
        "invalid optional details open",
      );
      input(c, "#ticket-factoryQuantity", "1,024.5");
      check(
        !c.doc.querySelector("#scan-save").disabled,
        "grouped decimal accepted",
      );
      input(c, "#ticket-customerQuantity", "abc");
      check(c.doc.querySelector("#scan-save").disabled, "malformed blocked");
      input(c, "#ticket-customerQuantity", "");
      check(
        !c.doc.querySelector("#scan-save").disabled,
        "optional blank accepted",
      );
      check(
        /6/.test(c.doc.querySelector("#filled-count").textContent),
        "filled count updates",
      );
      c.doc.querySelector("#ticket-storageFormat").value = "BOX";
      c.doc
        .querySelector("#ticket-storageFormat")
        .dispatchEvent(new c.w.Event("change", { bubbles: true }));
      tab(c, "floor");
      tab(c, "scan");
      check(
        c.doc.querySelector("#ticket-storageFormat").value === "BOX",
        "draft unit retained across views",
      );
      check(
        c.doc.querySelector("#ticket-factoryQuantity").value === "1,024.5",
        "quantity draft retained",
      );
      click(c, "#scan-save");
      check(c.doc.querySelector("#scan-more"), "confirmed specimen");
      click(c, "#scan-more");
      check(
        c.doc.querySelector("#ticket-factoryOrder").value === "",
        "scan-more empty new draft",
      );
      check(
        c.doc.querySelector("#scan-save").disabled,
        "new empty draft blocked",
      );
      click(c, "#remove-ticket");
      check(!c.doc.querySelector("#ticket-form"), "remove only ticket");
      click(c, "#add-ticket");
      check(c.doc.querySelector("#ticket-form"), "add manual ticket");
      tab(c, "catalogue");
      input(c, "#product-search", "absent-code");
      check(
        c.doc.querySelector("#product-rows").children.length === 0,
        "search no matches",
      );
      check(c.doc.querySelector("#clear-search"), "empty recovery");
      click(c, "#clear-search");
      check(
        c.doc.querySelector("#product-rows").children.length === 3,
        "clear restores rows",
      );
      click(c, "#review-filter");
      check(
        c.doc.querySelector("#product-rows").children.length === 2,
        "Ready product filter",
      );
      click(c, "#clear-catalogue-filter");
      check(
        c.doc.querySelector("#product-rows").children.length === 3,
        "removable filter chip",
      );
      click(c, '[data-catalogue-view="storageUnits"]');
      check(
        [...c.doc.querySelectorAll("#product-rows .badge")].some((e) =>
          /Stored|เก็บ/.test(e.textContent),
        ),
        "unit workflow statuses",
      );
      click(c, "#review-filter");
      check(
        c.doc.querySelector("#product-rows").children.length === 1,
        "stored unit filter",
      );
      check(
        c.doc.querySelector(".stat-strip dd").textContent === "128",
        "filters do not change warehouse totals",
      );
      tab(c, "floor");
      const zone = c.doc.querySelector('[data-zone="FG1-R01"]');
      zone.dispatchEvent(
        new c.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      check(
        c.doc.querySelector(".floor-inspector h4").textContent === "FG1-R01",
        "keyboard selects R01",
      );
      check(
        /^2/.test(
          c.doc.querySelector(".floor-inspector dl div:last-child dd")
            .textContent,
        ),
        "inspector agrees with drawn pallets",
      );
      check(
        c.doc.querySelectorAll(".pallet").length === 2,
        "two pallets drawn",
      );
      c.doc
        .querySelector('[data-zone="FG1-R01"]')
        .dispatchEvent(
          new c.w.KeyboardEvent("keydown", { key: " ", bubbles: true }),
        );
      check(!c.doc.querySelector(".floor-inspector h4"), "reselect clears");
      tab(c, "hr");
      state(c, "uncertain");
      click(c, "#safe-clock-retry");
      check(c.doc.querySelector(".badge.success"), "clocked-out success tone");
      check(
        c.doc.querySelector(".hr-action-row").textContent.includes("17:31"),
        "confirmed receipt",
      );
      c.doc
        .querySelector('[data-screen="hr"]')
        .dispatchEvent(
          new c.w.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
        );
      check(
        c.doc
          .querySelector('[data-screen="scan"]')
          .getAttribute("aria-selected") === "true",
        "tabs Home",
      );
      c.doc
        .querySelector('[data-screen="scan"]')
        .dispatchEvent(
          new c.w.KeyboardEvent("keydown", { key: "End", bubbles: true }),
        );
      check(
        c.doc
          .querySelector('[data-screen="hr"]')
          .getAttribute("aria-selected") === "true",
        "tabs End",
      );
      integrity(c);
      c.dom.window.close();
    }
  const frozen = fs.readFileSync(
    path.join(root, "variants/frozen-sheet.js"),
    "utf8",
  );
  check(
    frozen === fs.readFileSync(path.join(root, "sheet.js"), "utf8"),
    "frozen base script exact copy",
  );
  check(
    fs
      .readFileSync(path.join(root, "variants/frozen-styles.css"), "utf8")
      .replaceAll('url("../fonts/', 'url("fonts/') ===
      fs.readFileSync(path.join(root, "styles.css"), "utf8"),
    "frozen styles differ only font paths",
  );
  check(
    fs
      .readFileSync(path.join(root, "variants/index.html"), "utf8")
      .includes("frozen-sheet.js") &&
      !fs
        .readFileSync(path.join(root, "variants/index.html"), "utf8")
        .includes("review.js"),
    "variants isolated",
  );
  check(
    fs
      .readFileSync(path.join(root, "review.css"), "utf8")
      .includes("(width >= 48rem) and (pointer: fine)"),
    "source density query",
  );
  report.badgeContrast = {};
  const light = [
    ["success", "#084d2c", "#e3f3ea"],
    ["warning", "#643900", "#fff0d0"],
    ["danger", "#851c16", "#fee9e7"],
    ["pending", "#3e258a", "#eeeaff"],
  ];
  const dark = [
    ["success", "#8be3b7", "#183c2e"],
    ["warning", "#ffd08a", "#49361c"],
    ["danger", "#ffbbb4", "#492725"],
    ["pending", "#d0c0ff", "#312b50"],
  ];
  for (const [theme, values] of [
    ["light", light],
    ["dark", dark],
  ])
    for (const [name, fg, bg] of values) {
      const ratio = contrast(fg, bg);
      check(ratio >= 7, `${theme} ${name} proposed ink`);
      report.badgeContrast[`${theme}-${name}`] = Number(ratio.toFixed(2));
    }
  report.passed = true;
  fs.writeFileSync(
    path.join(__dirname, "adoption-checks-rerun.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log("passed", report.checks, report.stateCombinations, report.structuralAxeRuns);
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
