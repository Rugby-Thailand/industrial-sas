import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function EngineeringLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/engineering" {...props} />;
}
