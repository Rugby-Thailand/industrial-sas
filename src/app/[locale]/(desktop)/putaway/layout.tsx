import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function PutawayLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/putaway" {...props} />;
}
