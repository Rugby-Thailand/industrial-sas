import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  overlayLabel,
  renderAnnotatedSvg,
  renderAnnotation,
  renderInlineOverlay,
  escapeXml,
} from "../../scripts/manual/annotations.mjs";
import {
  GENERATED_MARKER,
  GENERATED_MARKER_CONTENT,
  MANUAL_OUTPUT_DIRECTORY,
  SCREENSHOT_DIRECTORY,
  escapeHtml,
  renderManualSite,
} from "../../scripts/manual/html.mjs";
import {
  collectImageSizes,
  readPngSize,
} from "../../scripts/manual/images.mjs";
import {
  NAVIGATION_SOURCE,
  extractRoutes,
  readNavigationRoutes,
} from "../../scripts/manual/routes.mjs";
import {
  annotationExtent,
  resolveTaskRoute,
  validateCatalogue,
} from "../../scripts/manual/schema.mjs";
import {
  MANUAL_AUDIENCES,
  MANUAL_CATEGORIES,
  MANUAL_TASKS,
} from "../../scripts/manual/tasks.mjs";
import {
  MARKDOWN_GUIDE,
  collectManualProblems,
} from "../../scripts/verify-manual.mjs";

type CatalogueInput = Parameters<typeof validateCatalogue>[0];
type Task = CatalogueInput["tasks"][number];
type Problem = ReturnType<typeof validateCatalogue>[number];

const repoRoot = join(import.meta.dirname, "../..");
const screenshotRoot = join(repoRoot, SCREENSHOT_DIRECTORY);

/** Validate a deliberately malformed catalogue without arguing with the types. */
const validate = (input: unknown): readonly Problem[] =>
  validateCatalogue(input as CatalogueInput);

const messagesOf = (problems: readonly Problem[]): string =>
  problems.map((problem) => `${problem.path}: ${problem.message}`).join("\n");

const wellFormedTask = (): Record<string, unknown> => ({
  id: "demo-task",
  category: "demo",
  audience: "demo-audience",
  route: "/demo",
  image: "demo",
  title: { th: "งานทดสอบ", en: "Demo task" },
  summary: { th: "สรุปงานทดสอบ", en: "A demo summary." },
  prerequisites: [{ th: "ข้อกำหนดแรก", en: "First prerequisite" }],
  steps: [
    { th: "ขั้นตอนแรก", en: "First step" },
    { th: "ขั้นตอนที่สอง", en: "Second step" },
  ],
  success: [{ th: "สำเร็จแล้ว", en: "It worked." }],
  annotations: [
    { kind: "rect", step: 1, x: 100, y: 100, width: 200, height: 60 },
  ],
});

const fixture = (
  overrides: Record<string, unknown> = {},
  extra: Partial<CatalogueInput> = {},
): unknown => ({
  tasks: [{ ...wellFormedTask(), ...overrides }],
  categories: [{ id: "demo", th: "หมวดทดสอบ", en: "Demo" }],
  audiences: [{ id: "demo-audience", th: "ผู้ทดสอบ", en: "Tester" }],
  imageSizes: { demo: { width: 1000, height: 800 } },
  routes: ["/demo"],
  ...extra,
});

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop() ?? "", { recursive: true, force: true });
  }
});

