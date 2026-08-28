import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:text-disabled aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover disabled:border-border disabled:bg-disabled-surface disabled:text-disabled",
        success:
          "bg-success text-background hover:bg-success/90 disabled:border-border disabled:bg-disabled-surface disabled:text-disabled",
        outline:
          "border-input bg-surface text-text hover:bg-raised aria-expanded:bg-raised disabled:border-border disabled:bg-disabled-surface disabled:text-disabled",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:border-border-strong hover:bg-overlay aria-expanded:bg-overlay disabled:bg-disabled-surface disabled:text-disabled",
        ghost:
          "text-text hover:bg-raised aria-expanded:bg-raised disabled:bg-transparent disabled:text-disabled",
        destructive:
          "border-destructive/60 bg-danger-surface text-destructive hover:border-destructive hover:bg-destructive/20 focus-visible:border-destructive/60 focus-visible:ring-destructive/20 disabled:border-border disabled:bg-disabled-surface disabled:text-disabled dark:focus-visible:ring-destructive/40",
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
