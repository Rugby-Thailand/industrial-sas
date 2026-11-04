Profile `iter4` · 2026-11-04T16:36:32.796Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@00504646+dirty (convex sha256:2d07483e04c5d63c), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 13.0/8.1

| Screen       | Function                                               |      Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note                        |
| ------------ | ------------------------------------------------------ | -------------: | ------: | ----------: | ---------------: | -------: | --------: | --------------------------- |
| job-scan     | `finishedGoods/jobScans:listJobScans` (search)         |           2389 |  1541.1 |      567.73 |              536 |       22 |      21.5 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuilding`          |           1844 |  1328.2 |      318.81 |           534.87 |        1 |     453.4 | legacy (no live subscriber) |
| fg-pallet    | `finishedGoods/workflow:list`                          |           1440 |   914.8 |      180.02 |           177.46 |        1 |     925.4 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:getStorageLocationMap`       |            936 |   671.6 |      179.83 |           125.31 |        1 |     376.2 | legacy (no live subscriber) |
| job-scan     | `finishedGoods/jobScanLocations:searchPage`            |            896 |   474.3 |      347.63 |           418.21 |        2 |       0.8 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendMove`                 | 688 (was 2887) |  1284.5 |      163.41 |           366.46 |        1 |     238.5 |                             |
| fg-pallet    | `finishedGoods/workflow:recommend`                     | 687 (was 2886) |  1283.7 |       162.1 |            356.7 |        1 |     238.3 |                             |
| storage      | `storageLayouts/locationCatalogue:detail`              |            312 |   274.5 |       92.53 |            85.43 |        1 |      62.6 |                             |
| fg-catalogue | `finishedGoods/catalogue:summary`                      |            272 |   136.9 |          51 |            43.26 |        2 |       1.6 |                             |
| hr-admin     | `hr/review:queuePage`                                  |            251 |   139.4 |       71.63 |            76.96 |        2 |       9.9 |                             |
| job-scan     | `finishedGoods/jobScanLocations:options`               |            218 |   134.8 |       28.83 |            27.27 |        1 |      13.2 |                             |
| hr-admin     | `hr/periods:preview`                                   |            164 |   114.0 |       18.95 |             19.3 |        1 |       0.8 |                             |
| hr-admin     | `hr/roster:roster`                                     |            162 |   112.8 |       17.63 |            18.69 |        1 |       0.1 | LIMIT_EXCEEDED              |
| hr-admin     | `hr/setup:employeesPage`                               |            141 |    83.6 |       19.76 |            20.09 |        1 |      15.0 |                             |
| hr-admin     | `hr/search:adminEmployees`                             |            111 |    75.2 |       16.99 |            16.11 |        1 |       1.5 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab)          |            110 |    55.1 |       25.24 |            22.94 |        1 |      74.0 |                             |
| storage      | `storageLayouts/locationCatalogue:options`             |            109 |    69.1 |       14.14 |            13.41 |        1 |      14.5 |                             |
| storage      | `storageLayouts/locationCatalogue:page`                |             83 |    52.8 |       21.34 |            20.32 |        1 |      25.8 |                             |
| fg-pallet    | `finishedGoods/workflow:getPallet`                     |             75 |    50.9 |       18.56 |            17.77 |        1 |       2.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab)           |             65 |    39.2 |       37.66 |            34.04 |        1 |      75.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search)        |             65 |    39.2 |       37.59 |            33.66 |        1 |      75.3 |                             |
| job-scan     | `finishedGoods/jobScanLocations:buildingOptions`       |             61 |    37.8 |       15.23 |            13.85 |        1 |       7.7 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans`                  |             60 |    36.9 |       33.81 |            31.12 |        1 |      21.3 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (unmapped)       |             60 |    37.0 |       36.75 |            30.83 |        1 |      21.3 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingInventory` |  35 (was 1829) |   964.0 |       68.25 |           249.25 |        1 |     447.8 |                             |
| fg-product   | `finishedGoods/batches:pageLegacyUnits`                |             31 |    17.7 |       19.92 |             17.6 |        1 |      15.8 |                             |
| storage      | `storageLayouts/catalogue:listStorageBuildingsPage`    |             29 |    16.2 |       13.36 |            13.56 |        1 |      13.7 |                             |
| hr-admin     | `hr/periods:versionRowsPage`                           |             29 |    16.3 |       11.86 |             12.8 |        1 |       9.4 |                             |
| hr-admin     | `hr/setup:accessMembersPage`                           |             26 |     8.4 |       14.82 |            14.75 |        1 |       0.6 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingLayout`    |             25 |    14.3 |       16.26 |             17.4 |        1 |       7.4 |                             |
| storage      | `storageLayouts/writes:layoutReadiness`                |             25 |    14.3 |       14.84 |             14.5 |        1 |       1.9 |                             |
| storage      | `storageLayouts/catalogue:buildingOccupancy`           |   21 (was 917) |     8.5 |       11.48 |            99.51 |        1 |       1.0 |                             |
| hr-admin     | `hr/setup:employee`                                    |             19 |     6.2 |       12.86 |            12.48 |        1 |       0.6 |                             |
| ai-usage     | `aiUsage/dimensions:actorOptions`                      |             17 |     5.3 |       11.17 |            10.55 |        1 |       0.4 |                             |
| shell        | `workspace/current:readCurrent`                        |             16 |     5.0 |       11.63 |             9.89 |        1 |       0.5 |                             |
| shell        | `hr/access:display`                                    |             16 |     5.3 |       13.42 |            10.88 |        1 |       0.7 |                             |
| job-scan     | `finishedGoods/jobScanLocations:resolve`               |             15 |     6.2 |       13.94 |            14.66 |        1 |       0.6 |                             |
| hr-self      | `hr/self:today`                                        |             14 |     6.3 |          12 |            12.27 |        1 |       0.8 |                             |
| job-scan     | `finishedGoods/scanning:resolveLocationCode`           |             13 |     5.0 |       11.77 |            12.53 |        1 |       0.5 |                             |
| fg-product   | `finishedGoods/catalogue:productSummary`               |             12 |     4.3 |       10.77 |            10.11 |        1 |       0.3 |                             |
| hr-self      | `hr/self:profile`                                      |             12 |     4.1 |       11.06 |            11.54 |        1 |       0.6 |                             |
| hr-self      | `hr/self:history`                                      |             12 |     5.6 |       12.36 |            12.41 |        1 |       1.6 |                             |
| shell        | `aiUsage/reports:access`                               |             11 |     3.4 |       12.39 |             8.79 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/batches:getBatch`                       |             11 |     3.7 |       11.41 |            10.78 |        1 |       1.0 |                             |
| storage      | `storageLayouts/catalogue:buildingStatusControl`       |             11 |     4.4 |       11.29 |            10.73 |        1 |       0.1 |                             |
| hr-admin     | `hr/leave:queuePage`                                   |             11 |     3.4 |       12.46 |             12.4 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/workflow:getProduct`                    |             10 |     3.4 |       10.84 |             9.23 |        1 |       0.7 |                             |
| fg-product   | `finishedGoods/batches:pageProductBatches`             |             10 |     3.2 |       10.98 |            10.34 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/history:palletMoveHistory`              |             10 |     3.4 |       10.97 |             9.51 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/workflow:stackChoices`                  |             10 |     3.4 |       10.15 |             8.73 |        1 |       0.1 |                             |
| job-scan     | `finishedGoods/scanning:resolvePackageCode`            |             10 |     3.5 |       11.35 |            12.33 |        1 |       0.1 | NOT_OK                      |
| hr-self      | `hr/self:requests`                                     |             10 |     4.3 |        11.6 |            11.09 |        1 |       0.6 |                             |
| hr-admin     | `hr/periods:listPage`                                  |             10 |     3.4 |       10.81 |             10.8 |        1 |       0.5 |                             |
| job-scan     | `finishedGoods/jobScanLocations:page`                  |              9 |     2.9 |       11.64 |            11.03 |        1 |       0.2 |                             |
| hr-self      | `hr/announcements:self`                                |              9 |     3.4 |       10.31 |            10.73 |        1 |       0.1 |                             |
| hr-self      | `hr/notifications:list`                                |              9 |     3.4 |        10.7 |             10.8 |        1 |       0.2 |                             |
| hr-self      | `hr/leave:self`                                        |              9 |     3.4 |       10.29 |            10.61 |        1 |       0.3 |                             |
| hr-admin     | `hr/roster:shifts`                                     |              9 |     2.8 |       10.12 |              9.5 |        1 |       0.2 |                             |
| hr-admin     | `hr/payslips:list`                                     |              9 |     3.4 |       10.72 |            10.97 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/payslips:imports`                                  |              8 |     2.7 |        11.4 |            10.98 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/org:listDepartments`                               |              8 |     2.7 |       10.93 |            10.36 |        1 |       0.1 |                             |
| ai-usage     | `aiUsage/reports:summary`                              |              8 |     2.7 |       10.11 |            10.16 |        1 |       1.2 |                             |
| ai-usage     | `aiUsage/reports:recent`                               |              8 |     2.7 |       10.38 |             9.55 |        1 |       0.1 |                             |

