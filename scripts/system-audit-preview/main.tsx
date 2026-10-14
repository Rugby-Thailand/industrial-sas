import { createRoot } from "react-dom/client";
import { useEffect, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { messagesFor } from "@/i18n/messages";
import { EnvironmentProvider } from "@/components/providers/EnvironmentProvider";
import { resolveAppEnvironment } from "@/lib/environment";
import { BuildingModelWorkspace } from "@/features/storageLayouts/StorageLayoutScreens";
import { StorageZonesPanel } from "@/features/storageLayouts/StorageZonesPanel";
import { FloorLocationTable } from "@/components/storageLayouts/FloorLocationTable";
import { StorageLocationCatalogue } from "@/features/storageLayouts/StorageLocationCatalogue";
import { NamedLocationCatalogue } from "@/features/storageLayouts/NamedLocationCatalogue";
import { HrProfileScreen } from "@/features/hr/ProfileScreen";
import { OrganizationRequired } from "@/components/auth/OrganizationRequired";
import { WorkspaceAccessBoundary } from "@/components/providers/WorkspaceAccessBoundary";
import { DestinationScanner } from "@/features/finishedGoods/DestinationScanner";
import { LocationPicker } from "@/features/finishedGoods/jobScan/LocationPicker";
import {
  JobScanScreen,
  LocationSummary,
} from "@/features/finishedGoods/jobScan/JobScanScreen";
import { JobScanRecordRow } from "@/features/finishedGoods/jobScan/JobScanRecordRow";
import { params, locale, zone, building, floors, record } from "./data";
import "../../src/app/globals.css";

const view = params.get("view") ?? "workspace";
document.documentElement.lang = locale;
document.documentElement.className =
  params.get("theme") === "dark" ? "dark" : "light";
// No real camera is accessed. Camera failure/retry presentation remains real.
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: {
    getUserMedia: async () => {
      throw new Error("Demo camera unavailable");
    },
  },
});
const environment = resolveAppEnvironment({
  convexUrl: "https://example.convex.cloud",
  clerkPublishableKey: "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk",
});
const reject = async () => {
  throw new Error("Visual fixture performs no writes");
};
function Organization() {
  const [content, setContent] = useState<ReactNode>(null);
  useEffect(() => {
    let active = true;
    void OrganizationRequired().then((node) => {
      if (active) setContent(node);
    });
    return () => {
      active = false;
    };
  }, []);
  return content;
}
function Surface() {
  switch (view) {
    case "organization":
      return <Organization />;
    case "workspace-error":
      return (
        <WorkspaceAccessBoundary>
          <p>Demo workspace</p>
        </WorkspaceAccessBoundary>
      );
    case "profile":
      return <HrProfileScreen />;
    case "zone-card":
      return (
        <StorageZonesPanel
          warehouseId="audit-warehouse"
          buildingId="audit-building"
          floorNumber={2}
          floorWidthMm={12000}
          floorDepthMm={10000}
          floorHeightMm={3500}
          zones={[zone]}
          layoutStatus="ACTIVE"
        />
      );
    case "floor-list":
      return <FloorLocationTable zones={[zone]} onSelect={() => {}} />;
    case "catalogue":
      return (
        <StorageLocationCatalogue warehouseId="audit-warehouse">
          {() => null}
        </StorageLocationCatalogue>
      );
    case "named":
      return (
        <NamedLocationCatalogue
          warehouseId="audit-warehouse"
          search=""
          status="ALL"
          building="ALL"
          floor="ALL"
        />
      );
    case "destination":
      return (
        <DestinationScanner onCode={reject} expectedLocation={zone.code} />
      );
    case "picker":
      return (
        <LocationPicker
          warehouseId="audit-warehouse"
          onPick={() => {}}
          canReadImage
        />
      );
    case "job-scan":
      return <JobScanScreen />;
    case "scan-summary":
      return <LocationSummary code={zone.code} name={zone.label} mapped />;
    case "record":
      return (
        <ul>
          <JobScanRecordRow
            record={record}
            canManage={false}
            selected={false}
            disabled={false}
            onToggle={() => {}}
            onChangeLocation={() => {}}
            onDelete={() => {}}
            onEdit={() => {}}
          />
        </ul>
      );
    default:
      return <BuildingModelWorkspace building={building} floors={floors} />;
  }
}
createRoot(document.getElementById("root")!).render(
  <NextIntlClientProvider
    locale={locale}
    messages={messagesFor(locale)}
    timeZone="Asia/Bangkok"
  >
    <EnvironmentProvider environment={environment}>
      <div className="mx-auto max-w-7xl p-3 sm:p-6">
        <p className="mb-4 text-xs text-muted" data-audit-fixture>
          Isolated UI audit · demo data · {view}
        </p>
        <Surface />
      </div>
    </EnvironmentProvider>
  </NextIntlClientProvider>,
);
