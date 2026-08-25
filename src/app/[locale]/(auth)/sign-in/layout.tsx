import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function SignInLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(auth)/sign-in" {...props} />;
}
