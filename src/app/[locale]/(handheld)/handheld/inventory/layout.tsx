import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

/**
 * The client message scope for the handheld stock lookup.
 *
 * This layout adds no markup. It exists so the namespaces below it are shipped
 * to this subtree and to no other — `@/i18n/clientMessages` holds the set and
 * the reasoning, and `clientMessages.test.ts` proves it still matches what the
 * client components here actually ask for.
 */
export default function HandheldInventoryLayout(
  props: RouteMessagesLayoutProps,
) {
  return <RouteMessages scope="(handheld)/handheld/inventory" {...props} />;
}
