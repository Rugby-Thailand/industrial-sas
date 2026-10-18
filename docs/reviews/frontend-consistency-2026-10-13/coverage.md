# Frontend audit source inventory

13 October 2026. Current working tree, including untracked production source. This is the inventory/search boundary; detailed findings identify the implementations read and compared. Tests, screenshots and `_prototype` directories were excluded from production counts; test coverage was inventoried separately. API/support files under `src` remain listed for completeness.

335 source files; 40 `page.tsx` routes; 54,703 lines at the initial inventory.

## src/app (57)

- `src/app/[locale]/(auth)/sign-in/SignInScreen.tsx`
- `src/app/[locale]/(auth)/sign-in/[...sign-in]/page.tsx`
- `src/app/[locale]/(auth)/sign-in/layout.tsx`
- `src/app/[locale]/(auth)/sign-in/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/batches/[batchId]/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/layout.tsx`
- `src/app/[locale]/(desktop)/finished-goods/new/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/pallets/[palletId]/measure/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/pallets/[palletId]/move/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/pallets/[palletId]/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/pallets/[palletId]/stack/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/pallets/[palletId]/storage/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/products/[productId]/packing/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/products/[productId]/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/scan/page.tsx`
- `src/app/[locale]/(desktop)/finished-goods/scan/records/page.tsx`
- `src/app/[locale]/(desktop)/hr/customize/page.tsx`
- `src/app/[locale]/(desktop)/hr/employees/page.tsx`
- `src/app/[locale]/(desktop)/hr/holidays/page.tsx`
- `src/app/[locale]/(desktop)/hr/layout.tsx`
- `src/app/[locale]/(desktop)/hr/page.tsx`
- `src/app/[locale]/(desktop)/hr/periods/[periodId]/page.tsx`
- `src/app/[locale]/(desktop)/hr/periods/page.tsx`
- `src/app/[locale]/(desktop)/hr/profile/page.tsx`
- `src/app/[locale]/(desktop)/hr/requests/[requestId]/page.tsx`
- `src/app/[locale]/(desktop)/hr/requests/page.tsx`
- `src/app/[locale]/(desktop)/hr/review/page.tsx`
- `src/app/[locale]/(desktop)/hr/settings/page.tsx`
- `src/app/[locale]/(desktop)/hr/time/[date]/page.tsx`
- `src/app/[locale]/(desktop)/hr/time/page.tsx`
- `src/app/[locale]/(desktop)/hr/today/page.tsx`
- `src/app/[locale]/(desktop)/layout.tsx`
- `src/app/[locale]/(desktop)/loading.tsx`
- `src/app/[locale]/(desktop)/master-data/layout.tsx`
- `src/app/[locale]/(desktop)/master-data/storage-layouts/[buildingId]/floors/[floorNumber]/page.tsx`
- `src/app/[locale]/(desktop)/master-data/storage-layouts/[buildingId]/page.tsx`
- `src/app/[locale]/(desktop)/master-data/storage-layouts/[buildingId]/review/page.tsx`
- `src/app/[locale]/(desktop)/master-data/storage-layouts/demo/page.tsx`
- `src/app/[locale]/(desktop)/master-data/storage-layouts/new/page.tsx`
- `src/app/[locale]/(desktop)/master-data/storage-layouts/page.tsx`
- `src/app/[locale]/(desktop)/setup/layout.tsx`
- `src/app/[locale]/(desktop)/setup/page.tsx`
- `src/app/[locale]/(public)/about/page.tsx`
- `src/app/[locale]/(public)/layout.tsx`
- `src/app/[locale]/(public)/privacy/page.tsx`
- `src/app/[locale]/(public)/terms/page.tsx`
- `src/app/[locale]/[...rest]/page.tsx`
- `src/app/[locale]/error.tsx`
- `src/app/[locale]/layout.tsx`
- `src/app/[locale]/not-found.tsx`
- `src/app/[locale]/page.tsx`
- `src/app/api/ai/[[...slugs]]/route.ts`
- `src/app/api/uploadthing/core.ts`
- `src/app/api/uploadthing/route.ts`
- `src/app/global-error.tsx`
- `src/app/globals.css`

