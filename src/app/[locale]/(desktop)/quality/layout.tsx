import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function QualityLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/quality" {...props} />;
}
