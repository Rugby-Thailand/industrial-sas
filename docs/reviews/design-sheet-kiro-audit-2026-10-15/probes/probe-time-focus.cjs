/* Kiro audit probe (2026-10-15): time draft/commit semantics and focus return
 * after a calendar selection. Read-only jsdom run; writes nothing. */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { getByRole } = require("@testing-library/dom");
const userEvent = require("@testing-library/user-event").default;
const root = path.resolve(__dirname, "../../../design-sheet");

function create() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "index.html"), "utf8"),
    {
      runScripts: "outside-only",
      url: "http://localhost:3211/",
      pretendToBeVisual: true,
      virtualConsole: vc,
    },
  );
  const w = dom.window;
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
  Object.assign(w.Element.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture() {},
    releasePointerCapture() {},
    scrollIntoView() {},
  });
  w.eval(
    ["sheet.js", "review.js", "dist/controls.js"]
      .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
      .join("\n"),
  );
  const doc = w.document,
    user = userEvent.setup({ document: doc });
  const settled = () => new Promise((r) => w.setTimeout(r, 15));
  return { dom, w, doc, user, settled, errors };
}

(async () => {
  const out = {};
  {
    const c = create();
    await c.user.click(c.doc.getElementById("demo-time-control"));
    await c.user.click(c.doc.getElementById("demo-time-control-hour"));
    await c.user.click(
      getByRole(c.doc.body, "option", { name: "23", exact: true }),
    );
    await c.settled();
    const whileOpen = c.doc.getElementById("demo-time").value;
    c.doc.getElementById("demo-time-control-hour").focus();
    await c.user.keyboard("{Escape}");
    await c.settled();
    out.timeCommitBeforeDone = {
      valueWhilePopoverOpen: whileOpen,
      popoverOpenAfterEscape: !!c.doc.querySelector(".sheet-picker-content"),
      valueAfterEscape: c.doc.getElementById("demo-time").value,
      doneButtonDisabled: null,
    };
    c.dom.window.close();
  }
  {
    const c = create();
    await c.user.click(c.doc.getElementById("demo-date-control"));
    await c.user.click(
      c.doc.querySelector('.sheet-calendar [data-day="10/20/2026"]'),
    );
    await c.settled();
    out.focusAfterDateSelection =
      c.doc.activeElement.id || c.doc.activeElement.tagName;
    c.doc.querySelector(".detail-disclosure").open = true;
    await c.user.click(c.doc.getElementById("ticket-deliveryDate-control"));
    await c.user.click(
      c.doc.querySelector('.sheet-calendar [data-day="10/20/2026"]'),
    );
    await c.settled();
    out.focusAfterScanDateSelection =
      c.doc.activeElement.id || c.doc.activeElement.tagName;
    out.filledCountAfterScanDate =
      c.doc.getElementById("filled-count").textContent;
    out.errors = c.errors;
    c.dom.window.close();
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
