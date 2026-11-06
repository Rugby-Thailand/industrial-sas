/** Pure organization input rules and derivations; no database or ambient clock. */
import { fail, ok } from "../result";

export const validTaxId = (value: string) => /^[0-9]{13}$/.test(value);
export const normalizedNameKey = (name: string) => name.trim().toLowerCase();

export function validateBranchCodes(
  revenueBranchNo: string,
  ssoEmployerAccount: string,
  type: "HEAD_OFFICE" | "BRANCH",
) {
  if (!/^[0-9]{5}$/.test(revenueBranchNo))
    return fail({
      code: "REVENUE_BRANCH_NO_INVALID",
      field: "revenueBranchNo",
    });
  if ((type === "HEAD_OFFICE") !== (revenueBranchNo === "00000"))
    return fail({ code: "BRANCH_TYPE_MISMATCH", field: "type" });
  const account = ssoEmployerAccount.trim();
  if (!account)
    return fail({
      code: "SSO_EMPLOYER_ACCOUNT_REQUIRED",
      field: "ssoEmployerAccount",
    });
  if (account.length > 20 || !/^[0-9-]+$/.test(account))
    return fail({
      code: "SSO_EMPLOYER_ACCOUNT_INVALID",
      field: "ssoEmployerAccount",
    });
  return ok({ revenueBranchNo, ssoEmployerAccount: account });
}

/** Bangkok's local year, even during the seven hours before UTC New Year. */
export function employeeCodePrefix(now: number): string {
  const year = new Date(now + 420 * 60_000).getUTCFullYear();
  return String(year % 100).padStart(2, "0");
}

export function suggestEmployeeCode(codes: readonly string[], now: number) {
  const prefix = employeeCodePrefix(now);
  const pattern = new RegExp(`^${prefix}[0-9]{5}$`);
  let last = 0;
  for (const code of codes) {
    if (pattern.test(code)) last = Math.max(last, Number(code.slice(2)));
  }
  if (last === 99999) return fail({ code: "EMPLOYEE_CODE_EXHAUSTED" });
  return ok(`${prefix}${String(last + 1).padStart(5, "0")}`);
}

export function deriveManagementView<
  D extends { _id: string; managerEmployeeId?: string },
  E extends { _id: string; supervisorUserId?: string },
>(
  manager: { _id: string; userId?: string },
  departments: readonly D[],
  employees: readonly E[],
) {
  return {
    responsibleDepartments: departments.filter(
      (row) => row.managerEmployeeId === manager._id,
    ),
    subordinates:
      manager.userId === undefined
        ? []
        : employees.filter((row) => row.supervisorUserId === manager.userId),
  };
}

export const MAX_LOGO_BYTES = 256 * 1024;

/** Validate canonical base64 and the image signature before any domain write. */
export function validateCompanyLogo(mimeType: string, base64: string) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType))
    return fail({ code: "LOGO_FILE_INVALID", field: "mimeType" });
  if (base64.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4)
    return fail({ code: "LOGO_TOO_LARGE", field: "base64" });
  if (
    !base64 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    return fail({ code: "LOGO_FILE_INVALID", field: "base64" });
  try {
    const bytes = atob(base64);
    if (bytes.length > MAX_LOGO_BYTES)
      return fail({ code: "LOGO_TOO_LARGE", field: "base64" });
    const signatureMatches =
      mimeType === "image/png"
        ? bytes.startsWith("\x89PNG\r\n\x1a\n")
        : mimeType === "image/jpeg"
          ? bytes.startsWith("\xff\xd8\xff")
          : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
    if (!signatureMatches || btoa(bytes) !== base64)
      return fail({ code: "LOGO_FILE_INVALID", field: "base64" });
    return ok({ mimeType, base64 });
  } catch {
    return fail({ code: "LOGO_FILE_INVALID", field: "base64" });
  }
}
