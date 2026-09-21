import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";
import { PageContainer } from "@/components/ui/PageContainer";

export default function FinishedGoodsLayout(props: RouteMessagesLayoutProps) {
  return (
    <PageContainer>
      <RouteMessages scope="(desktop)/finished-goods" {...props} />
    </PageContainer>
  );
}
