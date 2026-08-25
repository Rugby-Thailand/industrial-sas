import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { overlayLabel, renderAnnotatedSvg } from "./manual/annotations.mjs";
import { collectImageSizes, readPngSize } from "./manual/images.mjs";
import { readNavigationRoutes } from "./manual/routes.mjs";
import { formatProblems, validateCatalogue } from "./manual/schema.mjs";
import { SCREENSHOT_DIRECTORY } from "./manual/html.mjs";
import {
  MANUAL_AUDIENCES,
  MANUAL_CATEGORIES,
  MANUAL_TASKS,
} from "./manual/tasks.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(repoRoot, SCREENSHOT_DIRECTORY);

const captureName = (image) => `${image}--th--desktop-1280.png`;

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const sourceArgument = process.argv[2];

mkdirSync(outputRoot, { recursive: true });

if (sourceArgument !== undefined) {
  const sourceRoot = resolve(sourceArgument);
  if (!existsSync(sourceRoot)) {
    fail(
      `Capture directory not found: ${sourceRoot}\n` +
        "Run without an argument to re-render overlays over the committed screenshots.",
    );
  }
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const unreadable = [];
  /** @type {Record<string, import("./manual/schema.mjs").ImageSize>} */
  const captureSizes = {};
  for (const task of MANUAL_TASKS) {
    const from = join(sourceRoot, captureName(task.image));
    if (!existsSync(from)) {
      missing.push(captureName(task.image));
      continue;
    }

    try {
      captureSizes[task.image] = readPngSize(from);
    } catch (error) {
      unreadable.push(
        `${captureName(task.image)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (missing.length > 0 || unreadable.length > 0) {
    fail(
      `Capture directory ${sourceRoot} is not usable:\n` +
        missing.map((name) => `  missing: ${name}`).join("\n") +
        (missing.length > 0 && unreadable.length > 0 ? "\n" : "") +
        unreadable.map((line) => `  invalid: ${line}`).join("\n"),
    );
  }
  const captureProblems = validateCatalogue({
    tasks: MANUAL_TASKS,
    categories: MANUAL_CATEGORIES,
    audiences: MANUAL_AUDIENCES,
    imageSizes: captureSizes,
    routes: readNavigationRoutes(repoRoot),
  });
  if (captureProblems.length > 0) {
    fail(
      `The capture set has ${captureProblems.length} problem(s):\n` +
        `${formatProblems(captureProblems)}\n` +
        "No committed screenshot was replaced.",
    );
  }
  // Preflight the complete capture set before replacing any committed image.
  // A typo, malformed PNG, or annotation outside a changed viewport must not
  // leave a mixed old/new set.
  for (const task of MANUAL_TASKS) {
    copyFileSync(
      join(sourceRoot, captureName(task.image)),
      join(outputRoot, `${task.image}.png`),
    );
  }
  process.stdout.write(
    `Refreshed ${MANUAL_TASKS.length} screenshots from ${sourceRoot}.\n`,
  );
}

const imageSizes = collectImageSizes(outputRoot);
const problems = validateCatalogue({
  tasks: MANUAL_TASKS,
  categories: MANUAL_CATEGORIES,
  audiences: MANUAL_AUDIENCES,
  imageSizes,
  routes: readNavigationRoutes(repoRoot),
});

if (problems.length > 0) {
  fail(
    `The operator-manual catalogue has ${problems.length} problem(s):\n` +
      `${formatProblems(problems)}\n` +
      "Nothing was written. Fix scripts/manual/tasks.mjs and run again.",
  );
}

for (const task of MANUAL_TASKS) {
  const size = imageSizes[task.image];
  const svg = renderAnnotatedSvg({
    image: task.image,
    width: size.width,
    height: size.height,
    annotations: task.annotations,
    label: overlayLabel(task),
  });
  writeFileSync(join(outputRoot, `${task.image}-annotated.svg`), svg, "utf8");
}

process.stdout.write(
  `Generated ${MANUAL_TASKS.length} annotated overlays in ${SCREENSHOT_DIRECTORY}.\n`,
);
