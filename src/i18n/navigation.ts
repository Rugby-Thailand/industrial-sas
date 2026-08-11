/**
 * Locale-aware navigation primitives.
 *
 * Every internal link in the application uses the `Link` exported here rather
 * than `next/link`. The difference matters: `next/link` would need every caller
 * to prepend the active locale by hand, and the one caller that forgets sends a
 * Thai operator to an English screen — or, with `localePrefix: "always"`, to a
 * redirect that loses their place.
 */
import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
