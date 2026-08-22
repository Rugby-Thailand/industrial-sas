/**
 * The operator-manual contract, and the validator that holds it.
 *
 * One catalogue (`tasks.mjs`) is the source of truth for three outputs: the SVG
 * overlays on the committed screenshots, the static HTML manual, and the check
 * that says whether either is stale. That only works if the catalogue is
 * checkable, so every rule a generator relies on is written here as data rather
 * than assumed by the generator that happens to read the field.
 *
 * Nothing in this module touches the filesystem or the network. The generators
 * pass in the facts they gathered — image sizes, route table — so the same rules
 * run in a test with synthetic data and in `pnpm manual:check` against the real
 * repository.
 *
 * Validation answers a list of problems rather than throwing on the first one:
 * an author who mistyped three coordinates should see three lines, not three
 * runs.
 */

/** @typedef {"th" | "en"} ManualLocale */

/**
 * A string in every supported locale. Thai is authored first (`INV-0010-01`
 * treats Thai as the product language, not a translation of English).
 *
 * @typedef {Readonly<Record<ManualLocale, string>>} LocalizedText
 */

/**
 * A red rectangle around a control, numbered with the step it belongs to.
 *
 * @typedef {object} ManualRectAnnotation
 * @property {"rect"} kind
 * @property {number} step 1-based index into the task's `steps`.
 * @property {number} x Left edge, in unscaled screenshot pixels.
 * @property {number} y Top edge, in unscaled screenshot pixels.
 * @property {number} width
 * @property {number} height
 */

/**
 * A red underline beneath a value, numbered with the step it belongs to. Used
 * where a rectangle would swallow half a table row — a single field, a status
 * word, one column heading.
 *
 * @typedef {object} ManualUnderlineAnnotation
 * @property {"underline"} kind
 * @property {number} step 1-based index into the task's `steps`.
 * @property {number} x Left end of the line, in unscaled screenshot pixels.
 * @property {number} y Baseline of the line, in unscaled screenshot pixels.
 * @property {number} width
 */

/** @typedef {ManualRectAnnotation | ManualUnderlineAnnotation} ManualAnnotation */

/**
 * One documented workflow: what it is for, who does it, where it lives, what it
 * needs first, the ordered steps, how the operator knows it worked, and the
 * annotated screenshot the steps point at.
 *
 * @typedef {object} ManualTask
 * @property {string} id Stable slug. Appears in URLs and in `data-manual-id`.
 * @property {string} category Id from `MANUAL_CATEGORIES`.
 * @property {string} audience Id from `MANUAL_AUDIENCES`.
 * @property {string} route Locale-free application path, `{param}` allowed.
 * @property {LocalizedText} title
 * @property {LocalizedText} summary
 * @property {readonly LocalizedText[]} prerequisites
 * @property {readonly LocalizedText[]} steps Ordered; step numbers are 1-based.
 * @property {readonly LocalizedText[]} success
 * @property {string} image Basename of the PNG under the screenshot directory.
 * @property {readonly ManualAnnotation[]} annotations
 */

/**
 * A category or audience: an id the catalogue references and the label each
 * locale shows for it.
 *
 * @typedef {object} ManualTerm
 * @property {string} id
 * @property {string} th
 * @property {string} en
 */

/** @typedef {{ readonly width: number, readonly height: number }} ImageSize */

/**
 * One thing wrong, addressed to the file and field the author must open.
 *
 * @typedef {object} ManualProblem
 * @property {string} path
 * @property {string} message
 */

/** Locales the manual is generated in. Thai is the default. */
export const MANUAL_LOCALES = /** @type {readonly ManualLocale[]} */ ([
  "th",
  "en",
]);

/** Stroke colour of every annotation. iOS red, unchanged since the first pass. */
export const ANNOTATION_COLOR = "#ff3b30";

/** Rectangle stroke width, in screenshot pixels. */
export const RECT_STROKE_WIDTH = 7;

/** Underline stroke width, in screenshot pixels. */
export const UNDERLINE_STROKE_WIDTH = 8;

/** Radius of the numbered badge drawn at an annotation's origin. */
export const BADGE_RADIUS = 22;

/** How far inside the origin the badge centre sits, on both axes. */
export const BADGE_INSET = 8;

/** Slug shape for a task id and an image basename. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Any Thai character. Used to tell an authored Thai string from a copy of English. */
const THAI = /[\u0E00-\u0E7F]/;

