import type { Doc } from "../_generated/dataModel";
import type { TenantDocumentAccess } from "../lib/tenantDb";
import { suggestNextCustomerCode } from "../model/customers/customers";

export function customerCodeSequenceKey(code: string): string | undefined {
  const match = /^C-([0-9]+)$/.exec(code);
  if (!match?.[1]) return undefined;
  const digits = BigInt(match[1]).toString();
  return `${digits.length.toString().padStart(2, "0")}:${digits}`;
}

export async function nextCustomerCode(
  db: TenantDocumentAccess,
): Promise<string> {
  const [highest] = await db
    .byIndex<Doc<"customers">>("customers", "by_orgId_codeSequenceKey")
    .take(1, "desc");
  return suggestNextCustomerCode(
    highest?.codeSequenceKey ? BigInt(highest.code.slice(2)) : 0n,
  );
}
