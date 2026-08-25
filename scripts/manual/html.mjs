import { renderInlineOverlay } from "./annotations.mjs";
import { MANUAL_CSS } from "./styles.mjs";
import { MANUAL_JS } from "./client.mjs";

export const MANUAL_OUTPUT_DIRECTORY = "docs/manual-html";

export const SCREENSHOT_DIRECTORY = "docs/manuals/assets/operator-guide-th";

export const GENERATED_MARKER = ".generated-by";

export const GENERATED_MARKER_CONTENT = "scripts/generate-html-manual.mjs\n";

/**
 * @param {string} value
 * @returns {string}
 */
export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Chrome text. Authored here because it is the manual's own wording, not the application's. */
const UI = Object.freeze({
  brand: "Industrial SAS",
  siteTitle: Object.freeze({
    th: "คู่มือผู้ปฏิบัติงาน",
    en: "Operator manual",
  }),
  siteLead: Object.freeze({
    th: "งานหลักของคลังสินค้า พร้อมภาพหน้าจอและกรอบสีแดงที่ตรงกับหมายเลขขั้นตอน",
    en: "The core warehouse workflows, with screenshots whose red boxes match the numbered steps.",
  }),
  sampleNotice: Object.freeze({
    th: "ภาพในคู่มือเป็นข้อมูลตัวอย่าง ก่อนบันทึกในระบบจริง ให้ตรวจสอบองค์กร คลังสินค้า และสิทธิ์ของผู้ใช้งาน เพราะการทำงานอาจเขียนข้อมูลลงเซิร์ฟเวอร์",
    en: "The screenshots show sample data. Before saving in the live application, confirm the organization, warehouse, and user permissions because actions may write data to the server.",
  }),
  languageGroup: Object.freeze({ th: "เลือกภาษา", en: "Choose a language" }),
  skip: Object.freeze({ th: "ข้ามไปเนื้อหาหลัก", en: "Skip to main content" }),
  searchLabel: Object.freeze({ th: "ค้นหางาน", en: "Search tasks" }),
  searchPlaceholder: Object.freeze({
    th: "เช่น รับสินค้า, ใบสั่งซื้อ",
    en: "e.g. receiving, purchase order",
  }),
  categoryLabel: Object.freeze({ th: "หมวดงาน", en: "Category" }),
  allCategories: Object.freeze({ th: "ทุกหมวด", en: "All categories" }),
  countTemplate: Object.freeze({
    th: "แสดง {shown} จาก {total} งาน",
    en: "Showing {shown} of {total} tasks",
  }),
  emptyResult: Object.freeze({
    th: "ไม่พบงานที่ตรงกับคำค้นหา ลองลดคำค้นหรือเลือกทุกหมวด",
    en: "No task matches. Try a shorter search term or choose all categories.",
  }),
  audience: Object.freeze({ th: "ผู้ใช้งาน", en: "Audience" }),
  route: Object.freeze({ th: "หน้าจอ", en: "Screen" }),
  category: Object.freeze({ th: "หมวดงาน", en: "Category" }),
  taskId: Object.freeze({ th: "รหัสงาน", en: "Task id" }),
  prerequisites: Object.freeze({
    th: "สิ่งที่ต้องมีก่อนเริ่ม",
    en: "Before you start",
  }),
  steps: Object.freeze({ th: "ขั้นตอน", en: "Steps" }),
  success: Object.freeze({
    th: "ตรวจว่างานสำเร็จอย่างไร",
    en: "How to tell it worked",
  }),
  screenshot: Object.freeze({ th: "ภาพหน้าจอ", en: "Screenshot" }),
  annotationHint: Object.freeze({
    th: "หมายเลขในกรอบสีแดงคือหมายเลขขั้นตอน: {steps}",
    en: "The numbers in the red boxes are step numbers: {steps}",
  }),
  altSuffix: Object.freeze({
    th: "ภาพหน้าจอพร้อมกรอบคำแนะนำสีแดง",
    en: "screenshot with red guidance boxes",
  }),
  fullSize: Object.freeze({
    th: "เปิดภาพขนาดเต็ม",
    en: "Open the full-size image",
  }),
  home: Object.freeze({ th: "หน้ารวมคู่มือ", en: "Manual index" }),
  previous: Object.freeze({ th: "งานก่อนหน้า", en: "Previous task" }),
  next: Object.freeze({ th: "งานถัดไป", en: "Next task" }),
  footerSource: Object.freeze({
    th: "สร้างจาก scripts/manual/tasks.mjs ด้วยคำสั่ง pnpm manual:build",
    en: "Generated from scripts/manual/tasks.mjs by pnpm manual:build.",
  }),
  footerEdit: Object.freeze({
    th: "ห้ามแก้ไขไฟล์ในโฟลเดอร์นี้โดยตรง แก้ที่แคตตาล็อกแล้วสร้างใหม่",
    en: "Do not edit files in this directory; change the catalogue and regenerate.",
  }),
});

