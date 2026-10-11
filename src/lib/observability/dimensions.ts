// Reviewed observability dimensions (BD-13). Only keys listed here leave the
// application, and each key has its own value rule. Redaction is therefore an
// allowlist, not a syntactic guess: a name, email, customer, product code,
// ticket image, token or free-text value is dropped unless a reviewed key
// with a matching rule exists. Add a key only together with a test showing
// which values it keeps and why they are not personal or business content.

export type DimensionValue = string | number | boolean;

export const MAX_DIMENSION_LENGTH = 64;

/** Placeholder for a dynamic or unrecognised route segment. */
export const ROUTE_PLACEHOLDER = "[id]";

const MAX_ROUTE_SEGMENTS = 8;

/**
 * Static route segment vocabulary of `src/app`. Dynamic segments, catch-all
 * paths and anything unknown become {@link ROUTE_PLACEHOLDER}, so record IDs,
 * floor numbers or a typed URL never reach a sink. A dedicated test keeps this
 * list aligned with the route tree; a forgotten new static segment only makes
 * the route less specific, never less private.
 */
export const STATIC_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  "en",
  "th",
  "about",
  "privacy",
  "terms",
  "sign-in",
  "setup",
  "ai-usage",
  "hr",
  "today",
  "time",
  "profile",
  "employees",
  "periods",
  "settings",
  "finished-goods",
  "batches",
  "new",
  "pallets",
  "measure",
  "move",
  "stack",
  "storage",
  "products",
  "packing",
  "scan",
  "records",
  "master-data",
  "storage-layouts",
  "floors",
  "review",
  "demo",
]);

type DimensionRule = (value: unknown) => DimensionValue | undefined;

const oneOf =
  (...allowed: readonly string[]): DimensionRule =>
  (value) =>
    typeof value === "string" && allowed.includes(value) ? value : undefined;

const finiteNumber: DimensionRule = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Route template such as `en.master-data.storage-layouts.[id].floors`. */
export function normalizeRoute(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const segments = value
    .split(/[./]/)
    .filter((segment) => segment.length > 0)
    .slice(0, MAX_ROUTE_SEGMENTS)
    .map((segment) =>
      STATIC_ROUTE_SEGMENTS.has(segment) ? segment : ROUTE_PLACEHOLDER,
    );
  let route = "";
  for (const segment of segments) {
    const next = route ? `${route}.${segment}` : segment;
    if (next.length > MAX_DIMENSION_LENGTH) break;
    route = next;
  }
  return route || "root";
}

export const OBSERVABILITY_DIMENSIONS: Readonly<Record<string, DimensionRule>> =
  Object.freeze({
    // Error boundaries (`applicationError.ts`).
    boundary: oneOf("locale", "global"),
    // Web vitals (`webVitals.ts`). The per-page-load metric `id` is excluded.
    metric: oneOf("TTFB", "FCP", "LCP", "FID", "CLS", "INP"),
    value: finiteNumber,
    delta: finiteNumber,
    rating: oneOf("good", "needs-improvement", "poor"),
    navigationType: oneOf(
      "navigate",
      "reload",
      "prerender",
      "back-forward",
      "back_forward",
      "back-forward-cache",
      "restore",
    ),
    // Workspace query failures (`WorkspaceAccessBoundary`).
    route: normalizeRoute,
    // Warehouse references are deliberately omitted: a lexical shape cannot
    // establish that an arbitrary value is an opaque ID rather than content.
  });

export const OBSERVABILITY_DIMENSION_KEYS: readonly string[] = Object.freeze(
  Object.keys(OBSERVABILITY_DIMENSIONS),
);

/** Keep only allowlisted keys whose values satisfy that key's rule. */
export function redactDimensions(
  dimensions: Readonly<Record<string, unknown>>,
): Readonly<Record<string, DimensionValue>> {
  const safe: Record<string, DimensionValue> = {};
  if (dimensions === null || typeof dimensions !== "object") {
    return Object.freeze(safe);
  }
  for (const key of OBSERVABILITY_DIMENSION_KEYS) {
    if (!Object.hasOwn(dimensions, key)) continue;
    const value = OBSERVABILITY_DIMENSIONS[key]!(dimensions[key]);
    if (value !== undefined) safe[key] = value;
  }
  return Object.freeze(safe);
}
