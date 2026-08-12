/**
 * The colour tokens, checked against WCAG 2.2 by measurement rather than by
 * comment.
 *
 * `globals.css` states an invariant about itself — "every foreground below
 * clears 4.5:1 against the surface it is used on, in both schemes" — and until
 * this file existed nothing checked it. It was not true: the primary button's
 * hover fill was written as `bg-primary/80`, an *alpha* modifier, so the accent
 * was composited against the light surface behind it and white-on-accent
 * measured 4.34:1. Nothing failed, because the only thing asserting the claim
 * was the sentence making it.
 *
 * So the palette is parsed out of the stylesheet — not restated here, which
 * would be a second copy to forget — and every pair a component actually paints
 * is measured in both schemes.
 *
 * ### Thresholds
 *
 * - **4.5:1** for text (`WCAG 2.2` 1.4.3 AA). Every foreground here is used at
 *   `text-sm`/`text-xs`, which is never "large text", so the large-text 3:1
 *   allowance does not apply to anything below.
 * - **3:1** for a non-text boundary or indicator (1.4.11) — the focus ring and
 *   `border-strong`.
 *
 * ### What is deliberately not asserted
 *
 * `--token-disabled` measures 4.42:1 on `canvas` and 4.11:1 on `raised` in the
 * light scheme. That is *not* a violation and it is not fixed here: 1.4.3
 * exempts text that is part of an inactive control, and lifting the token until
 * it passed would make a disabled control look enabled, which is a worse
 * failure than the one being avoided. It is called out rather than silently
 * omitted so the next person does not "fix" it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const STYLESHEET = join(process.cwd(), "src", "app", "globals.css");

type Palette = Readonly<Record<string, string>>;

/**
 * Every `--token-*: #rrggbb` declaration inside one block of the stylesheet.
 *
 * Hex only, on purpose: the palette is authored in hex and a token that turned
 * up as `oklch(...)` or a `var()` alias would silently contribute nothing to a
 * regex that skipped it. Anything unparseable therefore has to fail the count
 * assertion below rather than quietly reduce coverage.
 */
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
/* The dark block overrides a subset in principle; spreading keeps any it omits. */
const dark: Palette = { ...light, ...tokensIn(blockAfter(css, darkAt)) };

/* -------------------------------------------------------------------------- */
/* WCAG 2.x relative luminance and contrast                                    */
/* -------------------------------------------------------------------------- */

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
};

const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x!, y!) + 0.05) / (Math.min(x!, y!) + 0.05);
};

/** One pair a component paints, and the rule it has to satisfy. */
interface Pair {
  readonly foreground: string;
  readonly background: string;
  readonly minimum: 3 | 4.5;
  /** Where this combination is rendered, so a failure names something real. */
  readonly where: string;
}

const SURFACES = ["canvas", "surface", "raised"] as const;

/** Foregrounds used as *text* on the three page surfaces. */
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
    /*
     * The regression this file was written for. An opaque hover token is what
     * makes this measurable at all — an alpha fill has no single answer, because
     * its value depends on whatever surface the button was placed on.
     */
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
    // A regex that stopped matching would otherwise turn every assertion above
    // into a vacuous pass over an empty palette.
    expect(Object.keys(light).length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(dark).length).toBe(Object.keys(light).length);
  });

  it("gives the dark scheme its own value for every token, not the light one", () => {
    const shared = Object.keys(light).filter(
      (name) => light[name] === dark[name],
    );
    // `accent-contrast` is white in light and near-black in dark, and so on:
    // no token should carry a light value into the dark scheme by accident.
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
});