/**
 * @param {import("./schema.mjs").LocalizedText} text
 * @param {{ class?: string }} [options]
 * @returns {string}
 */
const both = (text, options = {}) => {
  const className =
    options.class === undefined ? "" : ` class="${options.class}"`;
  return (
    `<span lang="th" data-lang="th"${className}>${escapeHtml(text.th)}</span>` +
    `<span lang="en" data-lang="en"${className}>${escapeHtml(text.en)}</span>`
  );
};

/**
 * @param {import("./schema.mjs").LocalizedText} template
 * @param {Record<string, string>} values
 * @returns {import("./schema.mjs").LocalizedText}
 */
const fill = (template, values) => {
  /** @type {Record<string, string>} */
  const filled = {};
  for (const [locale, text] of Object.entries(template)) {
    filled[locale] = Object.entries(values).reduce(
      (result, [key, value]) => result.split(`{${key}}`).join(value),
      text,
    );
  }
  return /** @type {import("./schema.mjs").LocalizedText} */ (filled);
};

/**
 * @param {import("./schema.mjs").ManualTerm[] | readonly import("./schema.mjs").ManualTerm[]} terms
 * @param {string} id
 * @returns {import("./schema.mjs").LocalizedText}
 */
const term = (terms, id) => {
  const found = terms.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`unknown term "${id}"`);
  return { th: found.th, en: found.en };
};

/**
 * @param {object} input
 * @param {import("./schema.mjs").LocalizedText} input.title
 * @param {string} input.assetPrefix `""` at the root, `"../"` inside `tasks/`.
 * @param {string} input.homeHref
 * @param {string} input.body
 * @returns {string}
 */
const page = ({ title, assetPrefix, homeHref, body }) => `<!doctype html>
<html lang="th" class="lang-th" data-manual-locale="th"
  data-title-th="${escapeHtml(`${title.th} · ${UI.brand}`)}"
  data-title-en="${escapeHtml(`${title.en} · ${UI.brand}`)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${title.th} · ${UI.brand}`)}</title>
<meta name="description" content="${escapeHtml(UI.siteLead.th)}">
<link rel="stylesheet" href="${assetPrefix}assets/manual.css">
</head>
<body>
<a class="skip-link" href="#main">${both(UI.skip)}</a>
<header class="site-header">
<p class="brand"><a href="${homeHref}">${escapeHtml(UI.brand)}</a></p>
<div class="lang-switch" role="group" aria-label="${escapeHtml(UI.languageGroup.th)} / ${escapeHtml(UI.languageGroup.en)}">
<button type="button" data-set-locale="th" aria-pressed="true" lang="th">ไทย</button>
<button type="button" data-set-locale="en" aria-pressed="false" lang="en">English</button>
</div>
</header>
${body}
<footer class="site-footer">
<p>${both(UI.footerSource)}</p>
<p>${both(UI.footerEdit)}</p>
</footer>
<script src="${assetPrefix}assets/manual.js" defer></script>
</body>
</html>
`;

/**
 * @param {import("./schema.mjs").ManualTask} task
 * @param {import("./schema.mjs").LocalizedText} categoryLabel
 * @param {import("./schema.mjs").LocalizedText} audienceLabel
 * @param {import("./schema.mjs").ManualLocale} locale
 * @returns {string}
 */
const searchIndex = (task, categoryLabel, audienceLabel, locale) =>
  [
    task.id,
    task.route,
    task.title[locale],
    task.summary[locale],
    categoryLabel[locale],
    audienceLabel[locale],
    ...task.steps.map((step) => step[locale]),
    ...task.prerequisites.map((entry) => entry[locale]),
  ]
    .join(" ")
    .toLowerCase();

/**
 * @param {object} input
 * @param {readonly import("./schema.mjs").ManualTask[]} input.tasks
 * @param {readonly import("./schema.mjs").ManualTerm[]} input.categories
 * @param {readonly import("./schema.mjs").ManualTerm[]} input.audiences
 * @returns {string}
 */
const renderIndex = ({ tasks, categories, audiences }) => {
  const used = categories.filter((category) =>
    tasks.some((task) => task.category === category.id),
  );

  const options = [
    `<option value="all">${escapeHtml(UI.allCategories.th)} / ${escapeHtml(UI.allCategories.en)}</option>`,
    ...used.map(
      (category) =>
        `<option value="${escapeHtml(category.id)}">${escapeHtml(category.th)} / ${escapeHtml(category.en)}</option>`,
    ),
  ].join("\n");

  const cards = tasks
    .map((task) => {
      const categoryLabel = term(categories, task.category);
      const audienceLabel = term(audiences, task.audience);
      return `<li class="task-card" data-task-id="${escapeHtml(task.id)}"
  data-category="${escapeHtml(task.category)}"
  data-search-th="${escapeHtml(searchIndex(task, categoryLabel, audienceLabel, "th"))}"
  data-search-en="${escapeHtml(searchIndex(task, categoryLabel, audienceLabel, "en"))}">
