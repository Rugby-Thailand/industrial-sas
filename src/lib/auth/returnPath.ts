/** Only planner routes in the current locale can become a post-sign-in destination. */
export function plannerReturnPath(
  value: unknown,
  locale: string,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 12000 ||
    /[\\\r\n]/.test(value)
  )
    return undefined;
  const prefix = `/${locale}/`;
  if (!value.startsWith(prefix)) return undefined;
  const path = value.split(/[?#]/)[0]!;
  const root = path.slice(prefix.length);
  if (!/^(finished-goods|master-data\/storage-layouts|setup)(\/|$)/.test(root))
    return undefined;
  const parsed = new URL(value, "https://planner.invalid");
  if (parsed.pathname !== path) return undefined;
  return value;
}

export const RETURN_PATH_HEADER = "x-planner-return-path";
