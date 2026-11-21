import { fail, ok, type Result } from "../result";

const ASCII_TAX_ID = /^[0-9]{13}$/;
const BRANCH_CODE = /^[0-9]{5}$/;

export const CUSTOMER_ALIAS_MAX_LENGTH = 200;

export const CUSTOMER_LINK_SOURCES = ["AUTO", "MANUAL", "UNLINKED"] as const;
export type CustomerLinkSource = (typeof CUSTOMER_LINK_SOURCES)[number];

export const CUSTOMER_FIELD_LIMITS = {
  name: 200,
  legalNameTh: 200,
  legalNameEn: 200,
  notes: 2000,
  deliveryAddress: {
    label: 200,
    line: 200,
    subdistrict: 200,
    district: 200,
    province: 200,
    postcode: 10,
  },
  contact: { name: 200, role: 200, phone: 32, email: 254 },
} as const;

export type CustomerEstablishment =
  { kind: "HEAD_OFFICE" } | { kind: "BRANCH"; code: string };

export type CustomerDeliveryAddress = Partial<
  Record<keyof typeof CUSTOMER_FIELD_LIMITS.deliveryAddress, string>
>;
export type CustomerContact = Partial<
  Record<keyof typeof CUSTOMER_FIELD_LIMITS.contact, string>
>;

export interface CustomerEditableInput {
  name: string;
  legalNameTh?: string;
  legalNameEn?: string;
  taxId?: string;
  establishment?: CustomerEstablishment;
  deliveryAddress?: CustomerDeliveryAddress;
  contact?: CustomerContact;
  notes?: string;
}

