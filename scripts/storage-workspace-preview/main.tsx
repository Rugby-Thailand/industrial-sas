import { Profiler, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { FloorMap } from "@/components/storageLayouts/FloorMap";
import { WorkspaceFloorSelector } from "@/features/storageLayouts/WorkspaceFloorSelector";
import { EnvironmentProvider } from "@/components/providers/EnvironmentProvider";
import { floorMapDemo } from "@/components/storageLayouts/storageFloorDemoData";
import type { StorageFloorRow } from "@/lib/convex/storageLayoutApi";
import { pdApprovedPlan } from "../../convex/model/storageLayout/pdApprovedPlan";
import { messagesFor } from "@/i18n/messages";
import "../../src/app/globals.css";
declare global {
  interface Window {
    __storageWorkspaceProfile: { phase: string; actualDuration: number }[];
  }
}
window.__storageWorkspaceProfile = [];
function App() {
  const locale =
    new URLSearchParams(window.location.search).get("locale") === "th"
      ? "th"
      : "en";
  const [floorNumber, setFloor] = useState(2);
  const [dark, setDark] = useState(true);
  const { building, floors, layouts } = useMemo(() => {
    const demo = floorMapDemo(false, false),
      plan = pdApprovedPlan();
    const empty =
      new URLSearchParams(window.location.search).get("fixture") === "empty";
    const pd = {
      ...demo,
      widthMm: plan.widthMm,
      depthMm: plan.depthMm,
      baseWidthMm: plan.widthMm,
      baseDepthMm: plan.depthMm,
      buildingCode: "DEMO-PD",
      floorNumber: 2,
      zones: plan.cells.map((cell, index) => ({
        ...demo.zones[3]!,
        ...cell,
        zoneId: cell.code,
        locationId: cell.code,
        label: cell.code,
        positions: [],
        placements:
          !empty && [7, 12].includes(index)
            ? [
                {
                  ...demo.zones[0]!.placements[0]!,
                  placementId: `demo-${index}`,
                  handlingUnitId: `demo-${index}`,
                  lpn: `DEMO-P-${index}`,
                  status:
                    index === 7 ? ("STORED" as const) : ("RESERVED" as const),
                  widthMm: 1000,
                  depthMm: 1000,
                  xMm: 0,
                  yMm: 0,
                },
              ]
            : [],
        maxStackHeightMm: 3300,
        qrValue: `DEMO:LOCATION:${cell.code}`,
      })),
      blocks: plan.blocks,
    };
    const layouts = [demo, pd];
    const floors: StorageFloorRow[] = layouts.map((layout, index) => ({
      floorId: `demo-floor-${index + 1}`,
      floorNumber: index + 1,
      widthMm: layout.widthMm,
      depthMm: layout.depthMm,
      heightMm: layout.heightMm,
      grossAreaSqMm: layout.widthMm * layout.depthMm,
      reservedAreaSqMm: 0,
      usableAreaSqMm: layout.widthMm * layout.depthMm,
      version: 1,
      storageZones: layout.zones,
      reservedBlocks: layout.blocks.map((block, index) => ({
        ...block,
        blockId: `demo-block-${index}`,
      })),
    }));
    const building = {
      buildingId: "demo",
      warehouseId: "demo",
      code: "DEMO-PD",
      name: "Storage Planner demo",
      widthMm: pd.widthMm,
      depthMm: pd.depthMm,
      defaultFloorHeightMm: pd.heightMm,
      floorCount: 2,
      totalHeightMm: pd.heightMm * 2,
      grossAreaSqMm: 0,
      reservedAreaSqMm: 0,
      usableAreaSqMm: 0,
      status: "DRAFT" as const,
      version: 1,
    };
    return { building, floors, layouts };
  }, []);
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messagesFor(locale)}
      timeZone="Asia/Bangkok"
    >
      <EnvironmentProvider>
        <main className="mx-auto max-w-[1920px] p-3 sm:p-6">
          <header className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p
                style={{ color: dark ? "#cbd5e1" : "#475569" }}
                className="text-xs"
              >
                Buildings & spots / DEMO-PD
              </p>
              <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
                Storage Planner
              </h1>
              <p
                style={{ color: dark ? "#cbd5e1" : "#475569" }}
                className="mt-1 text-xs"
              >
                Demo data · PD / Floor 2
              </p>
            </div>
            <button
              className="min-h-11 rounded-lg border border-border px-3 text-sm"
              onClick={() => {
                document.documentElement.className = dark ? "light" : "dark";
                setDark(!dark);
              }}
            >
              Light / dark
            </button>
          </header>
          <Profiler
            id="workspace"
            onRender={(_id, phase, actualDuration) =>
              window.__storageWorkspaceProfile.push({ phase, actualDuration })
            }
          >
            <FloorMap
              key={floorNumber}
              {...layouts[floorNumber - 1]!}
              previewOnly
              floorSelector={
                <WorkspaceFloorSelector
                  building={building}
                  floors={floors}
                  selectedFloorNumber={floorNumber}
                  onSelect={setFloor}
                  editAction={null}
                />
              }
            />
          </Profiler>
        </main>
      </EnvironmentProvider>
    </NextIntlClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
