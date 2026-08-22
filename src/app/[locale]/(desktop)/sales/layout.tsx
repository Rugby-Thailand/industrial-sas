import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function SalesLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/sales" {...props} />;
}