const materialize = (tasks: readonly Task[] = MANUAL_TASKS): string => {
  const root = mkdtempSync(join(tmpdir(), "operator-manual-"));
  temporaryRoots.push(root);

  const write = (path: string, content: string): void => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  };

  copyFileSync(
    join(repoRoot, NAVIGATION_SOURCE),
    (mkdirSync(join(root, dirname(NAVIGATION_SOURCE)), { recursive: true }),
    join(root, NAVIGATION_SOURCE)),
  );

  const shots = join(root, SCREENSHOT_DIRECTORY);
  mkdirSync(shots, { recursive: true });
  for (const image of new Set(tasks.map((task) => task.image))) {
    copyFileSync(
      join(screenshotRoot, `${image}.png`),
      join(shots, `${image}.png`),
    );
  }
  const imageSizes = collectImageSizes(shots);
  for (const task of tasks) {
    const size = imageSizes[task.image];
    if (size === undefined) throw new Error(`no size for ${task.image}`);
    write(
      `${SCREENSHOT_DIRECTORY}/${task.image}-annotated.svg`,
      renderAnnotatedSvg({
        image: task.image,
        width: size.width,
        height: size.height,
        annotations: task.annotations,
        label: overlayLabel(task),
      }),
    );
  }

  write(
    MARKDOWN_GUIDE,
    tasks
      .map(
        (task) =>
          `![${task.title.th}](./assets/operator-guide-th/${task.image}-annotated.svg)`,
      )
      .join("\n\n"),
  );

  const { files, images, overlays } = renderManualSite({
    tasks,
    categories: MANUAL_CATEGORIES,
    audiences: MANUAL_AUDIENCES,
    imageSizes,
  });
  for (const [path, content] of files) {
    write(`${MANUAL_OUTPUT_DIRECTORY}/${path}`, content);
  }
  for (const asset of [...images.map((image) => `${image}.png`), ...overlays]) {
    const destination = join(
      root,
      MANUAL_OUTPUT_DIRECTORY,
      "assets/images",
      asset,
    );
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(shots, asset), destination);
  }
  write(
    `${MANUAL_OUTPUT_DIRECTORY}/${GENERATED_MARKER}`,
    GENERATED_MARKER_CONTENT,
  );

  return root;
};

describe("the shipped operator-manual catalogue", () => {
  const imageSizes = collectImageSizes(screenshotRoot);
  const routes = readNavigationRoutes(repoRoot);

  it("satisfies every rule the generators rely on", () => {
    const problems = validateCatalogue({
      tasks: MANUAL_TASKS,
      categories: MANUAL_CATEGORIES,
      audiences: MANUAL_AUDIENCES,
      imageSizes,
      routes,
    });
    expect(messagesOf(problems)).toBe("");
  });

  it("documents exactly the thirteen workflows of the Thai guide", () => {
    expect(MANUAL_TASKS).toHaveLength(13);
    expect(new Set(MANUAL_TASKS.map((task) => task.id)).size).toBe(13);
  });

  it("points every task at a committed screenshot and a real route", () => {
    for (const task of MANUAL_TASKS) {
      expect(existsSync(join(screenshotRoot, `${task.image}.png`))).toBe(true);
      expect(routes).toContain(resolveTaskRoute(task.route).basePath);
    }
  });

  it("numbers each annotation with the step it belongs to", () => {
    for (const task of MANUAL_TASKS) {
      for (const annotation of task.annotations) {
        expect(annotation.step).toBeGreaterThanOrEqual(1);
        expect(annotation.step).toBeLessThanOrEqual(task.steps.length);
      }
    }
  });
});

