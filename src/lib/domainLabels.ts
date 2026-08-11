/**
 * Translating a closed-set domain code that the catalogue might not know yet.
 *
 * Stock statuses and transaction types are code-owned English identifiers
 * (`D-06`), and the catalogue carries a Thai and an English label for each one
 * the server can currently produce. "Currently" is the problem: the server is
 * versioned separately from the client it is serving, so a deployment that adds
 * a status reaches a browser holding the previous catalogue.
 *
 * The two obvious behaviours are both wrong. Throwing blanks a warehouse screen
 * over a label. Rendering `next-intl`'s missing-key placeholder puts
 * `StockStatus.NEW_THING` in a table cell, which reads as a defect rather than a
 * value. Falling back to the raw code is neither: it is the same string the
 * server, the logs, and the permission catalogue use, so an operator can report
 * it and a supervisor can look it up.
 */

/** The part of a `next-intl` translator this helper needs. */
export interface CodeTranslator {
  (key: string): string;
  has(key: string): boolean;
}

export function codeLabel(translate: CodeTranslator, code: string): string {
  return translate.has(code) ? translate(code) : code;
}
