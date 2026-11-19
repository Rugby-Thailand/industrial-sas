import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

/** Storage-layout pages only; customer pages load their own messages. */
export default function StorageLayoutsLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/master-data" {...props} />;
}
