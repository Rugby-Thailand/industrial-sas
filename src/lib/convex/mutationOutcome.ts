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