/** A `{param}` segment in a task route. */
const ROUTE_PARAMETER = /^\{[a-zA-Z][a-zA-Z0-9]*\}$/;

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonNegativeInteger = (value) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isPositiveInteger = (value) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

/**
 * The application path a task route points at, with its `{param}` segments
 * removed.
 *
 * `/receiving/{receiptId}` is documented against the receipt detail screen,
 * whose route is built by `receiptPath()` and can therefore never appear in
 * `ROUTES`. Stripping the parameters is what lets a detail page still be checked
 * against the one route table the application actually navigates by.
 *
 * @param {string} route
 * @returns {{ basePath: string, parameters: readonly string[] }}
 */
export function resolveTaskRoute(route) {
  const segments = route.split("/");
  /** @type {string[]} */
  const parameters = [];
  /** @type {string[]} */
  const kept = [];
  for (const segment of segments) {
    if (ROUTE_PARAMETER.test(segment)) {
      parameters.push(segment.slice(1, -1));
      continue;
    }
    kept.push(segment);
  }
  return { basePath: kept.join("/"), parameters };
}

/**
 * The visual extent of an annotation, badge included.
 *
 * The badge deliberately overhangs the shape it numbers — that is what makes it
 * readable against a dense screen — so bounds checking has to consider it, or a
 * box flush against the left edge would validate with half its number cropped.
 *
 * @param {ManualAnnotation} annotation
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
export function annotationExtent(annotation) {
  const badgeCenterX = annotation.x + BADGE_INSET;
  const badgeCenterY = annotation.y + BADGE_INSET;
  const shapeBottom =
    annotation.kind === "rect"
      ? annotation.y + annotation.height + RECT_STROKE_WIDTH / 2
      : annotation.y + UNDERLINE_STROKE_WIDTH / 2;
  const shapeTop =
    annotation.kind === "rect"
      ? annotation.y - RECT_STROKE_WIDTH / 2
      : annotation.y - UNDERLINE_STROKE_WIDTH / 2;
  return {
    left: Math.min(
      annotation.x - RECT_STROKE_WIDTH / 2,
      badgeCenterX - BADGE_RADIUS,
    ),
    top: Math.min(shapeTop, badgeCenterY - BADGE_RADIUS),
    right: Math.max(
      annotation.x + annotation.width + RECT_STROKE_WIDTH / 2,
      badgeCenterX + BADGE_RADIUS,
    ),
    bottom: Math.max(shapeBottom, badgeCenterY + BADGE_RADIUS),
  };
}

/**
 * @param {unknown} value
 * @param {string} path
 * @param {ManualProblem[]} problems
 * @param {{ requireThai?: boolean }} [options]
 */
const checkLocalized = (value, path, problems, options = {}) => {
  if (!isPlainObject(value)) {
    problems.push({
      path,
      message: "must be an object with th and en strings",
    });
    return;
  }
  for (const locale of MANUAL_LOCALES) {
    const text = /** @type {Record<string, unknown>} */ (value)[locale];
    if (typeof text !== "string" || text.trim() === "") {
      problems.push({
        path: `${path}.${locale}`,
        message: "must be a non-empty string",
      });
      continue;
    }
    if (locale === "th" && options.requireThai !== false && !THAI.test(text)) {
      problems.push({
        path: `${path}.th`,
        message:
          "contains no Thai characters — it is probably the English text",
      });
    }
    if (locale === "en" && THAI.test(text)) {
      problems.push({
        path: `${path}.en`,
        message: "contains Thai characters — the English text is missing",
      });
    }
  }
  for (const key of Object.keys(value)) {
    if (!MANUAL_LOCALES.includes(/** @type {ManualLocale} */ (key))) {
      problems.push({
        path: `${path}.${key}`,
        message: `unknown locale; supported locales are ${MANUAL_LOCALES.join(", ")}`,
      });
    }
  }
};

/**
 * @param {unknown} value
 * @param {string} path
 * @param {ManualProblem[]} problems
 */
const checkLocalizedList = (value, path, problems) => {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push({ path, message: "must be a non-empty array" });
    return;
  }
  value.forEach((entry, index) => {
    checkLocalized(entry, `${path}[${index}]`, problems);
  });
};

/**
 * @param {ManualTask} task
 * @param {string} path
 * @param {ImageSize | undefined} size
 * @param {ManualProblem[]} problems
 */
