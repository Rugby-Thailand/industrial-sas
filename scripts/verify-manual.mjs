/**
 * The operator-manual guard.
 *
 * A generated manual fails quietly: nobody notices that a screen was renamed, or
 * that the English half of a step was never written, or that an overlay still
 * carries coordinates from before a screenshot was recaptured. Each of those is a
 * fact this script can check, so each is checked here rather than left to the
 * reader who finds it on a shop floor.
 *
 * It needs no server, no credentials, and no browser. Everything it reads is
 * committed: the catalogue, the screenshots, `src/lib/navigation.ts`, the Thai
 * Markdown guide, and the generated output.
 *
 *   pnpm manual:build && pnpm manual:check
 *
 * `manual:build` first, because one of the things this proves is that the output
 * on disk is what the catalogue currently renders — the check cannot regenerate
 * it itself without losing the ability to say "stale".
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { overlayLabel, renderAnnotatedSvg } from "./manual/annotations.mjs";
import { collectImageSizes } from "./manual/images.mjs";
import {
  GENERATED_MARKER,
  MANUAL_OUTPUT_DIRECTORY,
  SCREENSHOT_DIRECTORY,
  renderManualSite,
} from "./manual/html.mjs";
import { NAVIGATION_SOURCE, readNavigationRoutes } from "./manual/routes.mjs";
import { formatProblems, validateCatalogue } from "./manual/schema.mjs";
import {
  MANUAL_AUDIENCES,
  MANUAL_CATEGORIES,
  MANUAL_TASKS,
} from "./manual/tasks.mjs";

/** The Thai guide that links the overlays, relative to the repository root. */
export const MARKDOWN_GUIDE = "docs/manuals/visual-operator-guide-th.md";

/**
 * Every relative file path under a directory, sorted.
 *
 * @param {string} root
 * @param {string} [prefix]
 * @returns {string[]}
 */
const walk = (root, prefix = "") => {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(join(root, prefix)).sort()) {
    const path = prefix === "" ? entry : `${prefix}/${entry}`;
    if (statSync(join(root, path)).isDirectory()) {
      found.push(...walk(root, path));
      continue;
    }
    found.push(path);
  }
  return found.sort();
};

/**
 * Everything wrong with the manual in one repository.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot]
 * @param {readonly import("./manual/schema.mjs").ManualTask[]} [options.tasks]
 * @param {readonly import("./manual/schema.mjs").ManualTerm[]} [options.categories]
 * @param {readonly import("./manual/schema.mjs").ManualTerm[]} [options.audiences]
 * @returns {readonly import("./manual/schema.mjs").ManualProblem[]}
 */
