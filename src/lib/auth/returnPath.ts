import { HR_ROOT, ROUTES } from "@/lib/navigation";

const RETURN_PATH_ROOTS = [
  HR_ROOT,
  ...Object.values(ROUTES).filter((route) => route !== ROUTES.signIn),
];

/** Only desktop routes in the current locale can become a post-sign-in destination. */
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
  const root = path.slice(prefix.length - 1);
  if (
    !RETURN_PATH_ROOTS.some(
      (route) => root === route || root.startsWith(`${route}/`),
    )
  )
    return undefined;
  const parsed = new URL(value, "https://planner.invalid");
  if (parsed.pathname !== path) return undefined;
  return value;
}

export const RETURN_PATH_HEADER = "x-planner-return-path";
