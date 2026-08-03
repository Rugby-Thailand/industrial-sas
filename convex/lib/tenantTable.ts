/**
 * Construction helpers that make `orgId`-first tenancy structural rather than
 * remembered (D-18, `ADR-0002` §1, `INV-0002-02`).
 *
 * Status: **schema foundation only.** These helpers shape table definitions.
 * They are not an access wrapper: nothing here reads or writes a document, and
 * `convex/lib/tenantDb.ts` (the tenant-bound accessor, `G-102`) does not exist
 * yet.
 *
 * The point of the two helpers below is that the discipline is applied by
 * construction. `tenantFields` puts `orgId` in the document, and `byOrg` puts it
 * first in the index, so a tenant table cannot be declared without the
 * discriminator and an index cannot be declared that starts with anything else.
 * `convex/lib/schemaPolicy.ts` still proves both properties by reading the
 * finished schema, because a helper that is bypassed proves nothing.
 */
import { v, type GenericValidator } from "convex/values";

/**
 * The tenant discriminator (`G-002`). The Convex document ID of the
 * organization is the internal key; the Clerk organization ID is the external
 * correlation key (`ADR-0001` §1). It is never accepted from the client
 * (`INV-0001-02`).
 */
export const orgIdField = v.id("organizations");

/** The document field name every tenant table and tenant index begins with. */
export const TENANT_DISCRIMINATOR = "orgId";

/** The literal type of the discriminator, so the guards below can name it once. */
type TenantDiscriminator = typeof TENANT_DISCRIMINATOR;

/**
 * A validator map that does not itself declare the tenant discriminator.
 *
 * The optional-`never` member is what makes `tenantFields({ orgId: ... })` a
 * compile error instead of a silent override: the property may be absent, and no
 * validator is assignable to `never` if it is present.
 */
export type TenantFieldSpec = Record<string, GenericValidator> & {
  [Key in TenantDiscriminator]?: never;
};

/** The document fields of a tenant table: the discriminator, then the rest. */
export type TenantDocumentFields<Fields extends TenantFieldSpec> = {
  [Key in TenantDiscriminator]: typeof orgIdField;
} & Fields;

/**
 * Declare the fields of a tenant-scoped table.
 *
 * `orgId` is supplied here and only here, so a caller cannot choose the
 * discriminator's validator, make it optional, or point it at another table. It
 * is written first, so it is also the first declared field in the generated
 * types, in a dashboard view, and in `schemaPolicy`'s reading of the schema.
 *
 * A caller-provided `orgId` is rejected twice: `TenantFieldSpec` makes it a type
 * error, and the loop below throws if the type check was bypassed — by a cast, by
 * JavaScript, or by a spread whose contents the compiler cannot see. Overwriting
 * it silently would be worse than either, because the resulting table would look
 * correct in review.
 */
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

/**
 * Declare an index on a tenant table.
 *
 * Returns the field list with `orgId` prepended, so `byOrg("status")` is the
 * index `["orgId", "status"]`. There is deliberately no way to express an index
 * on a tenant table that does not start with `orgId`: such an index would make a
 * cross-tenant scan the cheapest query in the table. Naming the discriminator
 * again in the rest — `byOrg("orgId")` — throws, because a duplicated field is a
 * sign the caller believes they are choosing the prefix.
 *
 * Consequence worth stating: a query like "every membership of this user across
 * organizations" is not expressible here. That is intended — organization
 * switching is Clerk's (`ADR-0001` §2), so the WMS never needs to enumerate a
 * user's tenants.
 */
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
