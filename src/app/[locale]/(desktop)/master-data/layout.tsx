import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function MasterDataLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/master-data" {...props} />;
}
