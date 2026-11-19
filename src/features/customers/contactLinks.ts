/**
 * Dial the first run that reads as a phone number (at least seven digits,
 * with spaces, dashes, dots or brackets). Labels ("PBX", "ติดต่อ",
 * "24h hotline:") and extensions ("ต่อ 89", "ext 89") are shown, not
 * dialled. Returns undefined when no such run exists.
 */
/** "ต่อ", "ext", "x" or "#" standing alone right before a digit run. */
const EXTENSION_BEFORE = /(?:^|[\s/(])(?:ต่อ|ext\.?|x|#)\s*$/iu;

export function telHref(phone: string): string | undefined {
  for (const run of phone.matchAll(/\+?\d[\d\s().-]*\d/gu)) {
    // A run introduced by a standalone extension marker is an extension.
    if (EXTENSION_BEFORE.test(phone.slice(0, run.index))) continue;
    const digits = run[0].replace(/[^\d+]/gu, "");
    if (digits.replace("+", "").length >= 7) return `tel:${digits}`;
  }
  return undefined;
}

/** A mailto: link that keeps the literal "@" and encodes each side of it. */
export function mailtoHref(email: string): string {
  const at = email.lastIndexOf("@");
  return `mailto:${encodeURIComponent(email.slice(0, at))}@${encodeURIComponent(email.slice(at + 1))}`;
}
