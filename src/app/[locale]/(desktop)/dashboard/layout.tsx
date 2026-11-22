import { PageContainer } from "@/components/ui/PageContainer";
import {
  RouteMessages,
  type RouteMessagesLayoutProps,
} from "@/i18n/RouteMessages";

export default function Layout(props: RouteMessagesLayoutProps) {
  return (
    <PageContainer size="form">
      <RouteMessages scope="(desktop)/dashboard" {...props} />
    </PageContainer>
  );
}
