/** Normalize supported area colors without accepting arbitrary CSS values. */
export function normalizeAreaColor(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return undefined;
  return `#${trimmed.replace(/^#/, "").toUpperCase()}`;
}
