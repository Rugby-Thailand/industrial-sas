/* Kiro audit probe (2026-10-15): contrast arithmetic for colors traced from the
 * current CSS cascade. Arithmetic only; it does not measure rendered pixels,
 * antialiasing or browser color management. Writes nothing. */
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp = (v) => Math.min(1, Math.max(0, v));
function hex(h) {
  return h.match(/[a-f\d]{2}/gi).map((n) => parseInt(n, 16) / 255);
}
function oklch(L, C = 0, H = 0) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => clamp(linearToSrgb(v)));
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg, bg) => {
  const a = lum(fg), b = lum(bg);
  return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
};
const over = (fg, bg, alpha) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)); // sRGB-space blend
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

const white = oklch(1), darkSurface = oklch(0.145);
const mutedLight = oklch(0.44), mutedDark = oklch(0.72);
const result = {
  calendarWeekdayAndOutsideDays_opacity075: {
    light: { color: toHex(over(mutedLight, white, 0.75)), ratio: ratio(over(mutedLight, white, 0.75), white), unblended: ratio(mutedLight, white) },
    dark: { color: toHex(over(mutedDark, darkSurface, 0.75)), ratio: ratio(over(mutedDark, darkSurface, 0.75), darkSurface), unblended: ratio(mutedDark, darkSurface) },
  },
  printFromDarkMode_badges: {
    success: ratio(hex("#8be3b7"), hex("#e3f3ea")),
    warning: ratio(hex("#ffd08a"), hex("#fff0d0")),
    danger: ratio(hex("#ffbbb4"), hex("#fee9e7")),
    pending: ratio(hex("#d0c0ff"), hex("#eeeaff")),
    appInkExampleOnPaper: ratio(hex("#58d19a"), hex("#ffffff")),
  },
  printFromDarkMode_disabledButton: {
    text: toHex(mutedDark), surface: toHex(oklch(0.23)), ratioTextOnSurface: ratio(mutedDark, oklch(0.23)),
    surfaceOnPaper: ratio(oklch(0.23), hex("#ffffff")),
  },
  printFromLightMode_badges_reference: {
    success: ratio(hex("#084d2c"), hex("#e3f3ea")),
  },
  snapshotPrimaryInSrgb: toHex(oklch(0.4901, 0.2875, 264.3293)),
};
console.log(JSON.stringify(result, null, 2));