## src/components/auth (1)

- `src/components/auth/OrganizationRequired.tsx`

## src/components/examples (1)

- `src/components/examples/c-sidebar-2.tsx`

## src/components/providers (10)

- `src/components/providers/AppProviders.tsx`
- `src/components/providers/ConvexClientProvider.tsx`
- `src/components/providers/DraftGuardProvider.tsx`
- `src/components/providers/EnvironmentProvider.tsx`
- `src/components/providers/HrAccessProvider.tsx`
- `src/components/providers/IdentityProvider.tsx`
- `src/components/providers/ObservabilityProvider.tsx`
- `src/components/providers/WorkspaceAccessBoundary.tsx`
- `src/components/providers/WorkspaceProvider.tsx`
- `src/components/providers/draftGuard.ts`

## src/components/shell (14)

- `src/components/shell/AccountButton.tsx`
- `src/components/shell/DesktopShell.tsx`
- `src/components/shell/HrLandingRedirect.tsx`
- `src/components/shell/LocaleSwitcher.tsx`
- `src/components/shell/NavigationPendingIndicator.tsx`
- `src/components/shell/SidebarNavigationLink.tsx`
- `src/components/shell/WorkspaceContextBar.tsx`
- `src/components/shell/search/GlobalSearchProvider.tsx`
- `src/components/shell/search/SearchDialog.tsx`
- `src/components/shell/search/SearchDialogLoader.tsx`
- `src/components/shell/search/SearchTriggers.tsx`
- `src/components/shell/search/pageContext.ts`
- `src/components/shell/search/results.tsx`
- `src/components/shell/search/useAiSearch.ts`

## src/components/storageLayouts (26)

- `src/components/storageLayouts/AreaColorPicker.tsx`
- `src/components/storageLayouts/F1F2ReferencePreview.tsx`
- `src/components/storageLayouts/Fg1ReferencePreview.tsx`
- `src/components/storageLayouts/Fg1SourcePlan.tsx`
- `src/components/storageLayouts/FloorLocationTable.tsx`
- `src/components/storageLayouts/FloorMap.module.css`
- `src/components/storageLayouts/FloorMap.tsx`
- `src/components/storageLayouts/FloorMapCameraControls.tsx`
- `src/components/storageLayouts/FloorMapDemo.tsx`
- `src/components/storageLayouts/FloorMapDrawing.tsx`
- `src/components/storageLayouts/FloorWorkspaceLocationList.module.css`
- `src/components/storageLayouts/FloorWorkspaceLocationList.tsx`
- `src/components/storageLayouts/FloorWorkspaceToolbar.module.css`
- `src/components/storageLayouts/FloorWorkspaceToolbar.tsx`
- `src/components/storageLayouts/LocationDetailsHost.tsx`
- `src/components/storageLayouts/StorageZoneDraftPreview.tsx`
- `src/components/storageLayouts/StorageZoneVisualizer.tsx`
- `src/components/storageLayouts/floorMapGeometry.ts`
- `src/components/storageLayouts/floorPositionGeometry.ts`
- `src/components/storageLayouts/measureText.ts`
- `src/components/storageLayouts/storageFloorDemoData.ts`
- `src/components/storageLayouts/useFloorMapCamera.ts`
- `src/components/storageLayouts/useFloorMapPan.ts`
- `src/components/storageLayouts/useFloorMapViewport.ts`
- `src/components/storageLayouts/useFloorWorkspaceView.ts`
- `src/components/storageLayouts/useStorageLayoutMobile.ts`

## src/components/storageScene (3)

- `src/components/storageScene/SceneBox.tsx`
- `src/components/storageScene/SceneToolbar.tsx`
- `src/components/storageScene/sceneColors.ts`

## src/components/system (14)

