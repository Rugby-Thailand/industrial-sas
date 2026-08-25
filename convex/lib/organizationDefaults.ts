import type { OrganizationSettings } from "./validators";

export const DEFAULT_TIMEZONE = "Asia/Bangkok";

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

export const CAPABILITY_FLAGS = [
  "serialTrackingEnabled",
  "mixedContentEnabled",
  "consignedStockEnabled",
  "negativeAvailableAllowed",
  "supportGrantsEnabled",
] as const satisfies readonly (keyof OrganizationSettings)[];

export function enabledCapabilityFlags(
  settings: OrganizationSettings,
): readonly (typeof CAPABILITY_FLAGS)[number][] {
  return CAPABILITY_FLAGS.filter((flag) => settings[flag]);
}