describe("the catalogue validator", () => {
  it("accepts a well-formed catalogue", () => {
    expect(validate(fixture())).toEqual([]);
  });

  it("names a duplicate task id and the entry that claimed it first", () => {
    const problems = validate({
      ...(fixture() as { tasks: unknown[] }),
      tasks: [wellFormedTask(), wellFormedTask()],
    });
    expect(messagesOf(problems)).toContain('duplicate task id "demo-task"');
    expect(messagesOf(problems)).toContain("tasks[0]");
  });

  it("refuses two tasks that would overwrite the same screenshot overlay", () => {
    const second = { ...wellFormedTask(), id: "second-task" };
    const problems = validate({
      ...(fixture() as { tasks: unknown[] }),
      tasks: [wellFormedTask(), second],
    });
    expect(messagesOf(problems)).toContain(
      'screenshot "demo.png" is already used by tasks[0]',
    );
  });

  it("refuses an annotation that points past the last step", () => {
    const problems = validate(
      fixture({
        annotations: [
          { kind: "rect", step: 7, x: 10, y: 10, width: 50, height: 50 },
        ],
      }),
    );
    expect(messagesOf(problems)).toContain(
      "points at step 7, but this task has 2",
    );
  });

  it("refuses two annotations on one step", () => {
    const problems = validate(
      fixture({
        annotations: [
          { kind: "rect", step: 1, x: 10, y: 10, width: 50, height: 50 },
          { kind: "rect", step: 1, x: 90, y: 90, width: 50, height: 50 },
        ],
      }),
    );
    expect(messagesOf(problems)).toContain("step 1 is already annotated");
  });

  it("refuses annotations listed out of step order", () => {
    const problems = validate(
      fixture({
        annotations: [
          { kind: "rect", step: 2, x: 10, y: 10, width: 50, height: 50 },
          { kind: "rect", step: 1, x: 90, y: 90, width: 50, height: 50 },
        ],
      }),
    );
    expect(messagesOf(problems)).toContain("out of order");
  });

  it("refuses a rectangle that leaves the screenshot", () => {
    const problems = validate(
      fixture({
        annotations: [
          { kind: "rect", step: 1, x: 900, y: 100, width: 400, height: 60 },
        ],
      }),
    );
    expect(messagesOf(problems)).toContain("falls outside demo.png (1000×800)");
  });

  it("refuses a box whose number badge would be cropped", () => {
    const problems = validate(
      fixture({
        annotations: [
          { kind: "rect", step: 1, x: 0, y: 0, width: 200, height: 60 },
        ],
      }),
    );
    expect(messagesOf(problems)).toContain("falls outside");
  });

  it("accepts an underline and refuses one carrying a height", () => {
    expect(
      validate(
        fixture({
          annotations: [
            { kind: "underline", step: 2, x: 120, y: 300, width: 210 },
          ],
        }),
      ),
    ).toEqual([]);

    const problems = validate(
      fixture({
        annotations: [
          { kind: "underline", step: 2, x: 120, y: 300, width: 210, height: 4 },
        ],
      }),
    );
    expect(messagesOf(problems)).toContain("an underline has no height");
  });

  it("refuses an unknown kind of mark", () => {
    const problems = validate(
      fixture({
        annotations: [{ kind: "circle", step: 1, x: 1, y: 1, width: 2 }],
      }),
    );
    expect(messagesOf(problems)).toContain('must be "rect" or "underline"');
  });

  it("reports a missing screenshot and an unused one", () => {
    const missing = validate(fixture({ image: "absent" }));
    expect(messagesOf(missing)).toContain("no screenshot named absent.png");

    const unused = validate(
      fixture({}, {
        imageSizes: {
          demo: { width: 1000, height: 800 },
          orphan: { width: 10, height: 10 },
        },
      } as Partial<CatalogueInput>),
    );
    expect(messagesOf(unused)).toContain(
      "images/orphan.png: screenshot is not referenced by any task",
    );
  });

  it("refuses a route the application does not have", () => {
    const problems = validate(fixture({ route: "/renamed" }));
    expect(messagesOf(problems)).toContain("not in the navigation route table");
  });

  it("accepts a detail route once its parameters are stripped", () => {
    expect(
      validate(
        fixture({ route: "/demo/{receiptId}" }, {
          routes: ["/demo"],
        } as Partial<CatalogueInput>),
      ),
    ).toEqual([]);
  });

  it("catches a missing translation in either direction", () => {
    const englishMissing = validate(
      fixture({ summary: { th: "สรุปงานทดสอบ", en: "สรุปงานทดสอบ" } }),
    );
    expect(messagesOf(englishMissing)).toContain("contains Thai characters");

    const thaiMissing = validate(
      fixture({ summary: { th: "A demo summary.", en: "A demo summary." } }),
    );
    expect(messagesOf(thaiMissing)).toContain("contains no Thai characters");

    const empty = validate(fixture({ title: { th: "งาน", en: "  " } }));
    expect(messagesOf(empty)).toContain(
      "tasks[0].title.en: must be a non-empty",
    );
  });

  it("refuses an undeclared category or audience", () => {
    expect(messagesOf(validate(fixture({ category: "invented" })))).toContain(
      "is not a declared category",
    );
    expect(messagesOf(validate(fixture({ audience: "nobody" })))).toContain(
      "is not a declared audience",
    );
  });

  it("requires prerequisites, steps, success criteria, and annotations", () => {
    for (const field of [
      "prerequisites",
      "steps",
      "success",
      "annotations",
    ] as const) {
      const problems = validate(fixture({ [field]: [] }));
      expect(messagesOf(problems)).toContain(`tasks[0].${field}`);
    }
  });
});

