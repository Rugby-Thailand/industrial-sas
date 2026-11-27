// Nested next-intl providers replace messages instead of merging them.
import type { MessageCatalogue } from "./messages";

export type MessageNamespace = keyof MessageCatalogue;

export const SHELL_NAMESPACES = [
  "App",
  "Error",
  "Locale",
  "Navigation",
  "Panel",
  "Search",
  "Workspace",
] as const satisfies readonly MessageNamespace[];

export const ROUTE_NAMESPACES = {
  "(auth)/sign-in": ["App", "Setup"],
  "(desktop)/master-data": [
    "App",
    "Workspace",
    "StorageLayouts",
    "JobScan",
    "Pagination",
    "Panel",
    "Table",
    "WriteError",
  ],
  // Customer pages only: storage pages under master-data do not carry it.
  "(desktop)/master-data/customers": [
    "App",
    "Workspace",
    "Customers",
    "CustomerLine",
    "Pagination",
    "Panel",
    "Table",
  ],
  "(desktop)/finished-goods": [
    "App",
    "Workspace",
    "FinishedGoods",
    "JobScan",
    "Pagination",
    "Panel",
    "Table",
    "WriteError",
  ],
  "(desktop)/dashboard": [
    "App",
    "Home",
    "Navigation",
    "Panel",
    "Setup",
    "WriteError",
  ],
  "(desktop)/ai-usage": ["App", "AiUsage", "FilterCalendar", "Panel", "Table"],
  "(desktop)/setup": ["App", "Setup"],
  "(desktop)/hr": [
    "App",
    "FilterCalendar",
    "Hr",
    "Navigation",
    "Panel",
    "Table",
  ],
} as const satisfies Record<string, readonly MessageNamespace[]>;

export type RouteMessageScope = keyof typeof ROUTE_NAMESPACES;

export function pickMessages<K extends MessageNamespace>(
  messages: Readonly<Record<string, unknown>>,
  namespaces: readonly K[],
): Pick<MessageCatalogue, K> {
  const picked: Record<string, unknown> = {};
  for (const namespace of namespaces) {
    const value = messages[namespace];
    if (value === undefined) {
      throw new Error(
        `Message namespace "${namespace}" is not in the catalogue. ` +
          "Update src/i18n/clientMessages.ts or messages/*.json.",
      );
    }
    picked[namespace] = value;
  }
  return picked as Pick<MessageCatalogue, K>;
}
