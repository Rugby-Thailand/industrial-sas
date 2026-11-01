import { defineTable } from "convex/server";
import { v } from "convex/values";
import { byOrg, tenantFields } from "../../lib/tenantTable";

export const separationType = v.union(
  v.literal("RESIGNATION"),
  v.literal("TERMINATION"),
);
export const employmentStateValidator = v.union(
  v.literal("PROBATION"),
  v.literal("ACTIVE"),
  v.literal("INACTIVE"),
  v.literal("RESIGNED"),
  v.literal("TERMINATED"),
);

/** Optional lifecycle fields on `hrEmployees`; legacy records have none. */
export const employeeLifecycleFields = {
  probationConfirmedDate: v.optional(v.string()),
  separation: v.optional(
    v.object({
      type: separationType,
      lastWorkingDate: v.string(),
      reason: v.string(),
    }),
  ),
};

const text = v.optional(v.string());
export const profileFields = {
  title: text,
  firstName: text,
  lastName: text,
  firstNameEn: text,
  lastNameEn: text,
  nickname: text,
  gender: v.optional(
    v.union(v.literal("MALE"), v.literal("FEMALE"), v.literal("OTHER")),
  ),
  birthDate: text,
  nationalId: text,
  nationality: text,
  religion: text,
  maritalStatus: v.optional(
    v.union(
      v.literal("SINGLE"),
      v.literal("MARRIED"),
      v.literal("DIVORCED"),
      v.literal("WIDOWED"),
    ),
  ),
  email: text,
  phone: text,
  lineId: text,
  address: text,
  province: text,
  postalCode: text,
  emergencyName: text,
  emergencyRelationship: text,
  emergencyPhone: text,
};
/**
 * Save arguments: an omitted field keeps its stored value and an empty
 * string clears it, so a caller that does not know a field never erases it.
 */
export const profileUpdateArgs = {
  ...profileFields,
  gender: v.optional(
    v.union(
      v.literal("MALE"),
      v.literal("FEMALE"),
      v.literal("OTHER"),
      v.literal(""),
    ),
  ),
  maritalStatus: v.optional(
    v.union(
      v.literal("SINGLE"),
      v.literal("MARRIED"),
      v.literal("DIVORCED"),
      v.literal("WIDOWED"),
      v.literal(""),
    ),
  ),
};
export const paymentFields = {
  method: v.union(v.literal("BANK"), v.literal("CASH")),
  bankName: text,
  accountNumber: text,
  accountName: text,
  bankBranchCode: text,
};

const audit = {
  version: v.number(),
  createdAt: v.number(),
  createdByUserId: v.id("users"),
  updatedAt: v.number(),
  updatedByUserId: v.id("users"),
};

export const hrEmployeeProfileTables = {
  /** Personal, contact and emergency-contact details; one per employee. */
  hrEmployeeProfiles: defineTable(
    tenantFields({
      employeeId: v.id("hrEmployees"),
      ...profileFields,
      ...audit,
    }),
  ).index("by_orgId_employeeId", byOrg("employeeId")),
  /** Private payment details; one per employee, never listed or searched. */
  hrEmployeePayments: defineTable(
    tenantFields({
      employeeId: v.id("hrEmployees"),
      ...paymentFields,
      ...audit,
    }),
  ).index("by_orgId_employeeId", byOrg("employeeId")),
  /** Append-only effective-dated lifecycle events; never patched or deleted. */
  hrEmploymentEvents: defineTable(
    tenantFields({
      employeeId: v.id("hrEmployees"),
      warehouseId: v.id("warehouses"),
      type: v.union(
        v.literal("PROBATION_CONFIRMED"),
        v.literal("RESIGNED"),
        v.literal("TERMINATED"),
        v.literal("REINSTATED"),
      ),
      effectiveDate: v.string(),
      reason: v.optional(v.string()),
      fromState: employmentStateValidator,
      toState: employmentStateValidator,
      employeeVersion: v.number(),
      recordedAt: v.number(),
      recordedByUserId: v.id("users"),
    }),
  ).index("by_orgId_employeeId_recordedAt", byOrg("employeeId", "recordedAt")),
};
