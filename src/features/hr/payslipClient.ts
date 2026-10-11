import { pdfBytes, pdfHash } from "../../../convex/model/hr/payslip";

/** SDK-supported hint; verification takes place in Clerk and is checked by Convex. */
export function payslipReverificationHint(minutes: number) {
  return {
    clerk_error: {
      type: "forbidden" as const,
      reason: "reverification-error" as const,
      metadata: {
        reverification: {
          level: "first_factor" as const,
          afterMinutes: minutes,
        },
      },
    },
  };
}

export class PayslipAccessError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function requirePayslipOutcome<T>(
  outcome: { ok: false } | { ok: true; value: T },
): T {
  if (!outcome.ok) throw new PayslipAccessError("DENIED");
  return outcome.value;
}
/** Verify the original bytes before creating any local download URL. */
export async function downloadPrivatePayslip(
  value: {
    base64: string;
    sha256: string;
    expiresAt: number;
    fileName: string;
  },
  isCurrent: () => boolean,
): Promise<void> {
  if (value.expiresAt <= Date.now() || !isCurrent())
    throw new PayslipAccessError("PAYSLIP_TICKET_EXPIRED");
  const bytes = pdfBytes(value.base64);
  if (!bytes || (await pdfHash(bytes)) !== value.sha256.toLowerCase())
    throw new PayslipAccessError("PAYSLIP_SOURCE_INTEGRITY_FAILED");
  if (value.expiresAt <= Date.now() || !isCurrent())
    throw new PayslipAccessError("PAYSLIP_TICKET_EXPIRED");
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
  );
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = value.fileName.replace(/[\\/]/g, "_");
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