describe("route resolution", () => {
  it("strips {param} segments", () => {
    expect(resolveTaskRoute("/receiving/{receiptId}")).toEqual({
      basePath: "/receiving",
      parameters: ["receiptId"],
    });
    expect(resolveTaskRoute("/reports")).toEqual({
      basePath: "/reports",
      parameters: [],
    });
  });

  it("reads the application route table rather than a second copy of it", () => {
    const routes = readNavigationRoutes(repoRoot);
    expect(routes).toContain("/dashboard");
    expect(routes).toContain("/inventory/balances");
  });

  it("ignores paths that only appear in prose", () => {
    const source = [
      "// Comment mentioning /not-a-route and /neither-is-this.",
      'export const ROUTES = Object.freeze({ dashboard: "/dashboard" });',
    ].join("\n");
    expect(extractRoutes(source, "fake.ts")).toEqual(["/dashboard"]);
  });

  it("fails loudly when the route table is not where it should be", () => {
    expect(() => extractRoutes("export const OTHER = {};", "fake.ts")).toThrow(
      /declares no ROUTES object literal/,
    );
  });
});

describe("screenshot measurement", () => {
  it("reads the real pixel size from the PNG header", () => {
    expect(readPngSize(join(screenshotRoot, "dashboard.png"))).toEqual({
      width: 1280,
      height: 2007,
    });
  });

  it("refuses a file that is not a PNG", () => {
    const root = mkdtempSync(join(tmpdir(), "operator-manual-png-"));
    temporaryRoots.push(root);
    const file = join(root, "not-an-image.png");
    writeFileSync(file, "GIF89a and then some", "utf8");
    expect(() => readPngSize(file)).toThrow(/is not a PNG file/);
  });

  it("measures every committed screenshot", () => {
    const sizes = collectImageSizes(screenshotRoot);
    expect(Object.keys(sizes)).toHaveLength(MANUAL_TASKS.length);
    for (const size of Object.values(sizes)) {
      expect(size.width).toBe(1280);
      expect(size.height).toBeGreaterThan(0);
    }
  });
});

describe("annotation rendering", () => {
  it("draws a red rectangle numbered with its step", () => {
    const svg = renderAnnotation({
      kind: "rect",
      step: 3,
      x: 278,
      y: 905,
      width: 980,
      height: 115,
    });
    expect(svg).toContain('<rect x="278" y="905" width="980" height="115"');
    expect(svg).toContain('stroke="#ff3b30" stroke-width="7"');
    expect(svg).toContain('<circle cx="286" cy="913" r="22"');
    expect(svg).toContain(">3</text>");
  });

  it("draws an underline as a line, not a flattened box", () => {
    const svg = renderAnnotation({
      kind: "underline",
      step: 2,
      x: 320,
      y: 742,
      width: 210,
    });
    expect(svg).toContain('<line x1="320" y1="742" x2="530" y2="742"');
    expect(svg).toContain('stroke-width="8"');
    expect(svg).not.toContain("<rect");
    expect(svg).toContain(">2</text>");
  });

  it("frames the standalone overlay at the measured size of its PNG", () => {
    const svg = renderAnnotatedSvg({
      image: "putaway",
      width: 1280,
      height: 1437,
      annotations: [
        { kind: "rect", step: 1, x: 10, y: 10, width: 20, height: 20 },
      ],
      label: "ทดสอบ",
    });
    expect(svg).toContain('viewBox="0 0 1280 1437"');
    expect(svg).toContain('href="putaway.png"');
    expect(svg).toContain('aria-label="ทดสอบ"');
  });

  it("escapes a label that contains markup", () => {
    expect(escapeXml('a & b <c> "d"')).toBe(
      "a &amp; b &lt;c&gt; &quot;d&quot;",
    );
    expect(
      renderAnnotatedSvg({
        image: "demo",
        width: 10,
        height: 10,
        annotations: [{ kind: "underline", step: 1, x: 1, y: 5, width: 4 }],
        label: 'Ampersand & "quote"',
      }),
    ).toContain('aria-label="Ampersand &amp; &quot;quote&quot;"');
  });

  it("hides the inline overlay from assistive technology", () => {
    const overlay = renderInlineOverlay({
      width: 100,
      height: 50,
      annotations: [
        { kind: "rect", step: 1, x: 30, y: 30, width: 10, height: 10 },
      ],
    });
    expect(overlay).toContain('aria-hidden="true"');
    expect(overlay).toContain('viewBox="0 0 100 50"');
    expect(overlay).not.toContain("<image");
  });

  it("keeps the badge extent in the geometry the validator checks", () => {
    expect(
      annotationExtent({
        kind: "rect",
        step: 1,
        x: 100,
        y: 100,
        width: 40,
        height: 20,
      }),
    ).toEqual({ left: 86, top: 86, right: 143.5, bottom: 130 });
  });
});