- `src/components/system/CollectionToolbar.tsx`
- `src/components/system/CursorPagination.tsx`
- `src/components/system/DataGate.tsx`
- `src/components/system/LedgerPanelStatus.tsx`
- `src/components/system/NavigationProgress.tsx`
- `src/components/system/PageSizeSelect.tsx`
- `src/components/system/PaginationFooter.tsx`
- `src/components/system/PublicInfoNav.tsx`
- `src/components/system/QueryErrorBoundary.tsx`
- `src/components/system/QueryGate.tsx`
- `src/components/system/RouteLoading.tsx`
- `src/components/system/SetupChecklist.tsx`
- `src/components/system/WebVitals.tsx`
- `src/components/system/useNavigationGuard.tsx`

## src/components/table (1)

- `src/components/table/DataTable.tsx`

## src/components/ui (47)

- `src/components/ui/ButtonControl.tsx`
- `src/components/ui/CheckboxControl.tsx`
- `src/components/ui/CollapsibleSection.tsx`
- `src/components/ui/ConfirmDialog.tsx`
- `src/components/ui/DescriptionList.tsx`
- `src/components/ui/DetailsPanel.tsx`
- `src/components/ui/EmptyState.tsx`
- `src/components/ui/FormField.tsx`
- `src/components/ui/FormSelect.tsx`
- `src/components/ui/IconButton.tsx`
- `src/components/ui/Notice.tsx`
- `src/components/ui/PageBackButton.tsx`
- `src/components/ui/PageBackLink.tsx`
- `src/components/ui/PageBreadcrumbs.tsx`
- `src/components/ui/PageContainer.tsx`
- `src/components/ui/PageHeader.tsx`
- `src/components/ui/Panel.tsx`
- `src/components/ui/ScanCodeInput.tsx`
- `src/components/ui/ScanIcon.ts`
- `src/components/ui/SearchField.tsx`
- `src/components/ui/SectionHeader.tsx`
- `src/components/ui/SegmentedControl.tsx`
- `src/components/ui/SelectControl.tsx`
- `src/components/ui/StatusBadge.tsx`
- `src/components/ui/StatusReason.tsx`
- `src/components/ui/StickyActionBar.tsx`
- `src/components/ui/TableScroller.tsx`
- `src/components/ui/animated-toggle.tsx`
- `src/components/ui/avatar.tsx`
- `src/components/ui/breadcrumb.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/buttonVariants.ts`
- `src/components/ui/dialog.tsx`
- `src/components/ui/disclosure.ts`
- `src/components/ui/empty.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/label.tsx`
- `src/components/ui/pagination.tsx`
- `src/components/ui/progress.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/ui/skeleton.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/theme-toggle.tsx`
- `src/components/ui/tooltip.tsx`

## src/features/finishedGoods (54)

