import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

/** Client messages used only by the cross-workflow inbound control board. */
export default function InboundLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/inbound" {...props} />;
}
