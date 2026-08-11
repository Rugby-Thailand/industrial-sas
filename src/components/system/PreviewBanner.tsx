"use client";

/**
 * The banner that makes preview data impossible to mistake for stock.
 *
 * It is not dismissible, and that is the whole design. A dismissible banner is
 * dismissed once and then the screen looks exactly like a real one for the rest
 * of the session — at which point a synthetic balance is indistinguishable from
 * a warehouse's actual stock. It sits above the shell chrome in both shells, so
 * it is present on every screen preview data can reach.
 *
 * Renders nothing at all outside preview mode, which a production build cannot
 * enter (`resolveAppEnvironment`).
 */
import { useTranslations } from "next-intl";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";

export function PreviewBanner() {
  const environment = useAppEnvironment();
  const t = useTranslations("Preview");

  if (!environment.previewMode) return null;

  return (
    <div
      role="status"
      data-testid="preview-banner"
      className="border-b-2 border-accent bg-raised px-4 py-2 text-sm text-text"
    >
      <p className="font-semibold text-accent">{t("bannerTitle")}</p>
      <p className="mt-0.5 leading-relaxed text-muted">{t("bannerBody")}</p>
    </div>
  );
}
