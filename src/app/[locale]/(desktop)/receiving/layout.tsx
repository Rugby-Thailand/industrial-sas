import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function ReceivingLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/receiving" {...props} />;
}
