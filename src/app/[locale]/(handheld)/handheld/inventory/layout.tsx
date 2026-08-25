import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function HandheldInventoryLayout(
  props: RouteMessagesLayoutProps,
) {
  return <RouteMessages scope="(handheld)/handheld/inventory" {...props} />;
}
