import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors select-none focus-ring active:not-aria-[haspopup]:not-aria-disabled:translate-y-px disabled:pointer-events-none disabled:text-disabled aria-disabled:cursor-not-allowed aria-disabled:text-disabled aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary-border bg-primary text-primary-foreground hover:bg-primary-hover disabled:border-border disabled:bg-disabled-surface disabled:text-disabled aria-disabled:border-border aria-disabled:bg-disabled-surface",
        success:
          "bg-success text-success-contrast hover:bg-success/90 disabled:border-border disabled:bg-disabled-surface disabled:text-disabled aria-disabled:border-border aria-disabled:bg-disabled-surface",
        outline:
          "border-input bg-surface text-text hover:bg-raised aria-expanded:bg-raised disabled:border-border disabled:bg-disabled-surface disabled:text-disabled aria-disabled:border-border aria-disabled:bg-disabled-surface",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:border-border-strong hover:bg-overlay aria-expanded:bg-overlay disabled:bg-disabled-surface disabled:text-disabled aria-disabled:bg-disabled-surface",
        ghost:
          "text-text hover:bg-raised aria-expanded:bg-raised disabled:bg-transparent disabled:text-disabled aria-disabled:bg-transparent",
        active:
          "border-transparent bg-accent-surface text-link hover:bg-accent-surface aria-expanded:bg-accent-surface disabled:border-border disabled:bg-disabled-surface disabled:text-disabled aria-disabled:border-border aria-disabled:bg-disabled-surface",
        destructive:
          "border-destructive/60 bg-danger-surface text-destructive hover:border-destructive hover:bg-destructive/20 disabled:border-border disabled:bg-disabled-surface disabled:text-disabled aria-disabled:border-border aria-disabled:bg-disabled-surface",
        link: "text-link underline-offset-4 hover:underline",
      },
      /*
       * Every size keeps the shared density: a 48px touch target that becomes
       * a 36px control on a dense desktop (see the `dense` variant).
       */
      size: {
        /** Compatibility aliases retain the common density scale. */
        default:
          "min-h-touch min-w-touch gap-2 px-4 py-2 dense:min-h-control dense:min-w-control dense:px-3 dense:py-1.5",
        lg: "min-h-touch min-w-touch gap-2 px-4 py-2 dense:min-h-control dense:min-w-control dense:px-3 dense:py-1.5",
        "icon-sm":
          "min-h-touch min-w-touch dense:min-h-control dense:min-w-control",
        /** Ordinary actions. */
        touch:
          "min-h-touch min-w-touch gap-2 px-4 py-2 dense:min-h-control dense:min-w-control dense:px-3 dense:py-1.5",
        /** Secondary actions in dense toolbars and rows: smaller text, same target. */
        sm: "min-h-touch min-w-touch gap-1.5 px-3 py-2 text-[0.8125rem] dense:min-h-control dense:min-w-control dense:px-2.5 dense:py-1 [&_svg:not([class*='size-'])]:size-3.5",
        /** Square icon-only action; IconButton supplies its accessible name. */
        icon: "min-h-touch min-w-touch dense:min-h-control dense:min-w-control",
      },
    },
    compoundVariants: [
      {
        variant: "active",
        size: ["icon", "icon-sm"],
        className:
          "border-transparent bg-transparent hover:bg-transparent hover:text-link aria-expanded:bg-transparent aria-pressed:bg-transparent aria-pressed:text-link aria-pressed:hover:text-link disabled:bg-transparent aria-disabled:bg-transparent disabled:aria-pressed:text-disabled aria-disabled:aria-pressed:text-disabled",
      },
      {
        variant: "ghost",
        size: ["icon", "icon-sm"],
        className:
          "aria-pressed:border-transparent aria-pressed:bg-transparent aria-pressed:text-link aria-pressed:hover:bg-transparent aria-pressed:hover:text-link disabled:aria-pressed:text-disabled aria-disabled:aria-pressed:text-disabled",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "touch",
    },
  },
);
