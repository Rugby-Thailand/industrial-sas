Profile `iter2` · 2026-11-04T15:24:13.910Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@4352b15b (convex sha256:d2f9e425256dc7eb), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 20.5/4.1

| Screen | Function | Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| job-scan | `finishedGoods/jobScans:listJobScans` (search) | 2389 | 1541.1 | 576.93 | 523.67 | 22 | 21.5 |  |
| storage | `storageLayouts/catalogue:getStorageBuilding` | 1844 | 1328.2 | 184.66 | 197.11 | 1 | 453.4 | legacy (no live subscriber) |
| fg-pallet | `finishedGoods/workflow:list` | 1440 | 914.8 | 176.67 | 178.14 | 1 | 925.4 | legacy (no live subscriber) |
| storage | `storageLayouts/catalogue:getStorageLocationMap` | 936 | 671.6 | 109.57 | 109.46 | 1 | 376.2 | legacy (no live subscriber) |
| job-scan | `finishedGoods/jobScanLocations:searchPage` | 896 | 474.3 | 160 | 152.22 | 2 | 0.8 |  |
| fg-pallet | `finishedGoods/workflow:recommendMove` | 687 (was 2887) | 1284.0 | 194.53 | 504.66 | 1 | 238.5 |  |
| fg-pallet | `finishedGoods/workflow:recommend` | 686 (was 2886) | 1283.3 | 406.72 | 1128.65 | 1 | 238.3 |  |
| storage | `storageLayouts/locationCatalogue:detail` | 312 | 274.5 | 94.86 | 94.66 | 1 | 62.6 |  |
| fg-catalogue | `finishedGoods/catalogue:summary` | 272 | 136.9 | 97.39 | 82.02 | 2 | 1.6 |  |
| hr-admin | `hr/review:queuePage` | 251 | 139.4 | 69.05 | 72.8 | 2 | 9.9 |  |
| job-scan | `finishedGoods/jobScanLocations:options` | 218 | 134.8 | 30.29 | 29.56 | 1 | 13.2 |  |
| hr-admin | `hr/periods:preview` | 164 | 114.0 | 17.75 | 18.06 | 1 | 0.8 |  |
| hr-admin | `hr/roster:roster` | 162 | 112.8 | 17.11 | 17.07 | 1 | 0.1 | LIMIT_EXCEEDED |
| hr-admin | `hr/setup:employeesPage` | 141 | 83.6 | 20.61 | 20.4 | 1 | 15.0 |  |
| hr-admin | `hr/search:adminEmployees` | 111 | 75.2 | 16.18 | 15.47 | 1 | 1.5 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab) | 110 | 55.1 | 49.75 | 56.44 | 1 | 74.0 |  |
| storage | `storageLayouts/locationCatalogue:options` | 109 | 69.1 | 13.95 | 14.8 | 1 | 14.5 |  |
| storage | `storageLayouts/locationCatalogue:page` | 83 | 52.8 | 21.51 | 21.46 | 1 | 25.8 |  |
| fg-pallet | `finishedGoods/workflow:getPallet` | 75 | 50.9 | 43.1 | 54.09 | 1 | 2.3 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab) | 65 | 39.2 | 73.29 | 70.08 | 1 | 75.3 |  |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search) | 65 | 39.2 | 53.25 | 52.04 | 1 | 75.3 |  |
| job-scan | `finishedGoods/jobScanLocations:buildingOptions` | 61 | 37.8 | 15.16 | 13.64 | 1 | 7.7 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` | 60 | 36.9 | 34.04 | 33.87 | 1 | 21.3 |  |
| job-scan | `finishedGoods/jobScans:listJobScans` (unmapped) | 60 | 37.0 | 32.94 | 32.92 | 1 | 21.3 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingInventory` | 34 (was 1829) | 963.6 | 61.23 | 222.08 | 1 | 447.8 |  |
| fg-product | `finishedGoods/batches:pageLegacyUnits` | 31 | 17.7 | 33.06 | 50.22 | 1 | 15.8 |  |
| storage | `storageLayouts/catalogue:listStorageBuildingsPage` | 29 | 16.2 | 13.03 | 13.52 | 1 | 13.7 |  |
| hr-admin | `hr/periods:versionRowsPage` | 29 | 16.3 | 11.66 | 12.29 | 1 | 9.4 |  |
| hr-admin | `hr/setup:accessMembersPage` | 26 | 8.4 | 13.37 | 13.59 | 1 | 0.6 |  |
| storage | `storageLayouts/catalogue:getStorageBuildingLayout` | 25 | 14.3 | 14.4 | 14.48 | 1 | 7.4 |  |
| storage | `storageLayouts/writes:layoutReadiness` | 25 | 14.3 | 14.15 | 14.16 | 1 | 1.9 |  |
| storage | `storageLayouts/catalogue:buildingOccupancy` | 20 (was 917) | 8.1 | 11.47 | 95.73 | 1 | 1.0 |  |
| hr-admin | `hr/setup:employee` | 19 | 6.2 | 11.73 | 11.14 | 1 | 0.6 |  |
| ai-usage | `aiUsage/dimensions:actorOptions` | 17 | 5.3 | 10.81 | 10.56 | 1 | 0.4 |  |
| shell | `workspace/current:readCurrent` | 16 | 5.0 | 27.69 | 19.67 | 1 | 0.5 |  |
| shell | `hr/access:display` | 16 | 5.3 | 20.16 | 17.05 | 1 | 0.7 |  |
| job-scan | `finishedGoods/jobScanLocations:resolve` | 15 | 6.2 | 13.3 | 13.52 | 1 | 0.6 |  |
| hr-self | `hr/self:today` | 14 | 6.3 | 11.89 | 12.94 | 1 | 0.8 |  |
| job-scan | `finishedGoods/scanning:resolveLocationCode` | 13 | 5.0 | 11.72 | 12.17 | 1 | 0.5 |  |
| fg-product | `finishedGoods/catalogue:productSummary` | 12 | 4.3 | 21.84 | 23.83 | 1 | 0.3 |  |
| hr-self | `hr/self:profile` | 12 | 4.1 | 10.89 | 10.92 | 1 | 0.6 |  |
| hr-self | `hr/self:history` | 12 | 5.6 | 11.21 | 11.41 | 1 | 1.6 |  |
| shell | `aiUsage/reports:access` | 11 | 3.4 | 15.18 | 14.02 | 1 | 0.2 |  |
| fg-product | `finishedGoods/batches:getBatch` | 11 | 3.7 | 19.85 | 23.57 | 1 | 1.0 |  |
| storage | `storageLayouts/catalogue:buildingStatusControl` | 11 | 4.4 | 11.3 | 11.3 | 1 | 0.1 |  |
| hr-admin | `hr/leave:queuePage` | 11 | 3.4 | 10.69 | 10.93 | 1 | 0.2 |  |
| fg-product | `finishedGoods/workflow:getProduct` | 10 | 3.4 | 19.34 | 33.64 | 1 | 0.7 |  |
| fg-product | `finishedGoods/batches:pageProductBatches` | 10 | 3.2 | 23.09 | 23.56 | 1 | 0.1 |  |
| fg-pallet | `finishedGoods/history:palletMoveHistory` | 10 | 3.4 | 14.99 | 14.95 | 1 | 0.1 |  |
| fg-pallet | `finishedGoods/workflow:stackChoices` | 10 | 3.4 | 11.31 | 11.03 | 1 | 0.1 |  |
| job-scan | `finishedGoods/scanning:resolvePackageCode` | 10 | 3.5 | 11.06 | 11.29 | 1 | 0.1 | NOT_OK |
| hr-self | `hr/self:requests` | 10 | 4.3 | 10.59 | 10.17 | 1 | 0.6 |  |
| hr-admin | `hr/periods:listPage` | 10 | 3.4 | 10.44 | 10.64 | 1 | 0.5 |  |
| job-scan | `finishedGoods/jobScanLocations:page` | 9 | 2.9 | 11.93 | 11.52 | 1 | 0.2 |  |
| hr-self | `hr/announcements:self` | 9 | 3.4 | 10.22 | 10.39 | 1 | 0.1 |  |
| hr-self | `hr/notifications:list` | 9 | 3.4 | 10.32 | 10.2 | 1 | 0.2 |  |
| hr-self | `hr/leave:self` | 9 | 3.4 | 10.97 | 11.2 | 1 | 0.3 |  |
| hr-admin | `hr/roster:shifts` | 9 | 2.8 | 9.68 | 9.62 | 1 | 0.2 |  |
| hr-admin | `hr/payslips:list` | 9 | 3.4 | 10.87 | 10.4 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/payslips:imports` | 8 | 2.7 | 10.56 | 10.1 | 1 | 0.1 | POLICY_NOT_ACTIVE |
| hr-admin | `hr/org:listDepartments` | 8 | 2.7 | 9.93 | 9.51 | 1 | 0.1 |  |
| ai-usage | `aiUsage/reports:summary` | 8 | 2.7 | 9.9 | 10.26 | 1 | 1.2 |  |
| ai-usage | `aiUsage/reports:recent` | 8 | 2.7 | 10.03 | 9.67 | 1 | 0.1 |  |

**candidate: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans` | 10 | 4 | 22 | 11.59 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan` | 13 | 4 | 22 | 12.09 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans` | 13 | 4 | 22 | 11.88 |
| job-scan save batch of 50 (max) | `finishedGoods/jobScans:saveJobScans` | 10 | 53 | 218 | 17.33 |
| pallet measurement save | `finishedGoods/workflow:saveMeasurement` | 22 | 5 | 33 | 12.6 |

