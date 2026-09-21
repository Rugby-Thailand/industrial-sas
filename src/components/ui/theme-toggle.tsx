"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import AnimatedToggle from "@/components/ui/animated-toggle";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

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
    return <span aria-hidden="true" className="h-12 w-[52px] shrink-0" />;

  return (
    <div className="flex h-12 shrink-0 items-center">
      <AnimatedToggle
        checked={resolvedTheme === "dark"}
        onChange={(dark) => setTheme(dark ? "dark" : "light")}
        label={t("toggleTheme")}
        size="lg"
        variant="icon"
        icons={{
          on: <Moon aria-hidden="true" className="size-full" />,
          off: <Sun aria-hidden="true" className="size-full" />,
        }}
      />
    </div>
  );
}
