Profile `iter3` · 2026-11-04T15:52:43.081Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@011ccd35+dirty (convex sha256:809dc07ac3a5d1c0), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 11.9/18.2

| Screen       | Function                                               |      Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note                        |
| ------------ | ------------------------------------------------------ | -------------: | ------: | ----------: | ---------------: | -------: | --------: | --------------------------- |
| job-scan     | `finishedGoods/jobScans:listJobScans` (search)         |           2389 |  1541.1 |     1037.94 |           627.73 |       22 |      21.5 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuilding`          |           1844 |  1328.2 |      178.64 |           175.76 |        1 |     453.4 | legacy (no live subscriber) |
| fg-pallet    | `finishedGoods/workflow:list`                          |           1440 |   914.8 |      172.97 |           170.59 |        1 |     925.4 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:getStorageLocationMap`       |            936 |   671.6 |      101.71 |           109.32 |        1 |     376.2 | legacy (no live subscriber) |
| job-scan     | `finishedGoods/jobScanLocations:searchPage`            |            896 |   474.3 |      149.14 |           159.96 |        2 |       0.8 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendMove`                 | 687 (was 2887) |  1284.0 |      162.85 |           408.24 |        1 |     238.5 |                             |
| fg-pallet    | `finishedGoods/workflow:recommend`                     | 686 (was 2886) |  1283.3 |      166.42 |           446.58 |        1 |     238.3 |                             |
| storage      | `storageLayouts/locationCatalogue:detail`              |            312 |   274.5 |       87.13 |            89.09 |        1 |      62.6 |                             |
| fg-catalogue | `finishedGoods/catalogue:summary`                      |            272 |   136.9 |       44.66 |            46.68 |        2 |       1.6 |                             |
| hr-admin     | `hr/review:queuePage`                                  |            251 |   139.4 |       60.39 |            64.19 |        2 |       9.9 |                             |
| job-scan     | `finishedGoods/jobScanLocations:options`               |            218 |   134.8 |       26.46 |            28.24 |        1 |      13.2 |                             |
| hr-admin     | `hr/periods:preview`                                   |            164 |   114.0 |       18.51 |            19.92 |        1 |       0.8 |                             |
| hr-admin     | `hr/roster:roster`                                     |            162 |   112.8 |       24.59 |            31.81 |        1 |       0.1 | LIMIT_EXCEEDED              |
| hr-admin     | `hr/setup:employeesPage`                               |            141 |    83.6 |       17.82 |            19.87 |        1 |      15.0 |                             |
| hr-admin     | `hr/search:adminEmployees`                             |            111 |    75.2 |       14.13 |            15.32 |        1 |       1.5 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab)          |            110 |    55.1 |       20.37 |            24.03 |        1 |      74.0 |                             |
| storage      | `storageLayouts/locationCatalogue:options`             |            109 |    69.1 |       12.36 |            13.37 |        1 |      14.5 |                             |
| storage      | `storageLayouts/locationCatalogue:page`                |             83 |    52.8 |       19.38 |            20.11 |        1 |      25.8 |                             |
| fg-pallet    | `finishedGoods/workflow:getPallet`                     |             75 |    50.9 |       17.58 |            17.27 |        1 |       2.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab)           |             65 |    39.2 |       36.77 |             38.7 |        1 |      75.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search)        |             65 |    39.2 |        36.9 |            38.72 |        1 |      75.3 |                             |
| job-scan     | `finishedGoods/jobScanLocations:buildingOptions`       |             61 |    37.8 |       11.78 |            13.26 |        1 |       7.7 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans`                  |             60 |    36.9 |       32.92 |            33.72 |        1 |      21.3 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (unmapped)       |             60 |    37.0 |       31.98 |            32.65 |        1 |      21.3 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingInventory` |  34 (was 1829) |   963.6 |       71.32 |           235.89 |        1 |     447.8 |                             |
| fg-product   | `finishedGoods/batches:pageLegacyUnits`                |             31 |    17.7 |        16.4 |            18.33 |        1 |      15.8 |                             |
| storage      | `storageLayouts/catalogue:listStorageBuildingsPage`    |             29 |    16.2 |        11.5 |             12.6 |        1 |      13.7 |                             |
| hr-admin     | `hr/periods:versionRowsPage`                           |             29 |    16.3 |       17.02 |            16.37 |        1 |       9.4 |                             |
| hr-admin     | `hr/setup:accessMembersPage`                           |             26 |     8.4 |       12.14 |            12.33 |        1 |       0.6 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingLayout`    |             25 |    14.3 |       19.29 |            25.35 |        1 |       7.4 |                             |
| storage      | `storageLayouts/writes:layoutReadiness`                |             25 |    14.3 |       13.37 |            15.22 |        1 |       1.9 |                             |
| storage      | `storageLayouts/catalogue:buildingOccupancy`           |   20 (was 917) |     8.1 |       10.47 |           110.75 |        1 |       1.0 |                             |
| hr-admin     | `hr/setup:employee`                                    |             19 |     6.2 |        10.7 |            11.72 |        1 |       0.6 |                             |
| ai-usage     | `aiUsage/dimensions:actorOptions`                      |             17 |     5.3 |        9.17 |            10.61 |        1 |       0.4 |                             |
| shell        | `workspace/current:readCurrent`                        |             16 |     5.0 |       10.25 |            11.52 |        1 |       0.5 |                             |
| shell        | `hr/access:display`                                    |             16 |     5.3 |       11.12 |             12.6 |        1 |       0.7 |                             |
| job-scan     | `finishedGoods/jobScanLocations:resolve`               |             15 |     6.2 |       25.95 |            31.78 |        1 |       0.6 |                             |
| hr-self      | `hr/self:today`                                        |             14 |     6.3 |       11.93 |            13.18 |        1 |       0.8 |                             |
| job-scan     | `finishedGoods/scanning:resolveLocationCode`           |             13 |     5.0 |       27.56 |            31.23 |        1 |       0.5 |                             |
| fg-product   | `finishedGoods/catalogue:productSummary`               |             12 |     4.3 |        9.92 |            10.04 |        1 |       0.3 |                             |
| hr-self      | `hr/self:profile`                                      |             12 |     4.1 |       10.84 |            11.85 |        1 |       0.6 |                             |
| hr-self      | `hr/self:history`                                      |             12 |     5.6 |          11 |            14.97 |        1 |       1.6 |                             |
| shell        | `aiUsage/reports:access`                               |             11 |     3.4 |        9.39 |             9.68 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/batches:getBatch`                       |             11 |     3.7 |        9.81 |            11.34 |        1 |       1.0 |                             |
| storage      | `storageLayouts/catalogue:buildingStatusControl`       |             11 |     4.4 |       11.05 |            11.17 |        1 |       0.1 |                             |
| hr-admin     | `hr/leave:queuePage`                                   |             11 |     3.4 |         9.7 |             9.99 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/workflow:getProduct`                    |             10 |     3.4 |        8.97 |              9.7 |        1 |       0.7 |                             |
| fg-product   | `finishedGoods/batches:pageProductBatches`             |             10 |     3.2 |          10 |            10.56 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/history:palletMoveHistory`              |             10 |     3.4 |       10.36 |            10.26 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/workflow:stackChoices`                  |             10 |     3.4 |        9.14 |            10.34 |        1 |       0.1 |                             |
| job-scan     | `finishedGoods/scanning:resolvePackageCode`            |             10 |     3.5 |       10.51 |            10.57 |        1 |       0.1 | NOT_OK                      |
| hr-self      | `hr/self:requests`                                     |             10 |     4.3 |        9.49 |            10.22 |        1 |       0.6 |                             |
| hr-admin     | `hr/periods:listPage`                                  |             10 |     3.4 |        9.99 |            10.89 |        1 |       0.5 |                             |
| job-scan     | `finishedGoods/jobScanLocations:page`                  |              9 |     2.9 |        9.66 |            10.28 |        1 |       0.2 |                             |
| hr-self      | `hr/announcements:self`                                |              9 |     3.4 |        9.43 |            10.45 |        1 |       0.1 |                             |
| hr-self      | `hr/notifications:list`                                |              9 |     3.4 |        9.18 |            10.28 |        1 |       0.2 |                             |
| hr-self      | `hr/leave:self`                                        |              9 |     3.4 |       10.79 |            11.97 |        1 |       0.3 |                             |
| hr-admin     | `hr/roster:shifts`                                     |              9 |     2.8 |       15.66 |            14.28 |        1 |       0.2 |                             |
| hr-admin     | `hr/payslips:list`                                     |              9 |     3.4 |       11.35 |            11.56 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/payslips:imports`                                  |              8 |     2.7 |        9.25 |             9.56 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/org:listDepartments`                               |              8 |     2.7 |        8.34 |             9.11 |        1 |       0.1 |                             |
| ai-usage     | `aiUsage/reports:summary`                              |              8 |     2.7 |        9.16 |             9.89 |        1 |       1.2 |                             |
| ai-usage     | `aiUsage/reports:recent`                               |              8 |     2.7 |        8.53 |             9.53 |        1 |       0.1 |                             |