export function normalizeCustomerName(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

export function normalizeTaxId(raw: string): string | null {
  const id = raw.replace(/[\s-]/gu, "");
  return ASCII_TAX_ID.test(id) ? id : null;
}

export function normalizeCustomerAlias(raw: string): string {
  return normalizeCustomerName(raw);
}

export function validateCustomerAlias(
  raw: string,
): Result<{ alias: string; normalizedAlias: string }, FieldError> {
  const alias = raw.trim();
  const normalizedAlias = normalizeCustomerAlias(alias);
  if (!normalizedAlias || alias.length > CUSTOMER_ALIAS_MAX_LENGTH)
    return invalidField("alias");
  return ok({ alias, normalizedAlias });
}

/**
 * Comparable stem used ONLY for suggesting review candidates, never for
 * automatic linking. Strips common Thai/English legal wrappers and spacing so
 * e.g. "บจก.ไทยรุ่งเรือง บรรจุภัณฑ์" proposes "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด".
 */
const THAI_LEGAL_WRAPPER = new RegExp(
  [
    "ห้างหุ้นส่วนจำกัด",
    "จำกัด\\s*\\(มหาชน\\)",
    "จำกัด",
    "\\(มหาชน\\)",
    "บริษัท",
    "บจก\\.?",
    "บมจ\\.?",
    "หจก\\.?",
  ]
    .map((token) => token.normalize("NFKC"))
    .join("|"),
  "gu",
);

export function compactCustomerStem(raw: string): string {
  return normalizeCustomerName(raw)
    .replace(
      /(?:^|\s)(?:co\.?,?\s*ltd\.?|company\s+limited|limited|ltd\.?|inc\.?|pcl\.?)(?=\s|$|\.)/gu,
      " ",
    )
    .replace(THAI_LEGAL_WRAPPER, " ")
    .replace(/[\s.,()ฯ/\\-]+/gu, "");
}

export type ExactCustomerMatch =
  | { readonly kind: "UNMATCHED" }
  | { readonly kind: "MATCHED"; readonly customerId: string }
  | { readonly kind: "ARCHIVED"; readonly customerId: string }
  | { readonly kind: "AMBIGUOUS"; readonly customerIds: readonly string[] };

/**
 * Exact matching links automatically ONLY when all canonical-name and
 * approved-alias hits resolve to a single ACTIVE customer. Archived claims and
 * multi-customer collisions stay unlinked for human review.
 */
export function classifyExactCustomerMatches(
  hits: readonly {
    readonly customerId: string;
    readonly status: "ACTIVE" | "ARCHIVED";
  }[],
): ExactCustomerMatch {
  const byId = new Map<string, "ACTIVE" | "ARCHIVED">();
  for (const hit of hits) byId.set(hit.customerId, hit.status);
  if (byId.size === 0) return { kind: "UNMATCHED" };
  if (byId.size > 1)
    return { kind: "AMBIGUOUS", customerIds: [...byId.keys()] };
  const entry = [...byId.entries()][0]!;
  const [customerId, status] = entry;
  if (status === "ARCHIVED") return { kind: "ARCHIVED", customerId };
  return { kind: "MATCHED", customerId };
}

export function isValidThaiTaxIdChecksum(id: string): boolean {
  if (!ASCII_TAX_ID.test(id)) return false;
  let weightedSum = 0;
  for (let index = 0; index < 12; index += 1) {
    weightedSum += Number(id[index]) * (13 - index);
  }
  return (11 - (weightedSum % 11)) % 10 === Number(id[12]);
}

export function isValidCustomerEstablishment(
  establishment: CustomerEstablishment,
): boolean {
  return (
    establishment.kind === "HEAD_OFFICE" ||
    (BRANCH_CODE.test(establishment.code) && establishment.code !== "00000")
  );
}

export function suggestNextCustomerCode(
  highestExisting: number | bigint = 0,
): string {
  return `C-${(BigInt(highestExisting) + 1n).toString().padStart(4, "0")}`;
}

type FieldError = { code: "FIELD_INVALID"; field: string };
const invalidField = (field: string) =>
  fail({ code: "FIELD_INVALID" as const, field });

function optionalTextFields<Field extends string>(
  fields: Partial<Record<NoInfer<Field>, string>> | undefined,
  limits: Readonly<Record<Field, number>>,
  prefix = "",
): Result<Partial<Record<Field, string>> | undefined, FieldError> {
  if (!fields) return ok(undefined);
  const cleaned: Partial<Record<Field, string>> = {};
  for (const field in limits) {
    const value = fields[field]?.trim();
    if (!value) continue;
    if (value.length > limits[field]) return invalidField(prefix + field);
    cleaned[field] = value;
  }
  return ok(Object.keys(cleaned).length > 0 ? cleaned : undefined);
}

export function validateCustomerFields(input: CustomerEditableInput) {
  const { establishment } = input;
  const name = input.name.trim();
  const normalizedName = normalizeCustomerName(name);
  if (!normalizedName || name.length > CUSTOMER_FIELD_LIMITS.name)
    return invalidField("name");

  const text = optionalTextFields(input, {
    legalNameTh: CUSTOMER_FIELD_LIMITS.legalNameTh,
    legalNameEn: CUSTOMER_FIELD_LIMITS.legalNameEn,
    notes: CUSTOMER_FIELD_LIMITS.notes,
  });
  if (!text.ok) return text;
  const rawTaxId = input.taxId?.trim();
  const taxId = rawTaxId ? normalizeTaxId(rawTaxId) : undefined;
  if (taxId === null) return invalidField("taxId");
  if (establishment && !isValidCustomerEstablishment(establishment))
    return invalidField("establishment.code");

  const deliveryAddress = optionalTextFields(
    input.deliveryAddress,
    CUSTOMER_FIELD_LIMITS.deliveryAddress,
    "deliveryAddress.",
  );
  if (!deliveryAddress.ok) return deliveryAddress;

  const contact = optionalTextFields(
    input.contact,
    CUSTOMER_FIELD_LIMITS.contact,
    "contact.",
  );
  if (!contact.ok) return contact;
  const email = contact.value?.email;
  // One plain mailbox: no spaces, separators or URL syntax around one "@".
  if (email !== undefined && !/^[^\s@,;?#&/]+@[^\s@,;?#&/]+$/u.test(email))
    return invalidField("contact.email");

  // Undefined optional fields are part of the patch, so an edit can clear them.
  return ok({
    name,
    normalizedName,
    legalNameTh: text.value?.legalNameTh,
    legalNameEn: text.value?.legalNameEn,
    taxId,
    establishment,
    deliveryAddress: deliveryAddress.value,
    contact: contact.value,
    notes: text.value?.notes,
  });
}