const checkAnnotations = (task, path, size, problems) => {
  const annotations = task.annotations;
  if (!Array.isArray(annotations) || annotations.length === 0) {
    problems.push({
      path: `${path}.annotations`,
      message: "must be a non-empty array — every task points at its screen",
    });
    return;
  }
  const stepCount = Array.isArray(task.steps) ? task.steps.length : 0;
  /** @type {Map<number, number>} */
  const seenSteps = new Map();
  let previousStep = 0;

  annotations.forEach((annotation, index) => {
    const at = `${path}.annotations[${index}]`;
    if (!isPlainObject(annotation)) {
      problems.push({ path: at, message: "must be an object" });
      return;
    }
    if (annotation.kind !== "rect" && annotation.kind !== "underline") {
      problems.push({
        path: `${at}.kind`,
        message: 'must be "rect" or "underline"',
      });
      return;
    }
    if (!isPositiveInteger(annotation.step)) {
      problems.push({
        path: `${at}.step`,
        message: "must be a positive integer step number",
      });
    } else if (annotation.step > stepCount) {
      problems.push({
        path: `${at}.step`,
        message: `points at step ${annotation.step}, but this task has ${stepCount} step(s)`,
      });
    } else {
      const first = seenSteps.get(annotation.step);
      if (first !== undefined) {
        problems.push({
          path: `${at}.step`,
          message: `step ${annotation.step} is already annotated at index ${first}; one number per step`,
        });
      } else {
        seenSteps.set(annotation.step, index);
      }
      if (annotation.step < previousStep) {
        problems.push({
          path: `${at}.step`,
          message: `out of order: step ${annotation.step} follows step ${previousStep}`,
        });
      }
      previousStep = annotation.step;
    }

    for (const field of ["x", "y", "width"]) {
      if (!isNonNegativeInteger(annotation[field])) {
        problems.push({
          path: `${at}.${field}`,
          message: "must be a non-negative integer number of pixels",
        });
      }
    }
    if (annotation.kind === "rect") {
      if (!isPositiveInteger(annotation.height)) {
        problems.push({
          path: `${at}.height`,
          message: "a rectangle must declare a positive integer height",
        });
      }
      if (!isPositiveInteger(annotation.width)) {
        problems.push({
          path: `${at}.width`,
          message: "a rectangle must declare a positive integer width",
        });
      }
    } else {
      if ("height" in annotation) {
        problems.push({
          path: `${at}.height`,
          message: "an underline has no height; remove it",
        });
      }
      if (!isPositiveInteger(annotation.width)) {
        problems.push({
          path: `${at}.width`,
          message: "an underline must declare a positive integer width",
        });
      }
    }

    if (size === undefined) return;
    const extent = annotationExtent(
      /** @type {ManualAnnotation} */ (annotation),
    );
    if (
      extent.left < 0 ||
      extent.top < 0 ||
      extent.right > size.width ||
      extent.bottom > size.height
    ) {
      problems.push({
        path: at,
        message:
          `falls outside ${task.image}.png (${size.width}×${size.height}): ` +
          `the annotation and its number span ` +
          `${extent.left}…${extent.right} × ${extent.top}…${extent.bottom}`,
      });
    }
  });

  if (stepCount > 0 && seenSteps.size > stepCount) {
    problems.push({
      path: `${path}.annotations`,
      message: "more annotations than steps",
    });
  }
};

/**
 * Every rule the generators rely on, checked against one catalogue.
 *
 * @param {object} input
 * @param {readonly ManualTask[]} input.tasks
 * @param {readonly ManualTerm[]} input.categories
 * @param {readonly ManualTerm[]} input.audiences
 * @param {Readonly<Record<string, ImageSize>>} [input.imageSizes]
 *   Screenshot sizes by image id. Omit to skip image and bounds checks.
 * @param {readonly string[]} [input.routes]
 *   Application paths from the navigation table. Omit to skip route checks.
 * @returns {readonly ManualProblem[]}
 */