**candidate: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |       10.21 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       10.68 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       10.24 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       14.91 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        37 |            9 |         56 |       15.03 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        32 |            8 |         57 |       13.66 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        20 |            5 |         33 |       11.83 |

**candidate: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           52.7 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                       |
| reserve (awaiting pallet)       | 37 / 9 / 9.4                                       |             10 |         1705 |     2741.7 |          931.2 |                          2 (274) | finishedGoods/catalogue:productSummary×1 (13 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:summary×1 (11 docs); finishedGoods/batches:pageProductBatches×1 (11 docs); finishedGoods/catalogue:page×3 (253 docs); finishedGoods/workflow:recommendMove×1 (688 docs); finishedGoods/workflow:recommend×1 (687 docs) |
| cancelReservation (same pallet) | 32 / 8 / 8.0                                       |             10 |         1705 |     2739.7 |          785.5 |                          2 (274) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (11 docs); finishedGoods/catalogue:productSummary×1 (13 docs); finishedGoods/catalogue:summary×1 (11 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (253 docs); finishedGoods/workflow:recommendMove×1 (688 docs); finishedGoods/workflow:recommend×1 (687 docs) |
| createPallet (busiest product)  | 21 / 8 / 6.3                                       |              7 |          323 |      169.8 |          272.7 |                          2 (274) | finishedGoods/batches:pageProductBatches×1 (11 docs); finishedGoods/catalogue:summary×1 (11 docs); finishedGoods/catalogue:productSummary×1 (13 docs); finishedGoods/batches:pageLegacyUnits×1 (33 docs); finishedGoods/catalogue:page×3 (255 docs)                                                                                                                                                    |

**candidate: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 73.4 ms / max 77.5 ms

**candidate: contention** 8 concurrent createPallet (same product) → executions 21, OCC retries 13, failures 0, RTT p50 296.7 ms / max 422.5 ms

**candidate: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 8, OCC retries 0, failures 0, RTT p50 71.3 ms / max 96.4 ms

**base: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |       12.03 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       12.24 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       11.68 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       16.86 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        28 |            7 |         47 |       17.42 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        23 |            6 |         48 |       12.68 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        21 |            5 |         33 |       11.93 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.0 |           34.7 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                         |
| reserve (awaiting pallet)       | 28 / 7 / 7.2                                       |             10 |         6098 |     3808.1 |         1288.9 |                          2 (272) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommend×1 (2887 docs); finishedGoods/workflow:recommendMove×1 (2888 docs) |
| cancelReservation (same pallet) | 23 / 6 / 6.8                                       |             10 |         6096 |     3806.3 |         1438.8 |                          2 (272) | finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/workflow:recommendMove×1 (2887 docs); finishedGoods/workflow:recommend×1 (2886 docs) |
| createPallet (busiest product)  | 22 / 8 / 6.4                                       |              7 |          316 |      168.1 |          948.7 |                          2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (252 docs)                                                                                                                                                      |

**base: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 48.3 ms / max 48.9 ms

**base: contention** 8 concurrent createPallet (same product) → executions 19, OCC retries 11, failures 0, RTT p50 143.6 ms / max 445.7 ms

**base: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 21, OCC retries 13, failures 0, RTT p50 202.1 ms / max 1002.8 ms
