import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";
import { PageContainer } from "@/components/ui/PageContainer";
export default function Layout(props: RouteMessagesLayoutProps) {
  return (
    <PageContainer size="wide">
      <RouteMessages scope="(desktop)/ai-usage" {...props} />
    </PageContainer>
  );
}