<h2><a href="tasks/${escapeHtml(task.id)}.html">${both(task.title)}</a></h2>
<p>${both(task.summary)}</p>
<ul class="tags">
<li class="tag">${both(categoryLabel)}</li>
<li class="tag">${both(audienceLabel)}</li>
<li class="tag"><code>/{locale}${escapeHtml(task.route)}</code></li>
</ul>
</li>`;
    })
    .join("\n");

  const body = `<main id="main">
<h1>${both(UI.siteTitle)}</h1>
<p class="lead">${both(UI.siteLead)}</p>
<p class="notice">${both(UI.sampleNotice)}</p>
<form class="filters" role="search" onsubmit="return false;">
<div class="field">
<label for="manual-search">${both(UI.searchLabel)}</label>
<input id="manual-search" type="search" data-manual-search autocomplete="off"
  placeholder="${escapeHtml(UI.searchPlaceholder.th)}">
</div>
<div class="field">
<label for="manual-category">${both(UI.categoryLabel)}</label>
<select id="manual-category" data-manual-category>
${options}
</select>
</div>
<p class="result-count" data-result-count aria-live="polite"
  data-template-th="${escapeHtml(UI.countTemplate.th)}"
  data-template-en="${escapeHtml(UI.countTemplate.en)}">
<span lang="th" data-lang="th">${escapeHtml(
    fill(UI.countTemplate, {
      shown: String(tasks.length),
      total: String(tasks.length),
    }).th,
  )}</span><span lang="en" data-lang="en">${escapeHtml(
    fill(UI.countTemplate, {
      shown: String(tasks.length),
      total: String(tasks.length),
    }).en,
  )}</span>
</p>
</form>
<ol class="task-list" role="list">
${cards}
</ol>
<p class="empty" data-empty hidden>${both(UI.emptyResult)}</p>
</main>`;

  return page({
    title: UI.siteTitle,
    assetPrefix: "",
    homeHref: "index.html",
    body,
  });
};

/**
 * @param {import("./schema.mjs").LocalizedText} label
 * @param {import("./schema.mjs").LocalizedText} title
 * @param {string} prefix
 * @param {string} suffix
 * @returns {import("./schema.mjs").LocalizedText}
 */
const pagerLabel = (label, title, prefix, suffix) => ({
  th: `${prefix}${label.th}: ${title.th}${suffix}`,
  en: `${prefix}${label.en}: ${title.en}${suffix}`,
});

/**
 * @param {object} input
 * @param {import("./schema.mjs").ManualTask} input.task
 * @param {import("./schema.mjs").ManualTask | undefined} input.previous
 * @param {import("./schema.mjs").ManualTask | undefined} input.next
 * @param {readonly import("./schema.mjs").ManualTerm[]} input.categories
 * @param {readonly import("./schema.mjs").ManualTerm[]} input.audiences
 * @param {import("./schema.mjs").ImageSize} input.size
 * @returns {string}
 */
const renderTaskPage = ({
  task,
  previous,
  next,
  categories,
  audiences,
  size,
}) => {
  const categoryLabel = term(categories, task.category);
  const audienceLabel = term(audiences, task.audience);
  const annotatedSteps = new Set(task.annotations.map((one) => one.step));

  const steps = task.steps
    .map((step, index) => {
      const number = index + 1;
      const annotated = annotatedSteps.has(number) ? " annotated" : "";
      return `<li class="step${annotated}" data-step="${number}">${both(step)}</li>`;
    })
    .join("\n");

  const list = (entries) =>
    entries.map((entry) => `<li>${both(entry)}</li>`).join("\n");

  const hint = fill(UI.annotationHint, {
    steps: [...annotatedSteps].join(", "),
  });

  const body = `<main id="main">