describe("the generated HTML manual", () => {
  const imageSizes = collectImageSizes(screenshotRoot);
  const site = renderManualSite({
    tasks: MANUAL_TASKS,
    categories: MANUAL_CATEGORIES,
    audiences: MANUAL_AUDIENCES,
    imageSizes,
  });

  it("writes an index, shared assets, and one page per task", () => {
    expect([...site.files.keys()].sort()).toEqual(
      [
        "assets/manual.css",
        "assets/manual.js",
        "index.html",
        ...MANUAL_TASKS.map((task) => `tasks/${task.id}.html`),
      ].sort(),
    );
    expect(site.images).toHaveLength(MANUAL_TASKS.length);
  });

  it("gives the index a filterable card for every task", () => {
    const index = site.files.get("index.html") ?? "";
    for (const task of MANUAL_TASKS) {
      expect(index).toContain(`data-task-id="${task.id}"`);
      expect(index).toContain(`href="tasks/${task.id}.html"`);
      expect(index).toContain(`data-category="${task.category}"`);
    }
    expect(index).toContain("data-manual-search");
    expect(index).toContain("data-manual-category");
    expect(index).toContain('role="search"');
  });

  it("carries both languages in one document, defaulting to Thai", () => {
    const page = site.files.get("tasks/export-data.html") ?? "";
    expect(page).toContain('<html lang="th" class="lang-th"');
    expect(page).toContain(
      '<span lang="th" data-lang="th">ส่งออกข้อมูล</span>',
    );
    expect(page).toContain('<span lang="en" data-lang="en">Export data</span>');
    expect(site.files.get("assets/manual.css")).toContain(
      'html.lang-th [data-lang="en"]',
    );
  });

  it("shows the audience, prerequisites, numbered steps, and success criteria", () => {
    const task = MANUAL_TASKS.find(
      (one) => one.id === "claim-and-confirm-putaway",
    );
    const page = site.files.get("tasks/claim-and-confirm-putaway.html") ?? "";
    expect(page).toContain("ผู้ปฏิบัติงาน");
    expect(page).toContain(task?.prerequisites[0]?.th ?? "");
    expect(page).toContain(task?.success[0]?.en ?? "");
    expect(page).toContain('<ol class="steps" role="list">');

    expect(page).toContain('<li class="step annotated" data-step="1">');
    expect(page).toContain('<li class="step" data-step="2">');
    expect(page).toContain('<li class="step annotated" data-step="3">');
  });

  it("displays the annotated screenshot as an image with an overlay above it", () => {
    const page = site.files.get("tasks/start-and-choose-warehouse.html") ?? "";
    expect(page).toContain('src="../assets/images/dashboard.png"');
    expect(page).toContain('width="1280"');
    expect(page).toContain('height="2007"');
    expect(page).toContain('<svg class="overlay" viewBox="0 0 1280 2007"');
    expect(page).toContain('stroke="#ff3b30"');

    expect(page).toContain('href="../assets/images/dashboard-annotated.svg"');
    expect(page).not.toContain(
      'src="../assets/images/dashboard-annotated.svg"',
    );
    expect(site.overlays).toContain("dashboard-annotated.svg");
  });

  it("links only relative paths, so file:// works", () => {
    for (const [path, content] of site.files) {
      if (!path.endsWith(".html")) continue;
      expect(content).not.toContain('href="/');
      expect(content).not.toContain('src="/');
      expect(content).not.toContain("file://");
    }
  });

  it("escapes catalogue text instead of trusting it", () => {
    const { files } = renderManualSite({
      tasks: [
        {
          ...wellFormedTask(),
          title: { th: "<script>งาน</script>", en: "Tools & <b>tips</b>" },
        } as unknown as Task,
      ],
      categories: [{ id: "demo", th: "หมวดทดสอบ", en: "Demo" }],
      audiences: [{ id: "demo-audience", th: "ผู้ทดสอบ", en: "Tester" }],
      imageSizes: { demo: { width: 1000, height: 800 } },
    });
    const page = files.get("tasks/demo-task.html") ?? "";
    expect(page).toContain("&lt;script&gt;งาน&lt;/script&gt;");
    expect(page).toContain("Tools &amp; &lt;b&gt;tips&lt;/b&gt;");
    expect(page).not.toContain("<script>งาน");
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });

  it("is deterministic — no timestamps, no machine paths", () => {
    const again = renderManualSite({
      tasks: MANUAL_TASKS,
      categories: MANUAL_CATEGORIES,
      audiences: MANUAL_AUDIENCES,
      imageSizes,
    });
    expect([...again.files]).toEqual([...site.files]);
    for (const content of site.files.values()) {
      expect(content).not.toContain(repoRoot);
    }
  });
});

