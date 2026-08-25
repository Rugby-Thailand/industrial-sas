import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function DashboardLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/dashboard" {...props} />;
}