<nav class="breadcrumb" aria-label="${escapeHtml(UI.home.th)} / ${escapeHtml(UI.home.en)}">
<ol>
<li><a href="../index.html">${both(UI.home)}</a></li>
<li>${both(categoryLabel)}</li>
</ol>
</nav>
<article data-task-page="${escapeHtml(task.id)}">
<h1>${both(task.title)}</h1>
<p class="lead">${both(task.summary)}</p>
<dl class="meta">
<dt>${both(UI.audience)}</dt><dd>${both(audienceLabel)}</dd>
<dt>${both(UI.category)}</dt><dd>${both(categoryLabel)}</dd>
<dt>${both(UI.route)}</dt><dd><code>/{locale}${escapeHtml(task.route)}</code></dd>
<dt>${both(UI.taskId)}</dt><dd><code>${escapeHtml(task.id)}</code></dd>
</dl>
<h2>${both(UI.prerequisites)}</h2>
<ul class="checklist">
${list(task.prerequisites)}
</ul>
<figure class="screenshot">
<div class="screenshot-frame">
<img src="../assets/images/${escapeHtml(task.image)}.png" width="${size.width}"
  height="${size.height}" loading="lazy" decoding="async"
  alt="${escapeHtml(`${task.title.th} — ${UI.altSuffix.th}`)}">
${renderInlineOverlay({ width: size.width, height: size.height, annotations: task.annotations })}
</div>
<figcaption>${both(task.title)} <span class="annotation-hint">${both(hint)}</span>
<span class="annotation-hint"><a href="../assets/images/${escapeHtml(task.image)}-annotated.svg">${both(UI.fullSize)}</a></span></figcaption>
</figure>
<h2>${both(UI.steps)}</h2>
<ol class="steps" role="list">
${steps}
</ol>
<h2>${both(UI.success)}</h2>
<ul class="checklist">
${list(task.success)}
</ul>
</article>
<nav class="pager" aria-label="${escapeHtml(UI.previous.th)} / ${escapeHtml(UI.next.th)}">
${
  previous === undefined
    ? "<span></span>"
    : `<a href="${escapeHtml(previous.id)}.html" rel="prev">${both(
        pagerLabel(UI.previous, previous.title, "← ", ""),
      )}</a>`
}
${
  next === undefined
    ? "<span></span>"
    : `<a href="${escapeHtml(next.id)}.html" rel="next">${both(
        pagerLabel(UI.next, next.title, "", " →"),
      )}</a>`
}
</nav>
</main>`;

  return page({
    title: task.title,
    assetPrefix: "../",
    homeHref: "../index.html",
    body,
  });
};

/**
 * @param {object} input
 * @param {readonly import("./schema.mjs").ManualTask[]} input.tasks
 * @param {readonly import("./schema.mjs").ManualTerm[]} input.categories
 * @param {readonly import("./schema.mjs").ManualTerm[]} input.audiences
 * @param {Readonly<Record<string, import("./schema.mjs").ImageSize>>} input.imageSizes
 * @returns {{ files: Map<string, string>, images: readonly string[], overlays: readonly string[] }}
 */
export function renderManualSite({ tasks, categories, audiences, imageSizes }) {
  /** @type {Map<string, string>} */
  const files = new Map();
  files.set("index.html", renderIndex({ tasks, categories, audiences }));
  files.set("assets/manual.css", MANUAL_CSS);
  files.set("assets/manual.js", MANUAL_JS);

  tasks.forEach((task, index) => {
    const size = imageSizes[task.image];
    if (size === undefined) {
      throw new Error(
        `task "${task.id}" references ${task.image}.png, which was not measured`,
      );
    }
    files.set(
      `tasks/${task.id}.html`,
      renderTaskPage({
        task,
        previous: tasks[index - 1],
        next: tasks[index + 1],
        categories,
        audiences,
        size,
      }),
    );
  });

  const images = [...new Set(tasks.map((task) => task.image))].sort();
  const overlays = images.map((image) => `${image}-annotated.svg`);
  return { files, images, overlays };
}
