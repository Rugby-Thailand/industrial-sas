/**
 * Safe organization defaults (§7.1, D-05, D-06, D-07, D-09…D-12, `ADR-0006` §7).
 *
 * Status: **schema foundation only.** Nothing applies these defaults yet:
 * provisioning is Clerk webhook work that this task deliberately excludes, so
 * there is no code path that creates an organization document.
 *
 * The defaults live here, apart from the validators, because "which values are
 * legal" and "which values a new tenant starts with" are different decisions
 * with different review audiences. Keeping them in one constant means the
 * safe-by-default claim is a single assertion rather than a habit spread across
 * a provisioning function, a seed, and a runbook.
 */
import type { OrganizationSettings } from "./validators";

/** IANA timezone every business date is derived from by default (D-05, `G-105`). */
export const DEFAULT_TIMEZONE = "Asia/Bangkok";

/**
 * The settings a newly provisioned organization starts with.
 *
 * Every capability flag is `false`. Each one gates behaviour the MVP does not
 * ship or does not want silently available: serial flows (D-09), mixed SKU/lot
 * handling units (D-10), consigned stock (D-11), negative `AVAILABLE` balances
 * (D-12), and cross-tenant support access (`ADR-0006` §7, `INV-0006-08`).
 *
 * Frozen so a caller cannot mutate the shared default and change what the next
 * tenant is provisioned with.
 */
export const DEFAULT_ORGANIZATION_SETTINGS: Readonly<OrganizationSettings> =
  Object.freeze({
    timezone: DEFAULT_TIMEZONE,
    locale: "th",
    currency: "THB",
    serialTrackingEnabled: false,
    mixedContentEnabled: false,
    consignedStockEnabled: false,
    negativeAvailableAllowed: false,
    supportGrantsEnabled: false,
  });

/**
 * The settings fields that unlock a capability, as opposed to the ones that
 * merely describe locale and presentation.
 *
 * Declared explicitly rather than derived from "every boolean", so adding a
 * boolean that is not a capability is a conscious act and adding a capability
 * that is not listed here fails the default-safety test.
 */
export const CAPABILITY_FLAGS = [
  "serialTrackingEnabled",
  "mixedContentEnabled",
  "consignedStockEnabled",
  "negativeAvailableAllowed",
  "supportGrantsEnabled",
] as const satisfies readonly (keyof OrganizationSettings)[];

/**
 * The capability flags enabled in the given settings.
 *
 * Used by tests to assert the default set enables nothing, and available later
 * to entitlement and policy code that needs to report why an operation is
 * unavailable rather than merely refusing it.
 */
export function enabledCapabilityFlags(
  settings: OrganizationSettings,
): readonly (typeof CAPABILITY_FLAGS)[number][] {
  return CAPABILITY_FLAGS.filter((flag) => settings[flag]);
}
