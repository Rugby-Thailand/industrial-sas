export type StorageFormat = "PALLET" | "BOX" | "OTHER";
type Translate = (en: string, th: string) => string;

export function unitNoun(format: string | undefined, tr: Translate): string {
  return format === "PALLET"
    ? tr("Pallet", "พาเลท")
    : format === "BOX"
      ? tr("Box", "กล่อง")
      : tr("Storage unit", "หน่วยจัดเก็บ");
}

export function unitCountLabel(
  format: string | undefined,
  count: number,
  tr: Translate,
): string {
  const noun =
    format === "PALLET"
      ? tr(count === 1 ? "pallet" : "pallets", "พาเลท")
      : format === "BOX"
        ? tr(count === 1 ? "box" : "boxes", "กล่อง")
        : tr(count === 1 ? "storage unit" : "storage units", "หน่วยจัดเก็บ");
  return `${count} ${noun}`;
}

/** Adapt existing operational copy to the physical unit's format. IDs and routes are unchanged. */
export function unitCopy(text: string, format: string | undefined): string {
  if (format === undefined || format === "PALLET") return text;
  return text
    .replace(/พาเลท/g, format === "BOX" ? "กล่อง" : "หน่วยจัดเก็บ")
    .replace(/\bpallet(s)?\b/gi, (word, plural: string | undefined) => {
      const noun =
        format === "BOX"
          ? plural
            ? "boxes"
            : "box"
          : plural
            ? "storage units"
            : "storage unit";
      return word.charAt(0) === word.charAt(0).toUpperCase()
        ? noun[0]!.toUpperCase() + noun.slice(1)
        : noun;
    });
}