**candidate: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |       12.24 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       12.06 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       11.56 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |        18.3 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        37 |            9 |         56 |       19.77 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        35 |            8 |         57 |       15.12 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        23 |            5 |         33 |       12.91 |

**candidate: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           33.9 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                       |
| reserve (awaiting pallet)       | 40 / 9 / 9.4                                       |             10 |         1735 |     2751.0 |          873.6 |                          2 (282) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:productSummary×1 (17 docs); finishedGoods/batches:pageProductBatches×1 (15 docs); finishedGoods/catalogue:summary×1 (15 docs); finishedGoods/batches:pageLegacyUnits×1 (36 docs); finishedGoods/catalogue:page×3 (265 docs); finishedGoods/workflow:recommendMove×1 (689 docs); finishedGoods/workflow:recommend×1 (688 docs) |
| cancelReservation (same pallet) | 35 / 8 / 8.1                                       |             10 |         1735 |     2748.9 |         1185.7 |                          2 (282) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:productSummary×1 (17 docs); finishedGoods/catalogue:summary×1 (15 docs); finishedGoods/batches:pageProductBatches×1 (15 docs); finishedGoods/catalogue:page×3 (265 docs); finishedGoods/batches:pageLegacyUnits×1 (36 docs); finishedGoods/workflow:recommendMove×1 (689 docs); finishedGoods/workflow:recommend×1 (688 docs) |
| createPallet (busiest product)  | 21 / 8 / 6.4                                       |              7 |          358 |      180.3 |          261.8 |                          2 (284) | finishedGoods/catalogue:summary×1 (16 docs); finishedGoods/catalogue:productSummary×1 (18 docs); finishedGoods/batches:pageProductBatches×1 (16 docs); finishedGoods/batches:pageLegacyUnits×1 (38 docs); finishedGoods/catalogue:page×3 (270 docs)                                                                                                                                                    |

