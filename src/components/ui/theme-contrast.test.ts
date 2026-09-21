// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read the shipped palette, so changing an imported theme cannot silently regress
// the contrast of small status labels, links, controls, or keyboard focus.
const css = readFileSync("src/app/globals.css", "utf8");
const declarations = (selector: string): Record<string, string> => {
  const block = css.split(`${selector} {`)[1]?.split("}")[0];
  if (!block) throw new Error(`Missing ${selector} palette`);
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
};
const light = declarations(":root");
const themes = { light, dark: { ...light, ...declarations(".dark") } };

type LinearRGB = readonly [number, number, number];
const linear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

function color(token: string, palette: Record<string, string>): LinearRGB {
  const value = palette[token];
  if (!value) throw new Error(`Missing color ${token}`);
  const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (reference) return color(reference, palette);
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return [
      linear(parseInt(value.slice(1, 3), 16) / 255),
      linear(parseInt(value.slice(3, 5), 16) / 255),
      linear(parseInt(value.slice(5, 7), 16) / 255),
    ];
  }
  const match = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (!match) throw new Error(`Unsupported palette color: ${value}`);
  const l = Number(match[1]);
  const c = Number(match[2]);
  const h = (Number(match[3]) * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const ss = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
  return [
    clamp(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss),
    clamp(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss),
    clamp(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss),
  ];
}

function contrast(foreground: LinearRGB, background: LinearRGB): number {
  const luminance = ([r, g, b]: LinearRGB) =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const [mode, palette] of Object.entries(themes)) {
  describe(`${mode} palette contrast`, () => {
    const verify = (
      foreground: string,
      background: string,
      minimum: number,
    ) => {
      const ratio = contrast(
        color(foreground, palette),
        color(background, palette),
      );
      expect(
        ratio,
        `${foreground} on ${background}: ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(minimum);
    };

    it("keeps body text, metadata, placeholders, and links readable on app surfaces", () => {
      for (const surface of [
        "--token-canvas",
        "--token-surface",
        "--token-raised",
        "--token-overlay",
        "--accent",
      ]) {
        for (const foreground of [
          "--token-text",
          "--token-muted",
          "--token-link",
        ]) {
          verify(foreground, surface, 4.5);
        }
      }
      verify("--accent-foreground", "--accent", 4.5);
    });

    it("keeps labels readable on filled and hovered actions", () => {
      verify("--primary-foreground", "--primary", 4.5);
      verify("--primary-foreground", "--token-accent-hover", 4.5);
      verify("--token-success-contrast", "--token-success", 4.5);
      verify("--token-danger-contrast", "--token-danger", 4.5);
    });

    it("keeps operational state text readable in badges and notices", () => {
      for (const tone of ["success", "warning", "danger", "pending"]) {
        for (const surface of ["--token-surface", `--token-${tone}-surface`]) {
          verify(`--token-${tone}`, surface, 4.5);
        }
      }
    });

    it("keeps control boundaries and keyboard focus visible on adjacent surfaces", () => {
      for (const surface of [
        "--token-canvas",
        "--token-surface",
        "--token-raised",
        "--accent",
      ]) {
        verify("--token-border-strong", surface, 3);
        verify("--ring", surface, 3);
        verify("--token-primary-border", surface, 3);
      }
    });
  });
}
