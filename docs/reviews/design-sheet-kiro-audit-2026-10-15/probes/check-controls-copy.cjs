/* Exercises the actual bundled shadcn controls with the sheet's draft handlers. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { JSDOM, VirtualConsole } = require("jsdom");
const { getByRole } = require("@testing-library/dom");
const userEvent = require("@testing-library/user-event").default;
const root = path.resolve(__dirname, "../../../design-sheet");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (error) => errors.push(error.message));
const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"), {
  runScripts: "outside-only",
  url: "http://localhost:3211/",
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const w = dom.window,
  doc = w.document;
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
  ["sheet.js", "review.js", "dist/controls.js"]
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n"),
);
const user = userEvent.setup({ document: doc });
const settled = async () => {
  await new Promise((resolve) => w.setTimeout(resolve, 10));
};
const select = async (id, option) => {
  await user.click(
    doc.getElementById(`${id}-control`) ?? doc.getElementById(id),
  );
  await user.click(
    getByRole(doc.body, "option", { name: option, exact: true }),
  );
  await settled();
};
let assertions = 0;
const check = (value, message) => {
  assert.ok(value, message);
  assertions++;
};

(async () => {
  check(
    doc.querySelectorAll(".sheet-field-trigger").length === 6,
    "all initial controls mounted",
  );
  check(
    [...doc.querySelectorAll("select")].every(
      (el) => el.hidden || el.getAttribute("aria-hidden") === "true",
    ),
    "no exposed native selects",
  );
  check(
    !doc.querySelector('input[type="date"],input[type="time"]'),
    "no native date/time pickers",
  );
  await select("ticket-storageFormat", "Package / box");
  check(
    doc.getElementById("ticket-storageFormat").value === "BOX",
    "Radix selection updates draft",
  );
  doc.getElementById("tab-catalogue").click();
  doc.getElementById("tab-scan").click();
  check(
    doc.getElementById("ticket-storageFormat-control").textContent ===
      "Package / box",
    "draft retained after remount",
  );
  doc.querySelector(".detail-disclosure").open = true;
  await user.click(doc.getElementById("ticket-deliveryDate-control"));
  await user.click(
    doc.querySelector('.sheet-calendar [data-day="10/15/2026"]'),
  );
  await settled();
  check(
    doc.getElementById("ticket-deliveryDate").value === "2026-10-15",
    "calendar stores civil ISO date",
  );
  check(
    !doc.querySelector(".sheet-picker-content"),
    "calendar closes after selection",
  );
  await user.click(doc.getElementById("ticket-deliveryDate-control"));
  await user.click(getByRole(doc.body, "button", { name: "Clear date" }));
  await settled();
  check(
    doc.getElementById("ticket-deliveryDate").value === "",
    "optional date clears",
  );
  await select("review-state", "Reading");
  check(
    doc.getElementById("ticket-storageFormat-control").disabled,
    "select disabled while reading",
  );
  check(
    doc.getElementById("ticket-deliveryDate-control").disabled,
    "calendar disabled while reading",
  );
  await select("review-state", "Normal");
  await user.click(doc.getElementById("demo-time-control"));
  await select("demo-time-control-hour", "23");
  await select("demo-time-control-minute", "59");
  await user.click(
    getByRole(doc.body, "button", { name: "Done", exact: true }),
  );
  await settled();
  check(
    doc.getElementById("demo-time").value === "23:59",
    "24-hour time value composed without native picker",
  );
  doc.getElementById("language-toggle").click();
  await settled();
  check(
    doc.getElementById("demo-date-control").textContent.includes("2569"),
    "Thai date shows Buddhist year",
  );
  check(
    doc.getElementById("demo-date").value === "2026-10-14",
    "locale keeps canonical date unchanged",
  );
  check(
    doc.getElementById("demo-time-control").textContent === "23:59",
    "time retained on locale change",
  );
  await user.click(doc.getElementById("demo-date-control"));
  await user.keyboard("{Escape}");
  await settled();
  check(
    !doc.querySelector(".sheet-picker-content"),
    "Escape dismisses date popover",
  );
  check(
    doc.activeElement.id === "demo-date-control",
    "Escape returns focus to trigger",
  );
  check(
    doc.querySelectorAll('[id="demo-date-control"]').length === 1,
    "no duplicate roots on language remount",
  );
  check(errors.length === 0, errors.join("\n"));
  console.log(JSON.stringify({ passed: true, assertions, errors }, null, 2));
  dom.window.close();
})().catch((error) => {
  console.error(error);
  dom.window.close();
  process.exitCode = 1;
});
