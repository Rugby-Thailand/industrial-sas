import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function ProductionLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/production" {...props} />;
}
