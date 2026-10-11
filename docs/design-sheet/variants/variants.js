/* global language, screen */
// Layout previews for the workflow panel. Loads after ../sheet.js, wraps its
// global renderWorkflow, and moves the freshly rendered nodes into variant
// containers. IDs, translations, sample state and the delegated panel events
// in sheet.js are reused unchanged.
(() => {
  const VARIANTS = ["side-rail", "margin-labels"];
  const DEFAULT_VARIANT = "side-rail";
  const words = {
    en: {
      preview: "Layout preview",
      "side-rail": "Side Rail",
      "margin-labels": "Margin Labels",
      baseline: "Baseline sheet",
      title: "Layout variants",
      "side-rail-description":
        "Context on the left, working content on the right. The rail uses some of the available width.",
      "margin-labels-description":
        "Section labels beside the content, with fewer heading rows. Narrow screens place the labels above each section.",
      location: "Location",
      capture: "Capture",
      totals: "Totals",
      find: "Find",
      filter: "Filter",
      floor: "Floor",
      recorded: "Recorded",
      planned: "Planned",
      policy: "Policy",
    },
    th: {
      preview: "ตัวอย่างโครงหน้า",
      "side-rail": "แถบด้านข้าง",
      "margin-labels": "ป้ายชิดขอบ",
      baseline: "แผ่นออกแบบหลัก",
      title: "ตัวเลือกโครงหน้า",
      "side-rail-description":
        "บริบทอยู่ด้านซ้าย พื้นที่ทำงานอยู่ด้านขวา แถบด้านข้างใช้พื้นที่ความกว้างบางส่วน",
      "margin-labels-description":
        "ป้ายหัวข้ออยู่ข้างเนื้อหา ลดแถวหัวข้อ บนหน้าจอแคบป้ายจะอยู่เหนือแต่ละส่วน",
      location: "ตำแหน่งจัดเก็บ",
      capture: "รับข้อมูล",
      totals: "ยอดรวม",
      find: "ค้นหา",
      filter: "ตัวกรอง",
      floor: "ชั้น",
      recorded: "บันทึกแล้ว",
      planned: "ตามแผน",
      policy: "นโยบาย",
    },
  };
  const say = (key) => words[language]?.[key] ?? words.en[key];
  const panel = document.querySelector("#workflow-panel");
  const choices = document.querySelectorAll("[data-variant-choice]");

  const readVariant = () => {
    const value = new URLSearchParams(window.location.search).get("variant");
    return VARIANTS.includes(value) ? value : null;
  };
  let variant = readVariant() ?? DEFAULT_VARIANT;

  const writeVariant = (next, mode) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history[mode]({ variant: next }, "", url);
  };

  // DOM helpers. Every arranger moves existing nodes; nothing is re-created.
  const pick = (selector) => panel.querySelector(selector);
  const make = (tag, className, ...children) => {
    const node = document.createElement(tag);
    node.className = className;
    node.append(...children.filter(Boolean));
    return node;
  };
  const label = (key) => make("h4", "vx-label", say(key));
  const feedback = () => pick("#workflow-feedback");

  // Both proposals repeat the location in the Save scope.
  const addLocationScope = () => {
    const code = pick(".location-strip strong")?.textContent;
    const scope = pick(".save-row > p");
    if (code && scope) scope.append(" · ", make("span", "mono", code));
  };

  // Side Rail: an unboxed context rail beside the work column.
  const railGroup = (key, ...children) =>
    make("div", "vr-group", key ? label(key) : null, ...children);
  const sideRail = (railChildren, mainChildren, { mapFirst = false } = {}) => {
    const rail = make("div", "vr-rail", ...railChildren);
    const main = make("div", "vr-main", ...mainChildren);
    const layout = make("div", `vr-layout${mapFirst ? " vr-map-first" : ""}`);
    // The floor map precedes its inspector in DOM so phones stack honestly.
    layout.append(...(mapFirst ? [main, rail] : [rail, main]));
    return layout;
  };

  const sideRailScreens = {
    scan: () => {
      addLocationScope();
      return [
        sideRail(
          [
            railGroup("location", pick(".location-strip")),
            railGroup("capture", pick(".ticket-toolbar")),
          ],
          [pick(".review-advisory"), pick("#ticket-form")],
        ),
      ];
    },
    catalogue: () => [
      sideRail(
        [
          railGroup("totals", pick(".stat-strip")),
          railGroup("filter", pick("#catalogue-filter")),
        ],
        [
          pick(".catalogue-search"),
          pick(".table-scroll"),
          pick(".table-footer"),
          feedback(),
        ],
      ),
    ],
    floor: () => {
      const layout = pick(".floor-layout");
      const arranged = sideRail(
        [
          railGroup("floor", pick(".workflow-title p"), pick(".floor-legend")),
          pick(".floor-inspector"),
        ],
        [pick(".floor-map")],
        { mapFirst: true },
      );
      layout.remove();
      return [arranged, feedback()];
    },
    hr: () => [
      sideRail(
        [
          railGroup(null, pick(".workflow-title p")),
          railGroup("planned", pick(".shift-strip")),
          railGroup("policy", pick(".hr-policy")),
        ],
        [pick(".time-grid"), pick(".hr-action-row"), feedback()],
      ),
    ],
  };

  // Margin Labels: one reading column with section names in a 112px margin.
  // `align` keeps each label on the first line of its band's content.
  const bandOf = (labelNode, align, ...children) =>
    make(
      "div",
      `ml-band ml-align-${align}`,
      labelNode,
      make("div", "ml-content", ...children),
    );
  const band = (key, align, ...children) =>
    bandOf(label(key), align, ...children);
  const full = (...children) => make("div", "ml-full", ...children);

  const marginScreens = {
    scan: () => {
      addLocationScope();
      const form = pick("#ticket-form");
      const heading = pick(".ticket-heading");
      heading.classList.add("vx-label");
      form.prepend(
        bandOf(
          heading,
          "text",
          form.querySelector(":scope > .field-grid"),
          pick(".detail-disclosure"),
        ),
      );
      return [
        band("location", "badge", pick(".location-strip")),
        band(
          "capture",
          "control",
          pick(".ticket-toolbar"),
          pick(".review-advisory"),
        ),
        form,
      ];
    },
    catalogue: () => [
      band("totals", "text", pick(".stat-strip")),
      band("find", "control", pick(".catalogue-search")),
      full(pick(".table-scroll"), pick(".table-footer"), feedback()),
    ],
    floor: () => [
      band("floor", "text", pick(".workflow-title p")),
      full(pick(".floor-layout"), feedback()),
    ],
    hr: () => [
      band(
        "recorded",
        "rule",
        pick(".time-grid"),
        pick(".hr-action-row"),
        feedback(),
      ),
      band("planned", "text", pick(".shift-strip")),
      band("policy", "text", pick(".hr-policy")),
    ],
  };

  const arrange = () => {
    panel.dataset.variant = variant;
    const screens =
      variant === "margin-labels" ? marginScreens : sideRailScreens;
    const nodes = screens[screen]?.();
    if (!nodes) return;
    const stack = make("div", "vx-stack", ...nodes);
    pick(".workflow-title").after(stack);
  };

  const renderChrome = () => {
    choices.forEach((button) => {
      const value = button.dataset.variantChoice;
      button.textContent = say(value);
      button.setAttribute("aria-pressed", String(value === variant));
    });
    document.querySelector("#variant-bar-label").textContent = say("preview");
    document.querySelector("#variant-baseline").textContent = say("baseline");
    document.querySelector("#variant-description").textContent = say(
      `${variant}-description`,
    );
    document.title = `Storage Planner · ${say(variant)} · ${say("title")}`;
  };

  // Wrap the global renderer. sheet.js calls renderWorkflow() by its global
  // name from selectScreen, renderLanguage and its delegated handlers, so the
  // wrapper runs after every tab switch, language switch and sample action.
  const baseRenderWorkflow = window.renderWorkflow;
  window.renderWorkflow = function renderVariantWorkflow() {
    baseRenderWorkflow();
    arrange();
    renderChrome();
  };

  choices.forEach((button) =>
    button.addEventListener("click", () => {
      const next = button.dataset.variantChoice;
      if (next === variant) return;
      variant = next;
      writeVariant(variant, "pushState");
      window.renderWorkflow();
    }),
  );
  window.addEventListener("popstate", () => {
    variant = readVariant() ?? DEFAULT_VARIANT;
    window.renderWorkflow();
  });

  // Normalise a missing or unknown ?variant= without adding a history entry.
  if (readVariant() !== variant) writeVariant(variant, "replaceState");
  window.renderWorkflow();
})();
