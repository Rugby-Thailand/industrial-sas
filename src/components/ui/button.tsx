import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The shadcn/Radix Button, vendored with one deliberate change to the registry
 * source: **`touch` is the default size, and it is 48 by 48 CSS pixels.**
 *
 * The registry's default is a 32-pixel control, which is a desktop density. This
 * markup is shared with the handheld shell, where 48 is a requirement rather
 * than a preference (`INV-0010-06`, D-24) — and a default that has to be
 * remembered at every call site is a default that will be forgotten at one of
 * them. The smaller sizes are kept for dense desktop-only surfaces, where they
 * must be an explicit choice.
 *
 * The variants map onto the repository's semantic tokens: `default` is the
 * accent action, `outline` and `secondary` are the neutral surfaces already used
 * across the application, and `destructive` is a `danger` tint rather than a
 * solid fill — solid `danger` is a pale salmon in the dark scheme, and text on
 * it loses 4.5:1 in exactly the confirmation that matters most.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:text-disabled aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /*
         * `bg-primary-hover`, not `bg-primary/80`: an alpha modifier composites
         * against the surface behind the button, which lightened the fill until
         * white-on-accent measured 4.34:1. See the token note in `globals.css`.
         */
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline:
          "border-input bg-surface text-text hover:bg-raised aria-expanded:bg-raised",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-border aria-expanded:bg-secondary",
        ghost: "text-text hover:bg-raised aria-expanded:bg-raised",
        destructive:
          "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        touch: "min-h-touch min-w-touch gap-2 px-4",
        default: "h-8 gap-1.5 px-2.5",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5",
        icon: "min-h-touch min-w-touch",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "touch",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "touch",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
