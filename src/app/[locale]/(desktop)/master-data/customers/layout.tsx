import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function CustomersLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(desktop)/master-data/customers" {...props} />;
}
