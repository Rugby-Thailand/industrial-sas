import { isPublishableKey } from "@clerk/shared/keys";

export function resolveClerkPublishableKey(
  value: string | undefined,
): string | undefined {
  const key = value?.trim();
  return key !== undefined && isPublishableKey(key) ? key : undefined;
}

export function isClerkConfigured(
  publishableKey: string | undefined,
  secretKey: string | undefined,
): boolean {
  return (
    resolveClerkPublishableKey(publishableKey) !== undefined &&
    Boolean(secretKey?.trim())
  );
}
