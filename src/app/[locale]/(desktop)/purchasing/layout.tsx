import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function PurchasingLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/purchasing" {...props} />;
}
