import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function HandheldReceiveLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(handheld)/handheld/receive" {...props} />;
}
