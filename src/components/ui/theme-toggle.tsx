"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/**
 * One compact icon button for light and dark themes. It is a toggle button
 * (`aria-pressed` = dark) whose icon shows the current theme; its name and
 * tooltip state the theme a press switches to.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("Navigation");
  const mounted = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );

  // The server cannot read the saved theme. Reserve the same space until hydration.
  if (!mounted)
    return (
      <span aria-hidden="true" className="size-touch shrink-0 md:size-9" />
    );

  const dark = resolvedTheme === "dark";
  const label = t(dark ? "useLightTheme" : "useDarkTheme");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("darkTheme")}
      aria-pressed={dark}
      title={label}
      data-testid="theme-toggle"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="shrink-0 text-muted hover:text-text"
    >
      {dark ? (
        <Moon aria-hidden="true" className="size-[1.125rem]" />
      ) : (
        <Sun aria-hidden="true" className="size-[1.125rem]" />
      )}
    </Button>
  );
}
