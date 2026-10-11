import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Task surfaces.
 * - `surface`: the one framed surface of a task (border, 12px radius).
 * - `plain`: a section inside that surface; grouped by heading and spacing.
 * - `divided`: a plain section separated from the previous one by a rule.
 */
const APPEARANCES = {
  surface: "rounded-xl border border-border bg-surface",
  plain: "",
  divided: "border-t border-border",
} as const;

const PADDINGS = {
  default: "p-section",
  compact: "p-3",
  none: "",
} as const;

/** `divided` sections only pad above their rule; their task surface pads the sides. */
const DIVIDED_PADDINGS = {
  default: "pt-section",
  compact: "pt-3",
  none: "",
} as const;

export type PanelAppearance = keyof typeof APPEARANCES;
export type PanelPadding = keyof typeof PADDINGS;

export interface PanelStyle {
  readonly appearance?: PanelAppearance;
  readonly padding?: PanelPadding;
}

/**
 * The class list for a task surface, for elements that cannot be a Panel,
 * such as a linked catalogue card (`<Link className={panelClassName()}>`).
 */
export function panelClassName({
  appearance = "surface",
  padding,
}: PanelStyle = {}): string {
  const resolved = padding ?? (appearance === "surface" ? "default" : "none");
  return cn(
    "min-w-0",
    APPEARANCES[appearance],
    appearance === "divided" ? DIVIDED_PADDINGS[resolved] : PADDINGS[resolved],
  );
}

type PanelTag =
  | "section"
  | "div"
  | "article"
  | "aside"
  | "form"
  | "fieldset"
  | "figure"
  | "li"
  | "ul"
  | "p";

export type PanelProps<Tag extends PanelTag = "section"> = PanelStyle & {
  readonly as?: Tag;
  readonly children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<Tag>, "children">;

export function Panel<Tag extends PanelTag = "section">({
  as,
  appearance,
  padding,
  className,
  children,
  ...props
}: PanelProps<Tag>) {
  const Element = (as ?? "section") as PanelTag;
  const style: PanelStyle = {
    ...(appearance === undefined ? {} : { appearance }),
    ...(padding === undefined ? {} : { padding }),
  };
  return (
    <Element
      {...(props as ComponentPropsWithoutRef<"section">)}
      className={cn(panelClassName(style), className)}
    >
      {children}
    </Element>
  );
}