- `src/features/finishedGoods/BarcodeCameraBox.tsx`
- `src/features/finishedGoods/BarcodeCropControls.tsx`
- `src/features/finishedGoods/BarcodeImagePicker.tsx`
- `src/features/finishedGoods/BatchManager.tsx`
- `src/features/finishedGoods/CatalogueFilterControls.tsx`
- `src/features/finishedGoods/DestinationPicker.tsx`
- `src/features/finishedGoods/DestinationScanner.tsx`
- `src/features/finishedGoods/FinishedGoodsCatalogue.tsx`
- `src/features/finishedGoods/FinishedGoodsMobileList.tsx`
- `src/features/finishedGoods/FinishedGoodsTable.tsx`
- `src/features/finishedGoods/MoveScreen.tsx`
- `src/features/finishedGoods/PackingCompletion.tsx`
- `src/features/finishedGoods/PackingDimensionFields.tsx`
- `src/features/finishedGoods/PackingScreen.tsx`
- `src/features/finishedGoods/PalletScene.tsx`
- `src/features/finishedGoods/PalletScreens.tsx`
- `src/features/finishedGoods/PlacementEditor.tsx`
- `src/features/finishedGoods/ProductBatches.tsx`
- `src/features/finishedGoods/ProductScreen.tsx`
- `src/features/finishedGoods/ProductScreens.tsx`
- `src/features/finishedGoods/StackScreen.tsx`
- `src/features/finishedGoods/SummaryPreparation.tsx`
- `src/features/finishedGoods/barcodeDecoder.ts`
- `src/features/finishedGoods/barcodeImage.ts`
- `src/features/finishedGoods/barcodeImage.worker.ts`
- `src/features/finishedGoods/barcodeImagePipeline.ts`
- `src/features/finishedGoods/barcodeRegions.ts`
- `src/features/finishedGoods/catalogueFilters.ts`
- `src/features/finishedGoods/catalogueViewState.ts`
- `src/features/finishedGoods/jobScan/AddLocationForm.tsx`
- `src/features/finishedGoods/jobScan/JobScanPhotoPreview.tsx`
- `src/features/finishedGoods/jobScan/JobScanRecordRow.tsx`
- `src/features/finishedGoods/jobScan/JobScanRecords.tsx`
- `src/features/finishedGoods/jobScan/JobScanScreen.tsx`
- `src/features/finishedGoods/jobScan/LocationImageReader.tsx`
- `src/features/finishedGoods/jobScan/LocationPhotoCamera.tsx`
- `src/features/finishedGoods/jobScan/LocationPicker.tsx`
- `src/features/finishedGoods/jobScan/PhotoCapture.tsx`
- `src/features/finishedGoods/jobScan/TicketCard.tsx`
- `src/features/finishedGoods/jobScan/TicketFieldScanner.tsx`
- `src/features/finishedGoods/jobScan/playShutterSound.ts`
- `src/features/finishedGoods/jobScan/prepareLocationImage.ts`
- `src/features/finishedGoods/jobScan/resizeImage.ts`
- `src/features/finishedGoods/jobScan/ticketDraft.ts`
- `src/features/finishedGoods/packingRows.ts`
- `src/features/finishedGoods/paginationTestAdapter.ts`
- `src/features/finishedGoods/palletGeometry.ts`
- `src/features/finishedGoods/productPalletSummary.ts`
- `src/features/finishedGoods/shared.tsx`
- `src/features/finishedGoods/storageUnitLabels.ts`
- `src/features/finishedGoods/unitNextAction.ts`
- `src/features/finishedGoods/useBarcodeCamera.ts`
- `src/features/finishedGoods/useCatalogueState.ts`
- `src/features/finishedGoods/usePreviewState.ts`

## src/features/hr (24)

- `src/features/hr/CorrectionForm.tsx`
- `src/features/hr/DayDetailView.tsx`
- `src/features/hr/DayScreen.tsx`
- `src/features/hr/EmployeeForm.tsx`
- `src/features/hr/EmployeesScreen.tsx`
- `src/features/hr/HistoryScreen.tsx`
- `src/features/hr/HolidaysScreen.tsx`
- `src/features/hr/HrActionCard.tsx`
- `src/features/hr/HrShared.tsx`
- `src/features/hr/HrShortcuts.tsx`
- `src/features/hr/HrUi.tsx`
- `src/features/hr/PeriodDetailScreen.tsx`
- `src/features/hr/PeriodsScreen.tsx`
- `src/features/hr/ProfileScreen.tsx`
- `src/features/hr/RequestsScreen.tsx`
- `src/features/hr/ReviewDetail.tsx`
- `src/features/hr/ReviewScreen.tsx`
- `src/features/hr/SettingsScreen.tsx`
- `src/features/hr/ShortcutCustomizeScreen.tsx`
- `src/features/hr/TimeSideField.tsx`
- `src/features/hr/TodayScreen.tsx`
- `src/features/hr/format.ts`
- `src/features/hr/selfService.ts`
- `src/features/hr/useHrWrite.ts`

## src/features/storageKit (3)

- `src/features/storageKit/PlacementStatusBadge.tsx`
- `src/features/storageKit/QrCode.tsx`
- `src/features/storageKit/QrDialog.tsx`

## src/features/storageLayouts (15)

