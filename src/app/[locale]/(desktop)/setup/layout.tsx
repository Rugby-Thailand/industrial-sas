import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function SetupLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/setup" {...props} />;
}
