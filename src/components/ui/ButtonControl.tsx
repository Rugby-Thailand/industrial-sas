"use client";

import { Spinner } from "@/components/ui/spinner";

import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./buttonVariants";

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child element (for example a link) as the button. */
    asChild?: boolean;
    /**
     * A request started by this action has not settled. The action is
     * unavailable, announces `aria-busy`, and shows `pendingLabel` when given.
     * Callers keep ownership of the request and its retry identity.
     */
    pending?: boolean;
    /**
     * Visible content beside the spinner while pending, such as “Saving…”.
     * `null` shows the spinner alone (icon actions). Not used with `asChild`.
     */
    pendingLabel?: React.ReactNode;
  };

function Button({
  className,
  variant = "default",
  size = "touch",
  asChild = false,
  pending = false,
  pendingLabel,
  disabled,
  children,
  onClickCapture,
  onAuxClickCapture,
  onKeyDownCapture,
  ...props
}: ButtonProps) {
  const unavailable = Boolean(disabled) || pending;
  const classes = cn(buttonVariants({ variant, size, className }));

  if (asChild) {
    // Radix normally invokes the child's capture handler before the Slot's.
    // Guard the child first so a disabled link cannot run either handler.
    const cancel = (event: React.SyntheticEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const child = React.isValidElement<React.HTMLAttributes<HTMLElement>>(
      children,
    )
      ? React.cloneElement(children, {
          "aria-busy":
            pending || (children.props["aria-busy"] ?? props["aria-busy"]),
          "aria-disabled":
            unavailable ||
            (children.props["aria-disabled"] ?? props["aria-disabled"]),
          onClickCapture: (event) => {
            if (unavailable) return cancel(event);
            children.props.onClickCapture?.(event);
          },
          onAuxClickCapture: (event) => {
            if (unavailable) return cancel(event);
            children.props.onAuxClickCapture?.(event);
          },
          onKeyDownCapture: (event) => {
            if (unavailable && (event.key === "Enter" || event.key === " ")) {
              return cancel(event);
            }
            children.props.onKeyDownCapture?.(event);
          },
        })
      : children;

    return (
      <Slot.Root
        {...props}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={classes}
        aria-busy={pending || props["aria-busy"]}
        aria-disabled={unavailable || props["aria-disabled"]}
        onClickCapture={(event) => {
          if (unavailable) return cancel(event);
          onClickCapture?.(event as React.MouseEvent<HTMLButtonElement>);
        }}
        onAuxClickCapture={(event) => {
          if (unavailable) return cancel(event);
          onAuxClickCapture?.(event as React.MouseEvent<HTMLButtonElement>);
        }}
        onKeyDownCapture={(event) => {
          if (unavailable && (event.key === "Enter" || event.key === " ")) {
            return cancel(event);
          }
          onKeyDownCapture?.(event as React.KeyboardEvent<HTMLButtonElement>);
        }}
      >
        {child}
      </Slot.Root>
    );
  }

  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={classes}
      disabled={unavailable}
      {...(onAuxClickCapture === undefined ? {} : { onAuxClickCapture })}
      {...(onKeyDownCapture === undefined ? {} : { onKeyDownCapture })}
      {...(onClickCapture === undefined ? {} : { onClickCapture })}
      {...props}
      aria-busy={pending || props["aria-busy"]}
    >
      {pending ? (
        <>
          <Spinner aria-hidden="true" />
          {pendingLabel === undefined ? children : pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export { Button };
export type { ButtonProps };
