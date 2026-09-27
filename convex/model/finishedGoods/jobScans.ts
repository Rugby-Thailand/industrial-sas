/** Fields read from a Top Gold job ticket (FM-PD-02). Only the two identities are required. */
export type JobTicketFields = {
  factoryOrder: string;
  productBarcodeText: string;
  deliveryDate?: string;
  partName?: string;
  customer?: string;
  manufacturingDate?: string;
  quantity?: number;
  factoryQuantity?: number;
  customerQuantity?: number;
};

const TEXT_FIELDS = {
  factory_order: "factoryOrder",
  product_barcode_text: "productBarcodeText",
  delivery_date: "deliveryDate",
  part_name: "partName",
  customer: "customer",
  manufacturing_date: "manufacturingDate",
} as const;
const NUMBER_FIELDS = {
  quantity: "quantity",
  factory_quantity: "factoryQuantity",
  customer_quantity: "customerQuantity",
} as const;

/** JSON schema sent to the model; every key is present, unreadable values are null. */
export const JOB_TICKET_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...Object.keys(TEXT_FIELDS), ...Object.keys(NUMBER_FIELDS)],
  properties: {
    ...Object.fromEntries(
      Object.keys(TEXT_FIELDS).map((key) => [
        key,
        { type: ["string", "null"] },
      ]),
    ),
    ...Object.fromEntries(
      Object.keys(NUMBER_FIELDS).map((key) => [
        key,
        { type: ["number", "null"] },
      ]),
    ),
  },
} as const;

export const JOB_TICKET_PROMPT = `You read Thai factory job tickets (form FM-PD-02, "JOB NO."). Return JSON only.
- factory_order: the JOB NO. value, e.g. "FO69070073".
- product_barcode_text: the human-readable text printed under the product barcode (บาร์โค้ดสินค้า), e.g. "FBN-BXVMI004-BOX-00F".
- delivery_date (วันที่ส่งสินค้า) and manufacturing_date (วันที่ผลิต): copy exactly as printed, keep the Thai Buddhist year, e.g. "6/7/2569".
- part_name (ชื่อสินค้า) and customer (ชื่อลูกค้า): copy exactly, character by character. Do not correct spelling.
- quantity (จำนวน), factory_quantity (จ.น.แผ่น/พาเลท ตอนออกจากโรงงาน), customer_quantity (จ.น.แผ่น/พาเลท ตอนลงงานให้ลูกค้า): numbers without separators.
Use null for anything missing or unreadable. Never guess.`;

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[,\s]/g, "");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Normalizes model output (snake_case, strings or numbers) into partial ticket fields. */
export function parseJobTicket(raw: unknown): Partial<JobTicketFields> {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const fields: Partial<JobTicketFields> = {};
  for (const [key, field] of Object.entries(TEXT_FIELDS)) {
    const value = source[key] ?? source[field];
    if (typeof value === "string" && value.trim()) fields[field] = value.trim();
  }
  for (const [key, field] of Object.entries(NUMBER_FIELDS)) {
    const value = toNumber(source[key] ?? source[field]);
    if (value !== undefined) fields[field] = value;
  }
  return fields;
}

/** A job ticket barcode is either the JOB NO. (FO…) or the product barcode. */
export function classifyTicketBarcode(
  code: string,
): "factoryOrder" | "productBarcodeText" {
  return /^FO\d{4,}$/i.test(code.trim())
    ? "factoryOrder"
    : "productBarcodeText";
}

export function jobTicketError(fields: {
  factoryOrder: string;
  productBarcodeText: string;
}): string | null {
  if (!fields.factoryOrder.trim()) return "FACTORY_ORDER_REQUIRED";
  if (!fields.productBarcodeText.trim()) return "PRODUCT_BARCODE_REQUIRED";
  if (
    fields.factoryOrder.length > 100 ||
    fields.productBarcodeText.length > 200
  )
    return "FIELD_TOO_LONG";
  return null;
}
