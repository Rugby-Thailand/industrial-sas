import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const STYLESHEET = join(process.cwd(), "src", "app", "globals.css");

type Palette = Readonly<Record<string, string>>;

function tokensIn(block: string): Palette {
  const found: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(
    /--token-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    found[name!] = value!.toLowerCase();
  }
  return found;
}

/** The `:root` body at a given offset, matched by brace depth rather than by regex. */
function blockAfter(source: string, from: number): string {
  const open = source.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error("Unbalanced braces in globals.css");
}

const css = readFileSync(STYLESHEET, "utf8");

const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
if (darkAt < 0) throw new Error("No dark colour-scheme block in globals.css");

const light = tokensIn(blockAfter(css, css.indexOf(":root")));

const dark: Palette = { ...light, ...tokensIn(blockAfter(css, darkAt)) };

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
};

const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x!, y!) + 0.05) / (Math.min(x!, y!) + 0.05);
};

interface Pair {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: 3 | 4.5;

  readonly where: string;
}

const SURFACES = ["canvas", "surface", "raised", "overlay"] as const;

const TEXT_ON_SURFACES = [
  "text",
  "muted",
  "accent",
  "success",
  "warning",
  "danger",
  "pending",
] as const;

const PAIRS: readonly Pair[] = [
  ...SURFACES.flatMap((background) =>
    TEXT_ON_SURFACES.map((foreground): Pair => ({
      foreground,
      background,
      minimum: 4.5,
      where: `text-${foreground} on bg-${background}`,
    })),
  ),
  {
    foreground: "accent-contrast",
    background: "accent",
    minimum: 4.5,
    where: "Button variant=default at rest, and a highlighted SelectItem",
  },
  {
    foreground: "accent-contrast",
    background: "accent-hover",
    minimum: 4.5,
    where: "Button variant=default on hover",
  },
  {
    foreground: "danger-contrast",
    background: "danger",
    minimum: 4.5,
    where: "text printed on a solid danger fill",
  },
  ...(
    [
      ["accent", "accent-surface"],
      ["success", "success-surface"],
      ["warning", "warning-surface"],
      ["danger", "danger-surface"],
      ["pending", "pending-surface"],
    ] as const
  ).map(([foreground, background]): Pair => ({
    foreground,
    background,
    minimum: 4.5,
    where: `semantic text-${foreground} on bg-${background}`,
  })),
  {
    foreground: "disabled",
    background: "disabled-surface",
    minimum: 3,
    where: "disabled button text on its dedicated disabled fill",
  },
  ...(["band-empty", "band-light", "band-busy", "band-full"] as const).map(
    (background): Pair => ({
      foreground: background === "band-empty" ? "muted" : "text",
      background,
      minimum: 4.5,
      where: `OccupancyMap cell (${background})`,
    }),
  ),
  ...SURFACES.map((background): Pair => ({
    foreground: "accent",
    background,
    minimum: 3,
    where: `the global :focus-visible ring over ${background}`,
  })),
  {
    foreground: "border-strong",
    background: "surface",
    minimum: 3,
    where: "the border of an interactive control (border-input)",
  },
  {
    foreground: "border-strong",
    background: "overlay",
    minimum: 3,
    where: "the border of an interactive control on an elevated overlay",
  },
];

describe.each([
  ["light", light],
  ["dark", dark],
])("colour tokens (%s scheme)", (scheme, palette) => {
  it("declares every token the pairs below reference", () => {
    const referenced = new Set(
      PAIRS.flatMap((pair) => [pair.foreground, pair.background]),
    );
    const missing = [...referenced].filter((name) => !(name in palette));
    expect(missing, `undeclared --token-* in the ${scheme} scheme`).toEqual([]);
  });

  it.each(PAIRS)(
    "$where clears $minimum:1",
    ({ foreground, background, minimum }) => {
      const ratio = contrast(palette[foreground]!, palette[background]!);
      expect(
        Number(ratio.toFixed(2)),
        `--token-${foreground} (${palette[foreground]}) on --token-${background} (${palette[background]})`,
      ).toBeGreaterThanOrEqual(minimum);
    },
  );
});

describe("the stylesheet itself", () => {
  it("parses both schemes rather than silently measuring nothing", () => {
    expect(Object.keys(light).length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(dark).length).toBe(Object.keys(light).length);
  });

  it("gives the dark scheme its own value for every token, not the light one", () => {
    const shared = Object.keys(light).filter(
      (name) => light[name] === dark[name],
    );

    expect(shared).toEqual([]);
  });

  it("keeps the hover fill distinguishable from the resting fill", () => {
    // A hover state that clears 4.5:1 but looks identical to rest is a hover
    // state an operator cannot see. Both schemes must actually move.
    for (const [scheme, palette] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      expect(palette["accent-hover"], scheme).not.toBe(palette["accent"]);
      expect(
        contrast(palette["accent-hover"]!, palette["accent"]!),
        `${scheme}: accent-hover against accent`,
      ).toBeGreaterThan(1.1);
    }
  });

  it("keeps dark elevation layers visibly distinct", () => {
    const layers = [
      ["surface", "canvas", 1.15],
      ["raised", "surface", 1.15],
      ["overlay", "raised", 1.15],
      ["border", "surface", 2],
    ] as const;

    for (const [foreground, background, minimum] of layers) {
      expect(
        contrast(dark[foreground]!, dark[background]!),
        `${foreground} against ${background}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  });
});
