import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function HandheldPutawayLayout(props: RouteMessagesLayoutProps) {
  return <RouteMessages scope="(handheld)/handheld/putaway" {...props} />;
}
