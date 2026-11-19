type OutcomeDetails = {
  readonly code?: string;
  readonly field?: string;
  readonly requestId?: string;
  readonly replayed?: boolean;
};

type MutationOutcome = {
  readonly ok: boolean;
  readonly requestId?: string;
  readonly denial?: OutcomeDetails;
  readonly value?: OutcomeDetails & {
    readonly written: boolean;
    readonly documentId?: string;
    readonly error?: OutcomeDetails;
  };
};

export class WriteOutcomeError extends Error {
  override readonly name = "WriteOutcomeError";

  constructor(
    readonly kind: "denial" | "refusal",
    readonly code: string,
    readonly field: string | undefined,
    readonly requestId: string | undefined,
    readonly replayed: boolean | undefined,
  ) {
    // useAsyncOperation translates Error.message. Keep its existing copy key
    // while retaining the server's authorization code separately.
    super(kind === "denial" ? "ACCESS_DENIED" : code);
  }
}

/** The structured denial or refusal of an unwritten outcome; null once written. */
export function writeFailure(
  outcome: MutationOutcome,
): WriteOutcomeError | null {
  if (!outcome.ok) {
    const denial = outcome.denial;
    return new WriteOutcomeError(
      "denial",
      denial?.code ?? "ACCESS_DENIED",
      denial?.field,
      denial?.requestId ?? outcome.requestId,
      denial?.replayed,
    );
  }
  const value = outcome.value;
  if (value?.written) return null;
  const error = value?.error;
  return new WriteOutcomeError(
    "refusal",
    error?.code ?? "SAVE_FAILED",
    error?.field,
    error?.requestId ?? outcome.requestId,
    error?.replayed ?? value?.replayed,
  );
}

/** Keep receipt/failure metadata at the write boundary, including absent flags. */
export function requireWritten(outcome: MutationOutcome) {
  const failure = writeFailure(outcome);
  if (failure) throw failure;
  const value = outcome.value!;
  return {
    ...value,
    written: true as const,
    requestId: value.requestId ?? outcome.requestId,
  };
}

/** The written document ID ("" when the command returns none). */
export function written(outcome: MutationOutcome): string {
  return requireWritten(outcome).documentId ?? "";
}
