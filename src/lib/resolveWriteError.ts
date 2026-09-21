export type WriteErrorDomain = "finishedGoods" | "packing" | "storage";
type Translate = {
  (key: string): string;
  has(key: string): boolean;
};

/** The message catalogue owns supported codes; unknown failures use safe copy. */
export function resolveWriteError(
  code: string | null | undefined,
  t: Translate,
  domain: WriteErrorDomain = "finishedGoods",
) {
  if (!code) return "";
  const prefix =
    domain === "finishedGoods" ? "FG_" : domain === "packing" ? "PACKING_" : "";
  const key =
    domain === "packing" && code.startsWith(prefix) ? code : `${prefix}${code}`;
  const fallback =
    domain === "packing" ? "PACKING_INCOMPLETE" : `${prefix}UNKNOWN`;
  return t(t.has(key) ? key : fallback);
}
