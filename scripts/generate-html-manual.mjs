import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { collectImageSizes } from "./manual/images.mjs";
import {
  GENERATED_MARKER,
  GENERATED_MARKER_CONTENT,
  MANUAL_OUTPUT_DIRECTORY,
  SCREENSHOT_DIRECTORY,
  renderManualSite,
} from "./manual/html.mjs";
import { readNavigationRoutes } from "./manual/routes.mjs";
import { formatProblems, validateCatalogue } from "./manual/schema.mjs";
import {
  MANUAL_AUDIENCES,
  MANUAL_CATEGORIES,
  MANUAL_TASKS,
} from "./manual/tasks.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(repoRoot, MANUAL_OUTPUT_DIRECTORY);
const screenshotRoot = join(repoRoot, SCREENSHOT_DIRECTORY);

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (!existsSync(screenshotRoot)) {
  fail(`Screenshot directory not found: ${SCREENSHOT_DIRECTORY}`);
}

const imageSizes = collectImageSizes(screenshotRoot);
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

const { files, images, overlays } = renderManualSite({
  tasks: MANUAL_TASKS,
  categories: MANUAL_CATEGORIES,
  audiences: MANUAL_AUDIENCES,
  imageSizes,
});

if (existsSync(outputRoot)) {
  if (!statSync(outputRoot).isDirectory()) {
    fail(
      `${MANUAL_OUTPUT_DIRECTORY} exists but is not a directory.\n` +
        "Refusing to replace it; move it aside and run again.",
    );
  }
  const entries = readdirSync(outputRoot);
  const marker = join(outputRoot, GENERATED_MARKER);
  const ownsOutput =
    entries.length === 0 ||
    (existsSync(marker) &&
      statSync(marker).isFile() &&
      readFileSync(marker, "utf8") === GENERATED_MARKER_CONTENT);
  if (!ownsOutput) {
    fail(
      `${MANUAL_OUTPUT_DIRECTORY} exists, is not empty, and has no valid ${GENERATED_MARKER} marker.\n` +
        "Refusing to delete a directory this script did not create. Move it aside and run again.",
    );
  }
  rmSync(outputRoot, { recursive: true, force: true });
}

for (const [path, content] of files) {
  const destination = join(outputRoot, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, "utf8");
}

const imageRoot = join(outputRoot, "assets/images");
mkdirSync(imageRoot, { recursive: true });
for (const asset of [...images.map((image) => `${image}.png`), ...overlays]) {
  copyFileSync(join(screenshotRoot, asset), join(imageRoot, asset));
}

writeFileSync(
  join(outputRoot, GENERATED_MARKER),
  GENERATED_MARKER_CONTENT,
  "utf8",
);

process.stdout.write(
  `Generated ${MANUAL_OUTPUT_DIRECTORY} — ` +
    `${files.size} text file(s), ${images.length} screenshot(s), ` +
    `${MANUAL_TASKS.length} task page(s).\n`,
);
