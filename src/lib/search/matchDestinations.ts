/**
 * Local, deterministic matching of the destination registry. Runs on every
 * keystroke without the network or a model: labels in the current locale
 * plus the curated Thai/English aliases of each destination.
 *
 * Ranking: exact label > label prefix > exact alias > alias prefix >
 * substring > one-letter typo (Latin words of five letters or more only,
 * because a Thai "typo" usually changes the word).
 */
import { normalizeSearchText } from "../../../convex/model/search/text";
import {
  STATIC_DESTINATIONS,
  hasNavigationPermission,
  type StaticDestination,
} from "../navigation";

export interface DestinationMatch {
  readonly destination: StaticDestination;
  readonly score: number;
}

const within1 = (a: string, b: string): boolean => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};

function scoreText(text: string, needle: string, exact: number): number {
  const value = normalizeSearchText(text);
  if (value === needle) return exact;
  if (value.startsWith(needle)) return exact - 10;
  if (needle.length >= 2 && value.includes(needle)) return exact - 30;
  // The query may contain the phrase among other words ("ตั้งวันหยุด 2569").
  if (value.length >= 3 && needle.includes(value)) return exact - 35;
  return 0;
}

function typoScore(texts: readonly string[], needle: string): number {
  if (!/^[a-z ]+$/.test(needle)) return 0;
  const words = needle.split(" ").filter((word) => word.length >= 5);
  if (words.length === 0) return 0;
  for (const text of texts)
    for (const candidate of normalizeSearchText(text).split(" "))
      if (
        candidate.length >= 5 &&
        words.some((word) => within1(word, candidate))
      )
        return 10;
  return 0;
}

/** Granted destinations matching `query`, best first. Empty query: none. */
export function matchDestinations(
  query: string,
  granted: readonly string[],
  label: (destination: StaticDestination) => string,
): readonly DestinationMatch[] {
  const needle = normalizeSearchText(query);
  if (needle.length === 0) return [];
  const matches: DestinationMatch[] = [];
  for (const destination of STATIC_DESTINATIONS) {
    if (
      !hasNavigationPermission(
        destination.permissionCodes,
        granted,
        destination.permissionMode ?? "ALL",
      )
    )
      continue;
    const name = label(destination);
    let score = scoreText(name, needle, 100);
    for (const alias of destination.aliases)
      score = Math.max(score, scoreText(alias, needle, 90));
    if (score === 0) score = typoScore([name, ...destination.aliases], needle);
    if (score > 0) matches.push({ destination, score });
  }
  return matches.sort(
    (a, b) =>
      b.score - a.score || kindOrder(a.destination) - kindOrder(b.destination),
  );
}

const kindOrder = (destination: StaticDestination) =>
  destination.kind === "PAGE" ? 0 : destination.kind === "SECTION" ? 1 : 2;
