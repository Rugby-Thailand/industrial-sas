import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";
import { PageContainer } from "@/components/ui/PageContainer";

export default function HrLayout(props: RouteMessagesLayoutProps) {
  return (
    <PageContainer size="wide">
      <RouteMessages scope="(desktop)/hr" {...props} />
    </PageContainer>
  );
}