**candidate: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 45.4 ms / max 58.1 ms

**candidate: contention** 8 concurrent createPallet (same product) → executions 22, OCC retries 14, failures 0, RTT p50 206.2 ms / max 696.9 ms

**candidate: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 11, OCC retries 3, failures 0, RTT p50 62.9 ms / max 185.8 ms

**base: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |       16.38 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       14.02 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       13.57 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       20.66 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        28 |            7 |         47 |       16.37 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        23 |            6 |         48 |       20.55 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        21 |            5 |         33 |       16.89 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           28.7 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                         |
| reserve (awaiting pallet)       | 28 / 7 / 7.2                                       |             10 |         6098 |     3808.1 |         1202.1 |                          2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommendMove×1 (2888 docs); finishedGoods/workflow:recommend×1 (2887 docs) |
| cancelReservation (same pallet) | 23 / 6 / 6.8                                       |             10 |         6096 |     3806.3 |         1192.7 |                          2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommendMove×1 (2887 docs); finishedGoods/workflow:recommend×1 (2886 docs) |
| createPallet (busiest product)  | 22 / 8 / 6.4                                       |              7 |          316 |      168.1 |          202.1 |                          2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (252 docs)                                                                                                                                                      |

**base: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 64.5 ms / max 70.4 ms

**base: contention** 8 concurrent createPallet (same product) → executions 20, OCC retries 12, failures 0, RTT p50 185 ms / max 502 ms

**base: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 21, OCC retries 13, failures 0, RTT p50 216.3 ms / max 660.8 ms
