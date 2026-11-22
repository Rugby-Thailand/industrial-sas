import { v } from "convex/values";

export const customerStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("ARCHIVED"),
);

export const customerLinkArg = v.union(
  v.object({ action: v.literal("KEEP") }),
  v.object({ action: v.literal("SET"), customerId: v.id("customers") }),
  v.object({ action: v.literal("CLEAR") }),
);

export const customerLinkSource = v.union(
  v.literal("AUTO"),
  v.literal("MANUAL"),
  v.literal("UNLINKED"),
);

export const customerAliasFields = {
  customerId: v.id("customers"),
  alias: v.string(),
  normalizedAlias: v.string(),
  exampleJobScanId: v.optional(v.id("finishedGoodsJobScans")),
  approvedAt: v.number(),
  approvedByUserId: v.id("users"),
};

const establishment = v.union(
  v.object({ kind: v.literal("HEAD_OFFICE") }),
  v.object({ kind: v.literal("BRANCH"), code: v.string() }),
);

const deliveryAddress = v.object({
  label: v.optional(v.string()),
  line: v.optional(v.string()),
  subdistrict: v.optional(v.string()),
  district: v.optional(v.string()),
  province: v.optional(v.string()),
  postcode: v.optional(v.string()),
});

const contact = v.object({
  name: v.optional(v.string()),
  role: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
});

export const editableCustomerFields = {
  name: v.string(),
  legalNameTh: v.optional(v.string()),
  legalNameEn: v.optional(v.string()),
  taxId: v.optional(v.string()),
  establishment: v.optional(establishment),
  deliveryAddress: v.optional(deliveryAddress),
  contact: v.optional(contact),
  notes: v.optional(v.string()),
};

export const customerFields = {
  ...editableCustomerFields,
  code: v.string(),
  normalizedName: v.string(),
  status: customerStatus,
  version: v.number(),
  createdAt: v.number(),
  createdByUserId: v.id("users"),
  updatedAt: v.number(),
  updatedByUserId: v.id("users"),
  archivedAt: v.optional(v.number()),
  archivedByUserId: v.optional(v.id("users")),
};

export const customerLatestJob = v.object({
  jobScanId: v.id("finishedGoodsJobScans"),
  factoryOrder: v.string(),
  createdAt: v.number(),
  warehouseId: v.id("warehouses"),
});

export const customerSummary = v.object({
  customerId: v.id("customers"),
  code: v.string(),
  name: v.string(),
  status: customerStatus,
  province: v.optional(v.string()),
});

export const customerDetailFields = {
  ...customerFields,
  orgId: v.id("organizations"),
  _id: v.id("customers"),
  _creationTime: v.number(),
  customerId: v.id("customers"),
};
