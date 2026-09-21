/** Shared semantic colors resolve in CSS so open SVG scenes follow the theme immediately. */
export const sceneColors = {
  free: "var(--token-success)",
  stored: "var(--muted-foreground)",
  reserved: "var(--token-warning)",
  selected: "var(--token-link)",
  invalid: "var(--token-danger)",
  source: "var(--muted-foreground)",
  floor: "var(--scene-floor)",
  floorSide: "var(--scene-floor-side)",
  grid: "var(--scene-grid)",
  boundary: "var(--scene-boundary)",
  dimension: "var(--scene-dimension)",
  label: "var(--foreground)",
  secondaryLabel: "var(--muted-foreground)",
  labelSurface: "var(--card)",
  // Area colors are persisted hex values, independent of status and theme.
  unavailable: "#46566a",
} as const;

/** Subtle solid faces preserve volume without competing with status outlines. */
export function sceneFaces(color: string): readonly [string, string, string] {
  return [
    `color-mix(in srgb, ${color} 28%, var(--scene-floor))`,
    `color-mix(in srgb, ${color} 18%, var(--scene-floor))`,
    `color-mix(in srgb, ${color} 10%, var(--scene-floor))`,
  ];
}