export function validateCatalogue({
  tasks,
  categories,
  audiences,
  imageSizes,
  routes,
}) {
  /** @type {ManualProblem[]} */
  const problems = [];

  for (const [name, terms] of [
    ["categories", categories],
    ["audiences", audiences],
  ]) {
    if (!Array.isArray(terms) || terms.length === 0) {
      problems.push({ path: name, message: "must be a non-empty array" });
      continue;
    }
    /** @type {Set<string>} */
    const ids = new Set();
    terms.forEach((term, index) => {
      const at = `${name}[${index}]`;
      if (!isPlainObject(term) || typeof term.id !== "string") {
        problems.push({ path: at, message: "must be an object with an id" });
        return;
      }
      if (!SLUG.test(term.id)) {
        problems.push({
          path: `${at}.id`,
          message: `"${term.id}" must be a lowercase-hyphen slug`,
        });
      }
      if (ids.has(term.id)) {
        problems.push({
          path: `${at}.id`,
          message: `duplicate id "${term.id}"`,
        });
      }
      ids.add(term.id);
      checkLocalized({ th: term.th, en: term.en }, at, problems);
    });
  }

  const categoryIds = new Set(
    (Array.isArray(categories) ? categories : []).map((term) => term?.id),
  );
  const audienceIds = new Set(
    (Array.isArray(audiences) ? audiences : []).map((term) => term?.id),
  );

  if (!Array.isArray(tasks) || tasks.length === 0) {
    problems.push({ path: "tasks", message: "must be a non-empty array" });
    return problems;
  }

  /** @type {Map<string, number>} */
  const seenIds = new Map();
  /** @type {Map<string, number>} */
  const seenImages = new Map();

  tasks.forEach((task, index) => {
    const path = `tasks[${index}]`;
    if (!isPlainObject(task)) {
      problems.push({ path, message: "must be an object" });
      return;
    }

    if (typeof task.id !== "string" || !SLUG.test(task.id)) {
      problems.push({
        path: `${path}.id`,
        message: "must be a lowercase-hyphen slug, stable across releases",
      });
    } else {
      const first = seenIds.get(task.id);
      if (first !== undefined) {
        problems.push({
          path: `${path}.id`,
          message: `duplicate task id "${task.id}" — already used by tasks[${first}]`,
        });
      } else {
        seenIds.set(task.id, index);
      }
    }

    if (typeof task.category !== "string" || !categoryIds.has(task.category)) {
      problems.push({
        path: `${path}.category`,
        message: `"${String(task.category)}" is not a declared category`,
      });
    }
    if (typeof task.audience !== "string" || !audienceIds.has(task.audience)) {
      problems.push({
        path: `${path}.audience`,
        message: `"${String(task.audience)}" is not a declared audience`,
      });
    }

    checkLocalized(task.title, `${path}.title`, problems);
    checkLocalized(task.summary, `${path}.summary`, problems);
    checkLocalizedList(task.prerequisites, `${path}.prerequisites`, problems);
    checkLocalizedList(task.steps, `${path}.steps`, problems);
    checkLocalizedList(task.success, `${path}.success`, problems);

    if (typeof task.route !== "string" || !task.route.startsWith("/")) {
      problems.push({
        path: `${path}.route`,
        message: "must be a locale-free application path starting with /",
      });
    } else if (routes !== undefined) {
      const { basePath } = resolveTaskRoute(task.route);
      if (!routes.includes(basePath)) {
        problems.push({
          path: `${path}.route`,
          message: `"${task.route}" resolves to "${basePath}", which is not in the navigation route table`,
        });
      }
    }

    /** @type {ImageSize | undefined} */
    let size;
    if (typeof task.image !== "string" || !SLUG.test(task.image)) {
      problems.push({
        path: `${path}.image`,
        message: "must be the slug basename of a committed screenshot",
      });
    } else {
      const first = seenImages.get(task.image);
      if (first !== undefined) {
        problems.push({
          path: `${path}.image`,
          message: `screenshot "${task.image}.png" is already used by tasks[${first}]; each task needs its own overlay filename`,
        });
      } else {
        seenImages.set(task.image, index);
      }
      if (imageSizes !== undefined) {
        size = imageSizes[task.image];
        if (size === undefined) {
          problems.push({
            path: `${path}.image`,
            message: `no screenshot named ${task.image}.png was found`,
          });
        }
      }
    }

    checkAnnotations(/** @type {ManualTask} */ (task), path, size, problems);
  });

  if (imageSizes !== undefined) {
    const used = new Set(tasks.map((task) => task?.image));
    for (const image of Object.keys(imageSizes).sort()) {
      if (!used.has(image)) {
        problems.push({
          path: `images/${image}.png`,
          message: "screenshot is not referenced by any task",
        });
      }
    }
  }

  return problems;
}

/**
 * Problems as lines a human can act on, longest-lived path first.
 *
 * @param {readonly ManualProblem[]} problems
 * @returns {string}
 */
export function formatProblems(problems) {
  return problems
    .map((problem) => `  ${problem.path}: ${problem.message}`)
    .join("\n");
}
