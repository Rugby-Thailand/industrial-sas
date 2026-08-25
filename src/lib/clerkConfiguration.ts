import { isPublishableKey } from "@clerk/shared/keys";

export function resolveClerkPublishableKey(
  value: string | undefined,
): string | undefined {
  const key = value?.trim();
  return key !== undefined && isPublishableKey(key) ? key : undefined;
}
