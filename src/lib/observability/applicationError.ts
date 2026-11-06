import { GENERATED_REFERENCE_ALPHABET, isFailureReference } from "./dimensions";
import { observabilityEvent, type ObservabilityEvent } from "./event";

export const APPLICATION_RENDER_ERROR_CODE = "application.render.failed";

export function applicationRenderErrorEvent(
  boundary: "locale" | "global",
  occurredAt: number,
  /** The reference shown to the member and the page's route (any form). */
  context: { readonly reference?: string; readonly route?: string } = {},
): ObservabilityEvent {
  return observabilityEvent({
    code: APPLICATION_RENDER_ERROR_CODE,
    severity: "error",
    dimensions: { boundary, ...context },
    occurredAt,
  });
}

/** One caught failure as the member sees it: what to quote, and when. */
export interface RenderFailureOccurrence {
  readonly reference: string;
  readonly occurredAt: number;
}

const occurrences = new WeakMap<object, RenderFailureOccurrence>();

/**
 * The reference and time of a caught error, fixed the first time it is asked
 * for, so every render (and the recorded event) agrees. Next's digest names a
 * server error in the server logs; any other failure gets a random reference.
 */
export function renderFailureOccurrence(
  error: Error & { readonly digest?: string },
): RenderFailureOccurrence {
  let occurrence = occurrences.get(error);
  if (occurrence === undefined) {
    occurrence = {
      reference: isFailureReference(error.digest)
        ? error.digest
        : generatedReference(),
      occurredAt: Date.now(),
    };
    occurrences.set(error, occurrence);
  }
  return occurrence;
}

function generatedReference(): string {
  const alphabet = GENERATED_REFERENCE_ALPHABET;
  return Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (byte) => alphabet[byte % alphabet.length],
  ).join("");
}
