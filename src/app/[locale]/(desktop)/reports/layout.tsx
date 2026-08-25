import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function ReportsLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/reports" {...props} />;
}