- `src/features/storageLayouts/AreaOverview.tsx`
- `src/features/storageLayouts/BuildingAreaDetails.tsx`
- `src/features/storageLayouts/BuildingStatusToggle.tsx`
- `src/features/storageLayouts/NamedLocationCatalogue.tsx`
- `src/features/storageLayouts/StorageLayoutScreens.tsx`
- `src/features/storageLayouts/StorageLocationCatalogue.tsx`
- `src/features/storageLayouts/StorageZonesPanel.tsx`
- `src/features/storageLayouts/WorkspaceFloorSelector.tsx`
- `src/features/storageLayouts/buildingInventory.ts`
- `src/features/storageLayouts/storageLayoutShared.tsx`
- `src/features/storageLayouts/types.ts`
- `src/features/storageLayouts/useFloorSelection.ts`
- `src/features/storageLayouts/useLocationCatalogueState.ts`
- `src/features/storageLayouts/useStorageBuilding.ts`
- `src/features/storageLayouts/useWorkspaceQuery.ts`

## src/hooks (12)

- `src/hooks/use-file-upload.ts`
- `src/hooks/use-mobile.ts`
- `src/hooks/useAsyncOperation.ts`
- `src/hooks/useCan.ts`
- `src/hooks/useCanManage.ts`
- `src/hooks/useCatalogueSync.ts`
- `src/hooks/useCursorPagination.ts`
- `src/hooks/useDraftKey.ts`
- `src/hooks/useMeasureFormat.ts`
- `src/hooks/useQueryHistoryWriter.ts`
- `src/hooks/useRequestIdentity.ts`
- `src/hooks/useScanContinuation.ts`

## src/i18n (8)

- `src/i18n/RouteMessages.tsx`
- `src/i18n/clientMessages.ts`
- `src/i18n/messages.ts`
- `src/i18n/navigation.ts`
- `src/i18n/navigationBase.ts`
- `src/i18n/navigationClient.tsx`
- `src/i18n/request.ts`
- `src/i18n/routing.ts`

## src/lib (44)

- `src/lib/ai/app.ts`
- `src/lib/ai/authenticate.ts`
- `src/lib/ai/client.ts`
- `src/lib/ai/searchContract.ts`
- `src/lib/auth/appAccess.ts`
- `src/lib/auth/returnPath.ts`
- `src/lib/browser/appHistory.ts`
- `src/lib/browser/history.ts`
- `src/lib/browser/scope.ts`
- `src/lib/browser/storage.ts`
- `src/lib/clerkConfiguration.ts`
- `src/lib/convex/batchManagementApi.ts`
- `src/lib/convex/clientRef.ts`
- `src/lib/convex/finishedGoodsApi.ts`
- `src/lib/convex/hrApi.ts`
- `src/lib/convex/ledgerApi.ts`
- `src/lib/convex/ledgerState.ts`
- `src/lib/convex/mutationOutcome.ts`
- `src/lib/convex/storageLayoutApi.ts`
- `src/lib/convex/workspaceApi.ts`
- `src/lib/deepLink.ts`
- `src/lib/environment.ts`
- `src/lib/format/measure.ts`
- `src/lib/navigation.ts`
- `src/lib/navigationGuard.ts`
- `src/lib/observability/applicationError.ts`
- `src/lib/observability/dimensions.ts`
- `src/lib/observability/event.ts`
- `src/lib/observability/port.ts`
- `src/lib/observability/webVitals.ts`
- `src/lib/resolveWriteError.ts`
- `src/lib/search/matchDestinations.ts`
- `src/lib/search/recordQuery.ts`
- `src/lib/search/resolveIntent.ts`
- `src/lib/securityHeaders.ts`
- `src/lib/storageLayouts/areaColors.ts`
- `src/lib/storageLayouts/isometricGeometry.ts`
- `src/lib/storageLayouts/locationSelectors.ts`
- `src/lib/storageLayouts/storageKit.ts`
- `src/lib/storageLayouts/storagePlacementGeometry.ts`
- `src/lib/uploadthing.ts`
- `src/lib/utils.ts`
- `src/lib/workspace/warehouseStore.ts`
- `src/lib/workspace/workspace.ts`

## src/proxy.ts (1)

- `src/proxy.ts`

## Concurrent additions and recheck

`src/hooks/useWorkflowStep.ts` was added by other work after the initial inventory and was read during consolidation. Final source comparisons also found navigation/draft-guard and direct-link fallback changes; these were retained and considered in the final report. Initial counts and detector results above remain a dated baseline, not a claim of a frozen tree. See the evidence JSON for the observed changed-file list.
