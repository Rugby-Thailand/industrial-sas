"use client";

import { CircleAlert, Info, LockKeyhole, X } from "lucide-react";
import { useLocale } from "next-intl";
import { Popover } from "radix-ui";
import { useState } from "react";

import { Link } from "@/i18n/navigation";
import { Button } from "./button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

/** Secondary explanations stay out of document flow; recovery destinations remain real links. */
export function StatusReason({
  label,
  message,
  tone = "info",
  href,
  announce = false,
}: {
  readonly label: string;
  readonly message: string;
  readonly tone?: "info" | "locked" | "error";
  readonly href?: string | undefined;
  readonly announce?: boolean;
}) {
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [hint, setHint] = useState(announce);
  const Icon =
    tone === "error" ? CircleAlert : tone === "locked" ? LockKeyhole : Info;
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`relative z-10 shrink-0 ${tone === "error" ? "text-danger" : "text-muted"}`}
      aria-label={label}
      {...(href ? { asChild: true } : {})}
    >
      {href ? (
        <Link href={href}>
          <Icon aria-hidden="true" className="size-4" />
        </Link>
      ) : (
        <Icon aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
  return (
    <TooltipProvider delayDuration={250}>
      <Popover.Root
        open={expanded}
        onOpenChange={(open) => {
          setExpanded(open);
          setHint(false);
        }}
      >
        <Tooltip open={!expanded && hint} onOpenChange={setHint}>
          {href ? (
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          ) : (
            <Popover.Trigger asChild>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            </Popover.Trigger>
          )}
          <TooltipContent
            side="bottom"
            sideOffset={6}
            className="max-w-[min(20rem,calc(100vw-2rem))] text-sm leading-5 font-normal whitespace-normal"
          >
            {message}
          </TooltipContent>
        </Tooltip>
        {!href ? (
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={16}
              aria-label={label}
              className="z-50 flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2 rounded-lg border border-border bg-overlay p-4 text-sm leading-5 text-text shadow-lg"
            >
              <p className="min-w-0 flex-1">{message}</p>
              <Popover.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    locale === "th" ? "ปิดคำอธิบาย" : "Close explanation"
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        ) : null}
      </Popover.Root>
      {announce ? (
        <span role="alert" className="sr-only">
          {message}
        </span>
      ) : null}
    </TooltipProvider>
  );
}