export function collectManualProblems(options = {}) {
  const repoRoot =
    options.repoRoot ?? fileURLToPath(new URL("..", import.meta.url));
  const tasks = options.tasks ?? MANUAL_TASKS;
  const categories = options.categories ?? MANUAL_CATEGORIES;
  const audiences = options.audiences ?? MANUAL_AUDIENCES;

  /** @type {import("./manual/schema.mjs").ManualProblem[]} */
  const problems = [];
  const screenshotRoot = join(repoRoot, SCREENSHOT_DIRECTORY);
  const outputRoot = join(repoRoot, MANUAL_OUTPUT_DIRECTORY);

  if (!existsSync(screenshotRoot)) {
    problems.push({
      path: SCREENSHOT_DIRECTORY,
      message:
        "screenshot directory is missing; the manual has nothing to annotate",
    });
    return problems;
  }

  /** @type {Record<string, import("./manual/schema.mjs").ImageSize>} */
  let imageSizes = {};
  try {
    imageSizes = collectImageSizes(screenshotRoot);
  } catch (error) {
    problems.push({
      path: SCREENSHOT_DIRECTORY,
      message: `screenshots could not be measured: ${error instanceof Error ? error.message : String(error)}`,
    });
    return problems;
  }

  /** @type {readonly string[] | undefined} */
  let routes;
  try {
    routes = readNavigationRoutes(repoRoot);
  } catch (error) {
    problems.push({
      path: NAVIGATION_SOURCE,
      message: `route table could not be read: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  problems.push(
    ...validateCatalogue({
      tasks,
      categories,
      audiences,
      imageSizes,
      ...(routes === undefined ? {} : { routes }),
    }),
  );

  // A catalogue that does not validate cannot be rendered, and the errors from
  // trying would bury the ones that matter.
  if (problems.length > 0) return problems;

  // 1. The SVG overlays beside the screenshots are what the catalogue renders.
  for (const task of tasks) {
    const size = imageSizes[task.image];
    const expected = renderAnnotatedSvg({
      image: task.image,
      width: size.width,
      height: size.height,
      annotations: task.annotations,
      label: overlayLabel(task),
    });
    const file = join(screenshotRoot, `${task.image}-annotated.svg`);
    const shown = `${SCREENSHOT_DIRECTORY}/${task.image}-annotated.svg`;
    if (!existsSync(file)) {
      problems.push({
        path: shown,
        message: "overlay is missing; run pnpm manual:assets",
      });
      continue;
    }
    if (readFileSync(file, "utf8") !== expected) {
      problems.push({
        path: shown,
        message: "overlay does not match the catalogue; run pnpm manual:assets",
      });
    }
  }

  // 2. The Thai Markdown guide still points at every task's overlay, so a task
  //    added to the catalogue cannot go unmentioned in the document operators
  //    were trained on.
  const guideFile = join(repoRoot, MARKDOWN_GUIDE);
  if (!existsSync(guideFile)) {
    problems.push({ path: MARKDOWN_GUIDE, message: "guide is missing" });
  } else {
    const guide = readFileSync(guideFile, "utf8");
    for (const task of tasks) {
      if (!guide.includes(`${task.image}-annotated.svg`)) {
        problems.push({
          path: MARKDOWN_GUIDE,
          message: `does not reference ${task.image}-annotated.svg for task "${task.id}"`,
        });
      }
    }
  }

  // 3. The generated site is present, complete, and current.
  if (!existsSync(outputRoot)) {
    problems.push({
      path: MANUAL_OUTPUT_DIRECTORY,
      message: "generated manual is missing; run pnpm manual:build",
    });
    return problems;
  }

  const { files, images, overlays } = renderManualSite({
    tasks,
    categories,
    audiences,
    imageSizes,
  });

  for (const [path, content] of files) {
    const file = join(outputRoot, path);
    const shown = `${MANUAL_OUTPUT_DIRECTORY}/${path}`;
    if (!existsSync(file)) {
      problems.push({ path: shown, message: "missing; run pnpm manual:build" });
      continue;
    }
    if (readFileSync(file, "utf8") !== content) {
      problems.push({
        path: shown,
        message:
          "stale — it is not what the catalogue renders; run pnpm manual:build",
      });
    }
  }

  for (const asset of [...images.map((image) => `${image}.png`), ...overlays]) {
    const source = join(screenshotRoot, asset);
    const copy = join(outputRoot, `assets/images/${asset}`);
    const shown = `${MANUAL_OUTPUT_DIRECTORY}/assets/images/${asset}`;
    if (!existsSync(copy)) {
      problems.push({ path: shown, message: "missing; run pnpm manual:build" });
      continue;
    }
    if (!readFileSync(copy).equals(readFileSync(source))) {
      problems.push({
        path: shown,
        message: "differs from the committed screenshot; run pnpm manual:build",
      });
    }
  }

  const expectedPaths = new Set([
    GENERATED_MARKER,
    ...files.keys(),
    ...images.map((image) => `assets/images/${image}.png`),
    ...overlays.map((overlay) => `assets/images/${overlay}`),
  ]);
  for (const path of walk(outputRoot)) {
    if (expectedPaths.has(path)) continue;
    problems.push({
      path: `${MANUAL_OUTPUT_DIRECTORY}/${path}`,
      message: "left over from an older build; run pnpm manual:build",
    });
  }

  // 4. Absolute paths in the output would make it machine-specific, and a
  //    `file://` reader would follow a link into somebody else's home directory.
  for (const [path, content] of files) {
    if (content.includes(repoRoot)) {
      problems.push({
        path: `${MANUAL_OUTPUT_DIRECTORY}/${path}`,
        message: "contains an absolute path from the machine that generated it",
      });
    }
  }

  return problems;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  const problems = collectManualProblems();
  if (problems.length > 0) {
    process.stderr.write(
      `The operator manual has ${problems.length} problem(s):\n` +
        `${formatProblems(problems)}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `Operator manual verified: ${MANUAL_TASKS.length} task(s), ` +
      `${MANUAL_CATEGORIES.length} category(ies), catalogue, overlays, ` +
      "guide references, and generated output all agree.\n",
  );
}
