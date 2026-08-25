import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function InboundLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/inbound" {...props} />;
}
