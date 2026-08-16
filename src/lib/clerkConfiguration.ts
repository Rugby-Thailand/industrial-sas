import { isPublishableKey } from "@clerk/shared/keys";

/** A trimmed Clerk publishable key, but only when Clerk can actually parse it. */
export function resolveClerkPublishableKey(
  value: string | undefined,
): string | undefined {
  const key = value?.trim();
  return key !== undefined && isPublishableKey(key) ? key : undefined;
}
