import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function InventoryLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/inventory" {...props} />;
}
