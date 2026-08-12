"use client";

/**
 * The one select this application renders.
 *
 * Every choose-one control on every screen goes through here: the warehouse
 * switcher, the language switcher, the receiving dock, and all twenty-odd
 * `kind: "select"` field specifications behind `EntityForm`. A single renderer
 * is the point — a native `<select>` draws its popup with the *operating
 * system's* colours, so a dark-scheme screen produced a white OS menu that no
 * page style could reach, and every one of those call sites had the defect
 * independently.
 *
 * It wraps the shadcn/Radix composition (`Select > SelectTrigger > SelectValue`
 * and `SelectContent > SelectItem`) rather than replacing it, so the keyboard
 * contract is Radix's and not a reimplementation: Tab to the trigger,
 * Enter/Space or Arrow to open, Up/Down/Home/End to move, letters to typeahead,
 * Escape to close, and focus back on the trigger afterwards.
 *
 * Four states it handles that a bare `<Select>` does not:
 *
 * - **Placeholder.** Required, not optional. A control with no value has to say
 *   what it wants; "the first option, silently" is how a receipt gets recorded
 *   at a dock nobody chose.
 * - **Empty.** No options is a different thing from no selection, and it is a
 *   sentence rather than an empty popup an operator taps twice to be sure of.
 * - **Pending and disabled.** Both close the control, and `pending` marks it
 *   `aria-busy` so the reason is available to a screen reader rather than only
 *   to whoever can see it greyed out.
 * - **The blank option.** Radix reserves the empty string internally, but a
 *   domain option list legitimately contains "no order" as `""`. It is carried
 *   across the boundary as a sentinel instead of being renamed, so callers keep
 *   submitting the empty string the server already expects.
 */

import { useId } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SelectControlOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/**
 * The stand-in for the empty string inside Radix.
 *
 * Radix treats `""` as "nothing is selected" and throws if an item claims it.
 * The domain disagrees: "no order" is a real choice whose submitted value is the
 * empty string. Rather than change what the server receives, the empty string is
 * swapped for this sentinel on the way in and swapped back on the way out. The
 * value is deliberately one no identifier in this domain could collide with.
 *
 * The swap is conditional on such an option actually being offered, and that
 * condition is the whole subtlety. `""` means two different things depending on
 * the option list: "the blank choice, chosen" when the list contains it, and
 * "nothing chosen yet" when it does not. Translating it unconditionally would
 * hand Radix a value no item claims, and the trigger would then show neither a
 * selection nor the placeholder — an empty box with nothing to say.
 */
const BLANK = "__blank__";

const fromInternal = (value: string): string => (value === BLANK ? "" : value);

export interface SelectControlProps {
  /** Associates a visible `<label htmlFor>` with the trigger. */
  readonly id?: string;
  /** Kept for form submission compatibility; Radix renders a hidden control. */
  readonly name?: string;
  readonly value: string;
  readonly options: readonly SelectControlOption[];
  readonly onValueChange: (value: string) => void;
  /** Shown when nothing is selected. Required: see the note above. */
  readonly placeholder: string;
  /** Shown inside the menu when there is nothing to choose from. */
  readonly emptyLabel: string;
  readonly disabled?: boolean;
  /** A request is in flight. Closes the control and says so to assistive tech. */
  readonly pending?: boolean;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  /** Only when there is no visible label to point `htmlFor` at. */
  readonly label?: string;
  readonly className?: string;
  readonly testId?: string;
}

export function SelectControl({
  id,
  name,
  value,
  options,
  onValueChange,
  placeholder,
  emptyLabel,
  disabled = false,
  pending = false,
  required = false,
  invalid = false,
  describedBy,
  label,
  className,
  testId,
}: SelectControlProps) {
  const emptyId = useId();
  const isEmpty = options.length === 0;
  /*
   * An empty list is closed, not open-and-blank. Radix would happily render a
   * popup with nothing in it, and an operator cannot tell that apart from a
   * menu that failed to load.
   */
  const closed = disabled || pending || isEmpty;

  const offersBlank = options.some((option) => option.value === "");
  const toInternal = (candidate: string): string =>
    candidate === "" && offersBlank ? BLANK : candidate;

  return (
    <Select
      value={toInternal(value)}
      onValueChange={(next) => onValueChange(fromInternal(next))}
      disabled={closed}
      required={required}
      {...(name === undefined ? {} : { name })}
    >
      <SelectTrigger
        {...(id === undefined ? {} : { id })}
        {...(label === undefined ? {} : { "aria-label": label })}
        {...(describedBy === undefined || describedBy === ""
          ? {}
          : { "aria-describedby": describedBy })}
        aria-invalid={invalid ? true : undefined}
        aria-required={required ? true : undefined}
        aria-busy={pending ? true : undefined}
        className={cn(className)}
        {...(testId === undefined ? {} : { "data-testid": testId })}
      >
        <SelectValue placeholder={isEmpty ? emptyLabel : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {isEmpty ? (
          /*
           * Not a `SelectItem`: an unselectable row is still a row a keyboard
           * lands on. This is a sentence in the menu, and the trigger is closed
           * anyway — it exists so the reason survives if the list empties while
           * the menu is open.
           */
          <p id={emptyId} className="px-3 py-2 text-sm text-muted">
            {emptyLabel}
          </p>
        ) : (
          options.map((option) => (
            <SelectItem
              key={option.value}
              value={toInternal(option.value)}
              disabled={option.disabled === true}
              /*
               * The submitted value, in the DOM. Radix keeps it in React state
               * only, and an end-to-end test that has to identify a row by its
               * Thai label starts failing on copy edits rather than on
               * behaviour. This is the identifier the server would be handed.
               */
              data-value={option.value}
            >
              {option.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