describe("the manual guard", () => {
  it("passes against a repository generated from the shipped catalogue", () => {
    expect(messagesOf(collectManualProblems({ repoRoot: materialize() }))).toBe(
      "",
    );
  });

  it("reports a task page that was never generated", () => {
    const root = materialize();
    rmSync(join(root, MANUAL_OUTPUT_DIRECTORY, "tasks/export-data.html"));
    expect(messagesOf(collectManualProblems({ repoRoot: root }))).toContain(
      "tasks/export-data.html: missing; run pnpm manual:build",
    );
  });

  it("reports a page whose content no longer matches the catalogue", () => {
    const root = materialize();
    const page = join(root, MANUAL_OUTPUT_DIRECTORY, "index.html");
    writeFileSync(page, `${readFileSync(page, "utf8")}<!-- edited by hand -->`);
    expect(messagesOf(collectManualProblems({ repoRoot: root }))).toContain(
      "stale — it is not what the catalogue renders",
    );
  });

  it("reports a file left behind by an older build", () => {
    const root = materialize();
    writeFileSync(
      join(root, MANUAL_OUTPUT_DIRECTORY, "tasks/removed-task.html"),
      "old",
      "utf8",
    );
    expect(messagesOf(collectManualProblems({ repoRoot: root }))).toContain(
      "left over from an older build",
    );
  });

  it("reports an overlay that does not match the catalogue", () => {
    const root = materialize();
    const overlay = join(root, SCREENSHOT_DIRECTORY, "putaway-annotated.svg");
    writeFileSync(
      overlay,
      readFileSync(overlay, "utf8").replace('y="905"', 'y="900"'),
      "utf8",
    );
    expect(messagesOf(collectManualProblems({ repoRoot: root }))).toContain(
      "overlay does not match the catalogue; run pnpm manual:assets",
    );
  });

  it("reports a screenshot copy that drifted from the committed original", () => {
    const root = materialize();
    writeFileSync(
      join(root, MANUAL_OUTPUT_DIRECTORY, "assets/images/reports.png"),
      readFileSync(join(screenshotRoot, "quality.png")),
    );
    expect(messagesOf(collectManualProblems({ repoRoot: root }))).toContain(
      "differs from the committed screenshot",
    );
  });

  it("reports a task the Thai guide never mentions", () => {
    const root = materialize();
    const guide = join(root, MARKDOWN_GUIDE);
    writeFileSync(
      guide,
      readFileSync(guide, "utf8").replace("quality-annotated.svg", "other.svg"),
      "utf8",
    );
    expect(messagesOf(collectManualProblems({ repoRoot: root }))).toContain(
      "does not reference quality-annotated.svg",
    );
  });

  it("reports the whole generated manual being absent", () => {
    const root = materialize();
    rmSync(join(root, MANUAL_OUTPUT_DIRECTORY), {
      recursive: true,
      force: true,
    });
    expect(messagesOf(collectManualProblems({ repoRoot: root }))).toContain(
      "generated manual is missing; run pnpm manual:build",
    );
  });
});
