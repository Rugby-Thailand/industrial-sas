export function written(outcome: {
  readonly ok: boolean;
  readonly value?: {
    readonly written: boolean;
    readonly documentId?: string;
    readonly error?: { readonly code: string };
  };
}): string {
  if (!outcome.ok) throw new Error("ACCESS_DENIED");
  if (!outcome.value?.written)
    throw new Error(outcome.value?.error?.code ?? "SAVE_FAILED");
  return outcome.value.documentId ?? "";
}

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

/** Keep receipt/failure metadata at the write boundary, including absent flags. */
export function requireWritten(outcome: MutationOutcome) {
  if (!outcome.ok) {
    const denial = outcome.denial;
    throw new WriteOutcomeError(
      "denial",
      denial?.code ?? "ACCESS_DENIED",
      denial?.field,
      denial?.requestId ?? outcome.requestId,
      denial?.replayed,
    );
  }
  const value = outcome.value;
  if (!value?.written) {
    const error = value?.error;
    throw new WriteOutcomeError(
      "refusal",
      error?.code ?? "SAVE_FAILED",
      error?.field,
      error?.requestId ?? outcome.requestId,
      error?.replayed ?? value?.replayed,
    );
  }
  return {
    ...value,
    written: true as const,
    documentId: value.documentId ?? "",
    requestId: value.requestId ?? outcome.requestId,
  };
}
