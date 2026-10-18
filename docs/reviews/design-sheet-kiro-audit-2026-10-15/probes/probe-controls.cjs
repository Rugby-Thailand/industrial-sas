/* Kiro audit probe (2026-10-15). Read-only: loads the current design sheet and
 * its built dist/controls.js in jsdom, exercises suspected defects and prints
 * observations as JSON. It writes nothing outside stdout. jsdom does not prove
 * layout, computed pointer density, contrast or real assistive-tech output. */
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { getByRole, queryAllByRole } = require("@testing-library/dom");
const userEvent = require("@testing-library/user-event").default;

const root = path.resolve(__dirname, "../../../design-sheet");

function create({ withControls = true } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (error) => errors.push(error.message));
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
  w.Element.prototype.hasPointerCapture = () => false;
  w.Element.prototype.setPointerCapture = () => {};
  w.Element.prototype.releasePointerCapture = () => {};
  w.Element.prototype.scrollIntoView = () => {};
  const files = [
    "sheet.js",
    "review.js",
    ...(withControls ? ["dist/controls.js"] : []),
  ];
  w.eval(
    files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n"),
  );
  const doc = w.document;
  const user = userEvent.setup({ document: doc });
  const settled = () => new Promise((r) => w.setTimeout(r, 15));
  const select = async (id, option) => {
    await user.click(
      doc.getElementById(`${id}-control`) ?? doc.getElementById(id),
    );
    await user.click(
      getByRole(doc.body, "option", { name: option, exact: true }),
    );
    await settled();
  };
  return { dom, w, doc, user, settled, select, errors };
}