**candidate: reactive fan-out** (60 subscriptions open on one session)

| Write | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---:|---:|---:|---:|---:|---|
| saveJobScans (1 item) | 2 | 122 | 64.1 | 29.7 | 0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs) |
| reserve (awaiting pallet) | 10 | 1692 | 2737.0 | 780.5 | 2 (272) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/workflow:recommendMove×1 (688 docs); finishedGoods/workflow:recommend×1 (687 docs) |
| cancelReservation (same pallet) | 10 | 1692 | 2735.0 | 795 | 1 (210) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/workflow:recommend×1 (687 docs); finishedGoods/workflow:recommendMove×1 (688 docs) |
| createPallet (busiest product) | 7 | 310 | 165.2 | 210.2 | 2 (272) | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (246 docs) |

**candidate: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 33.2 ms / max 40 ms

**candidate: contention** 8 concurrent createPallet (same product) → executions 21, OCC retries 13, failures 0, RTT p50 197.4 ms / max 322 ms

**base: write flows**

| Flow | Function | Docs read | Docs written | Index rows | Exec p50 ms |
|---|---|---:|---:|---:|---:|
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans` | 10 | 4 | 22 | 12.01 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan` | 13 | 4 | 22 | 11.35 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans` | 13 | 4 | 22 | 11.48 |
| job-scan save batch of 50 (max) | `finishedGoods/jobScans:saveJobScans` | 10 | 53 | 218 | 16.63 |
| pallet measurement save | `finishedGoods/workflow:saveMeasurement` | 21 | 5 | 33 | 11.75 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions |
|---|---:|---:|---:|---:|---:|---|
| saveJobScans (1 item) | 2 | 122 | 64.0 | 34.3 | 0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs) |
| reserve (awaiting pallet) | 10 | 6092 | 3805.2 | 1197.5 | 2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/workflow:recommendMove×1 (2888 docs); finishedGoods/workflow:recommend×1 (2887 docs) |
| cancelReservation (same pallet) | 10 | 6090 | 3803.5 | 1149.3 | 1 (210) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/workflow:recommend×1 (2886 docs); finishedGoods/workflow:recommendMove×1 (2887 docs) |
| createPallet (busiest product) | 7 | 310 | 165.2 | 180.6 | 2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (246 docs) |

**base: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 35.7 ms / max 41.9 ms

**base: contention** 8 concurrent createPallet (same product) → executions 22, OCC retries 14, failures 0, RTT p50 238.3 ms / max 506.1 ms
