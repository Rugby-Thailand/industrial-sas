import { LOCALES } from "@/i18n/routing";
import { ROUTES } from "@/lib/navigation";

export function isHomePath(pathname: string | null): boolean {
  return LOCALES.some((locale) => pathname === `/${locale}${ROUTES.dashboard}`);
}