(async () => {
  const out = {};

  // A. Re-selecting the already selected date (mouse) and confirming it with Enter (keyboard).
  {
    const c = create();
    await c.user.click(c.doc.getElementById("demo-date-control"));
    await c.settled();
    const focused = c.doc.activeElement;
    out.A_autofocusedDay = {
      text: focused.textContent,
      ariaLabel: focused.getAttribute("aria-label"),
    };
    await c.user.keyboard("{Enter}");
    await c.settled();
    out.A_afterEnterOnSelectedDay = {
      sourceValue: c.doc.getElementById("demo-date").value,
      triggerText: c.doc.getElementById("demo-date-control").textContent,
      popoverOpen: !!c.doc.querySelector(".sheet-picker-content"),
    };
    // Restore and repeat with a mouse click on the selected day.
    await c.user.click(c.doc.getElementById("demo-date-control"));
    await c.user.click(
      c.doc.querySelector('.sheet-calendar [data-day="10/14/2026"]'),
    );
    await c.settled();
    await c.user.click(c.doc.getElementById("demo-date-control"));
    await c.user.click(
      c.doc.querySelector('.sheet-calendar [data-day="10/14/2026"]'),
    );
    await c.settled();
    out.A_afterClickOnSelectedDay = {
      sourceValue: c.doc.getElementById("demo-date").value,
      triggerText: c.doc.getElementById("demo-date-control").textContent,
    };
    c.dom.window.close();
  }

  // B/F. Thai calendar accessible names, visible caption and week start.
  {
    const c = create();
    const firstWeekday = async () => {
      await c.user.click(c.doc.getElementById("demo-date-control"));
      await c.settled();
      const grid = c.doc.querySelector('.sheet-calendar [role="grid"]');
      const selected = c.doc.querySelector(
        ".sheet-calendar .rdp-selected button",
      );
      const res = {
        trigger: c.doc
          .getElementById("demo-date-control")
          .getAttribute("aria-label"),
        caption: c.doc.querySelector(".sheet-calendar .rdp-caption_label")
          ?.textContent,
        gridLabel: grid?.getAttribute("aria-label"),
        selectedDayLabel: selected?.getAttribute("aria-label"),
        firstWeekday:
          c.doc
            .querySelector(".sheet-calendar .rdp-weekday")
            ?.getAttribute("aria-label") ??
          c.doc.querySelector(".sheet-calendar .rdp-weekday")?.textContent,
        selectedTdClasses: selected?.closest("td")?.className,
        selectedButtonClasses: selected?.className
          .split(/\s+/)
          .filter((k) => k.startsWith("rdp")),
        navChevronClass: c.doc
          .querySelector(".sheet-calendar .rdp-button_next svg")
          ?.getAttribute("class"),
        outsideDays: c.doc.querySelectorAll(".sheet-calendar .rdp-outside")
          .length,
      };
      await c.user.keyboard("{Escape}");
      await c.settled();
      return res;
    };
    out.B_en = await firstWeekday();
    c.doc.getElementById("language-toggle").click();
    await c.settled();
    out.B_th = await firstWeekday();
    c.dom.window.close();
  }

  // C. Empty or incomplete time composition (state not reachable through the sheet UI).
  {
    const c = create();
    c.doc.getElementById("demo-time").value = "";
    c.w.sheetControls.refresh();
    await c.user.click(c.doc.getElementById("demo-time-control"));
    await c.settled();
    out.C_emptyTimeOpen = {
      trigger: c.doc
        .getElementById("demo-time-control")
        .getAttribute("aria-label"),
      hourTrigger: c.doc.getElementById("demo-time-control-hour").textContent,
      minuteTrigger: c.doc.getElementById("demo-time-control-minute")
        .textContent,
    };
    await c.select("demo-time-control-minute", "45");
    out.C_minuteFirst = {
      sourceValue: c.doc.getElementById("demo-time").value,
    };
    c.dom.window.close();
    const d = create();
    d.doc.getElementById("demo-time").value = "";
    d.w.sheetControls.refresh();
    await d.user.click(d.doc.getElementById("demo-time-control"));
    await d.select("demo-time-control-hour", "09");
    out.C_hourFirst = { sourceValue: d.doc.getElementById("demo-time").value };
    out.C_clearTimeAction = !!queryAllByRole(d.doc.body, "button").find((b) =>
      /clear/i.test(b.textContent),
    );
    d.dom.window.close();
  }

  // Q. Escape inside the nested hour Select keeps the time popover open.
  {
    const c = create();
    await c.user.click(c.doc.getElementById("demo-time-control"));
    await c.user.click(c.doc.getElementById("demo-time-control-hour"));
    await c.settled();
    const listboxOpen = !!c.doc.querySelector('[role="listbox"]');
    await c.user.keyboard("{Escape}");
    await c.settled();
    out.Q_nestedEscape = {
      listboxOpenedInsidePopover: listboxOpen,
      listboxAfterEscape: !!c.doc.querySelector('[role="listbox"]'),
      popoverAfterEscape: !!c.doc.querySelector(".sheet-picker-content"),
      activeElement: c.doc.activeElement.id,
    };
    c.dom.window.close();
  }

  // D. Static "Job No." error after the field becomes valid and the locale changes.
  {
    const c = create();
    const input = c.doc.getElementById("demo-required");
    input.value = "JOB-1";
    input.dispatchEvent(new c.w.Event("input", { bubbles: true }));
    const before = c.doc.getElementById("required-error").textContent;
    c.doc.getElementById("language-toggle").click();
    out.D_requiredErrorAfterLocale = {
      value: input.value,
      ariaInvalid: input.getAttribute("aria-invalid"),
      errorBeforeLocale: before,
      errorAfterLocale: c.doc.getElementById("required-error").textContent,
    };
    c.dom.window.close();
  }

  // E/G. Review-state focus return and Reading-state lock.
  {
    const c = create();
    await c.select("review-state", "Reading");
    out.E_focusAfterReviewState = c.doc.activeElement.id;
    out.G_reading = {
      textInputsDisabled: [
        ...c.doc.querySelectorAll("#ticket-form input:not([hidden])"),
      ].map((i) => [i.id, i.disabled]),
      scannerDisabled: [...c.doc.querySelectorAll(".field-scan")].map(
        (b) => b.disabled,
      ),
      unitTypeDisabled: c.doc.getElementById("ticket-storageFormat-control")
        .disabled,
    };
    c.dom.window.close();
  }

  // H. HR pending specimen and catalogue toggles.
  {
    const c = create();
    c.doc.getElementById("tab-hr").click();
    await c.select("review-state", "Pending write");
    const b = c.doc.getElementById("sample-clock-out");
    out.H_pending = {
      disabled: b.disabled,
      ariaBusy: b.getAttribute("aria-busy"),
      classes: b.className,
      text: b.textContent,
      noticeRole: c.doc.querySelector(".review-notice")?.getAttribute("role"),
    };
    c.doc.getElementById("tab-catalogue").click();
    out.H_catalogueSwitch = [
      ...c.doc.querySelectorAll("[data-catalogue-view]"),
    ].map((e) => [e.textContent, e.className, e.getAttribute("aria-pressed")]);
    c.dom.window.close();
  }

  // N. Controls stylesheet present but controls.js absent: are form sources hidden?
  {
    const c = create({ withControls: false });
    const style = c.doc.createElement("style");
    style.textContent = fs.readFileSync(
      path.join(root, "dist/controls.css"),
      "utf8",
    );
    c.doc.head.append(style);
    const ids = [
      "review-state",
      "ticket-storageFormat",
      "demo-date",
      "demo-time",
    ];
    out.N_cssWithoutScript = Object.fromEntries(
      ids.map((id) => {
        const el = c.doc.getElementById(id);
        return [id, el ? c.w.getComputedStyle(el).display : "missing"];
      }),
    );
    c.dom.window.close();
  }

  console.log(JSON.stringify(out, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
