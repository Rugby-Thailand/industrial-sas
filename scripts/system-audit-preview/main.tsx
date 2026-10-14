import { createRoot } from "react-dom/client";
import { useEffect, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { messagesFor } from "@/i18n/messages";
import { EnvironmentProvider } from "@/components/providers/EnvironmentProvider";
import { resolveAppEnvironment } from "@/lib/environment";
import {
  BuildingModelWorkspace,
  StorageBuildingReview,
} from "@/features/storageLayouts/StorageLayoutScreens";
import { FloorMap } from "@/components/storageLayouts/FloorMap";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
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
// No real camera is accessed. An explicit demo mode supplies a synthetic stream.
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: {
    getUserMedia: async () => {
      if (params.get("camera") === "demo") {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Demo canvas unavailable");
        const draw = () => {
          context.fillStyle = "#17202c";
          context.fillRect(0, 0, 640, 360);
          context.fillStyle = "#ffffff";
          context.font = "24px sans-serif";
          context.fillText("Synthetic demo camera", 170, 180);
        };
        draw();
        const stream = canvas.captureStream(10);
        requestAnimationFrame(draw);
        return stream;
      }
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
    case "review":
      return <StorageBuildingReview buildingId="audit-building" />;
    case "fallback":
      return (
        <FloorMap
          widthMm={12000}
          depthMm={10000}
          heightMm={3500}
          baseWidthMm={12000}
          baseDepthMm={10000}
          offsetXMm={0}
          offsetYMm={0}
          baseLabel="Demo warehouse"
          buildingCode="DEMO"
          floorNumber={2}
          zones={[zone]}
          blocks={[]}
        />
      );
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
        <NavigationGuardProvider>
          <Surface />
        </NavigationGuardProvider>
      </div>
    </EnvironmentProvider>
  </NextIntlClientProvider>,
);
