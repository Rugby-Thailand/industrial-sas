import { sessionPreferences } from "@/lib/browser/storage";

const PREFIX = "customer-review-prefill:";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function reviewPrefillScope(
  userId: string | null | undefined,
  orgId: string | null | undefined,
) {
  return userId ? JSON.stringify([orgId ?? null, userId]) : null;
}

export function isReviewPrefillToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * Keeps a raw job-ticket customer name out of the URL by storing it in this
 * tab's sessionStorage under an opaque token.
 */
export function saveReviewPrefillName(
  name: string,
  scope: string | null,
): string | null {
  const trimmed = name.trim().slice(0, 200);
  if (!trimmed || !scope) return null;
  const token = crypto.randomUUID();
  return sessionPreferences.write(`${PREFIX}${scope}:${token}`, {
    name: trimmed,
  })
    ? token
    : null;
}

export function readReviewPrefillName(
  token: string | undefined,
  scope: string | null,
): string | undefined {
  if (!scope || !isReviewPrefillToken(token)) return undefined;
  return sessionPreferences.read<string | undefined>(
    `${PREFIX}${scope}:${token}`,
    (value) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "name" in value &&
        typeof value.name === "string"
      ) {
        const trimmed = value.name.trim().slice(0, 200);
        return trimmed || undefined;
      }
      return undefined;
    },
    undefined,
  );
}

export function clearReviewPrefillName(
  token: string | undefined,
  scope: string | null,
): void {
  if (!scope || !isReviewPrefillToken(token)) return;
  sessionPreferences.remove(`${PREFIX}${scope}:${token}`);
}
