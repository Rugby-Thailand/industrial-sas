import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function HandheldQualityLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(handheld)/handheld/quality" {...props} />;
}
