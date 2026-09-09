// Nested next-intl providers replace messages instead of merging them.
import type { MessageCatalogue } from "./messages";

export type MessageNamespace = keyof MessageCatalogue;

export const SHELL_NAMESPACES = [
  "App",
  "Error",
  "Locale",
  "Navigation",
  "Panel",
  "Workspace",
] as const satisfies readonly MessageNamespace[];

export const ROUTE_NAMESPACES = {
  "(auth)/sign-in": ["App", "Setup"],
  "(desktop)/master-data": [
    "App",
    "StorageLayouts",
    "Pagination",
    "Panel",
    "Table",
    "Write",
    "WriteError",
  ],
  "(desktop)/setup": ["App", "Setup"],
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
