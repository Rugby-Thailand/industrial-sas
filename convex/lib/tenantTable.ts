import { v, type GenericValidator } from "convex/values";

export const orgIdField = v.id("organizations");

export const TENANT_DISCRIMINATOR = "orgId";

type TenantDiscriminator = typeof TENANT_DISCRIMINATOR;

export type TenantFieldSpec = Record<string, GenericValidator> & {
  [Key in TenantDiscriminator]?: never;
};

export type TenantDocumentFields<Fields extends TenantFieldSpec> = {
  [Key in TenantDiscriminator]: typeof orgIdField;
} & Fields;

export function tenantFields<Fields extends TenantFieldSpec>(
  fields: Fields,
): TenantDocumentFields<Fields> {
  const supplied: Record<string, GenericValidator> = fields;
  const declared: Record<string, GenericValidator> = {
    [TENANT_DISCRIMINATOR]: orgIdField,
  };

  for (const [name, validator] of Object.entries(supplied)) {
    if (name === TENANT_DISCRIMINATOR) {
      throw new Error(
        `tenantFields() received its own "${TENANT_DISCRIMINATOR}" field. The ` +
          "tenant discriminator is supplied by this helper and is never taken " +
          "from a caller (INV-0001-02); remove it from the field list.",
      );
    }
    declared[name] = validator;
  }

  return declared as TenantDocumentFields<Fields>;
}

export function byOrg<const Rest extends string[]>(
  ...rest: Rest
): [TenantDiscriminator, ...Rest] {
  for (const field of rest) {
    if (field === TENANT_DISCRIMINATOR) {
      throw new Error(
        `byOrg() received "${TENANT_DISCRIMINATOR}" as an index field. The ` +
          "discriminator is always the prefix and must not be repeated; pass " +
          "only the fields that follow it.",
      );
    }
  }

  return [TENANT_DISCRIMINATOR, ...rest];
}
