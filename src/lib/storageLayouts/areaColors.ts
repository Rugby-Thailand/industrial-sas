import { normalizeAreaColor } from "../../../convex/model/storageLayout/areaColor";
import { sceneColors } from "@/components/storageScene/sceneColors";

export { normalizeAreaColor };

export const AREA_COLOR_PRESETS = [
  { key: "default", color: sceneColors.unavailable.toUpperCase() },
  { key: "walkway", color: "#FFB889" },
  { key: "office", color: "#145CA1" },
  { key: "stairs", color: "#DFC18B" },
  { key: "liftClearance", color: "#F5CC2B" },
  { key: "worktable", color: "#E99693" },
  { key: "parking", color: "#A3948A" },
  { key: "door", color: "#90BEB1" },
] as const;

export function resolveAreaColor(color?: string): string {
  return (
    (color && normalizeAreaColor(color)) ||
    sceneColors.unavailable.toUpperCase()
  );
}

export function areaColorText(color?: string): string {
  const hex = resolveAreaColor(color).slice(1);
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return luminance > 0.179 ? "#000000" : "#FFFFFF";
}
