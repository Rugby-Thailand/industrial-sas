Profile `iter6` · 2026-11-04T17:02:47.652Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@c26e832f (convex sha256:98e0162d6eb51ecb), base@80dc0a93 (convex sha256:a486b726209f5b84) · load avg before/after 31.0/13.6

| Screen       | Function                                               |      Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note                        |
| ------------ | ------------------------------------------------------ | -------------: | ------: | ----------: | ---------------: | -------: | --------: | --------------------------- |
| job-scan     | `finishedGoods/jobScans:listJobScans` (search)         |           2389 |  1541.1 |      573.41 |           536.15 |       22 |      21.5 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuilding`          |           1844 |  1328.2 |      197.75 |           205.49 |        1 |     453.4 | legacy (no live subscriber) |
| fg-pallet    | `finishedGoods/workflow:list`                          |           1440 |   914.8 |      180.24 |           172.44 |        1 |     925.4 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:getStorageLocationMap`       |            936 |   671.6 |      115.98 |           112.36 |        1 |     376.2 | legacy (no live subscriber) |
| job-scan     | `finishedGoods/jobScanLocations:searchPage`            |            896 |   474.3 |      152.04 |           150.76 |        2 |       0.8 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendMove`                 | 688 (was 2887) |  1284.5 |      180.96 |           408.02 |        1 |     238.5 |                             |
| fg-pallet    | `finishedGoods/workflow:recommend`                     | 687 (was 2886) |  1283.7 |      169.84 |           390.61 |        1 |     238.3 |                             |
| storage      | `storageLayouts/locationCatalogue:detail`              |            312 |   274.5 |      108.52 |           106.74 |        1 |      62.6 |                             |
| hr-admin     | `hr/roster:roster` (no page size)                      |            254 |   154.8 |      253.79 |            18.37 |        1 |     647.1 |                             |
| hr-admin     | `hr/review:queuePage`                                  |            251 |   139.4 |       80.92 |            84.99 |        2 |       9.9 |                             |
| job-scan     | `finishedGoods/jobScanLocations:options`               |            218 |   134.8 |       30.47 |            31.51 |        1 |      13.2 |                             |
| hr-admin     | `hr/periods:preview`                                   |            164 |   114.0 |       22.65 |            19.23 |        1 |       0.8 |                             |
| hr-admin     | `hr/setup:employeesPage`                               |            141 |    83.6 |       23.79 |            24.62 |        1 |      15.0 |                             |
| hr-admin     | `hr/search:adminEmployees`                             |            111 |    75.2 |       17.19 |            16.18 |        1 |       1.5 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab)          |            110 |    55.2 |       26.17 |            25.08 |        1 |      74.0 |                             |
| storage      | `storageLayouts/locationCatalogue:options`             |            109 |    69.1 |       16.08 |            16.74 |        1 |      14.5 |                             |
| hr-admin     | `hr/roster:roster`                                     |   85 (was 162) |    48.5 |      112.17 |             0.15 |        1 |     131.1 |                             |
| storage      | `storageLayouts/locationCatalogue:page`                |             83 |    52.8 |       28.08 |            25.15 |        1 |      25.8 |                             |
| fg-pallet    | `finishedGoods/workflow:getPallet`                     |             75 |    50.9 |       22.56 |            19.74 |        1 |       2.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab)           |             65 |    39.2 |       41.11 |            37.66 |        1 |      75.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search)        |             65 |    39.2 |       39.58 |            37.32 |        1 |      75.3 |                             |
| job-scan     | `finishedGoods/jobScanLocations:buildingOptions`       |             61 |    37.8 |       15.49 |            14.88 |        1 |       7.7 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans`                  |             60 |    36.9 |       32.71 |            31.36 |        1 |      21.3 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (unmapped)       |             60 |    37.0 |       33.43 |            31.33 |        1 |      21.3 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingInventory` |  35 (was 1829) |   964.1 |       68.46 |           237.64 |        1 |     447.8 |                             |
| fg-product   | `finishedGoods/batches:pageLegacyUnits`                |             31 |    17.8 |       21.95 |            28.77 |        1 |      15.8 |                             |
| storage      | `storageLayouts/catalogue:listStorageBuildingsPage`    |             29 |    16.2 |       14.14 |            14.74 |        1 |      13.7 |                             |
| hr-admin     | `hr/periods:versionRowsPage`                           |             29 |    16.3 |       13.32 |            14.28 |        1 |       9.4 |                             |
| hr-admin     | `hr/setup:accessMembersPage`                           |             26 |     8.4 |       14.53 |             14.2 |        1 |       0.6 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingLayout`    |             25 |    14.3 |       16.81 |            16.09 |        1 |       7.4 |                             |
| storage      | `storageLayouts/writes:layoutReadiness`                |             25 |    14.3 |       15.55 |            16.07 |        1 |       1.9 |                             |
| storage      | `storageLayouts/catalogue:buildingOccupancy`           |   21 (was 917) |     8.5 |       11.63 |            97.66 |        1 |       1.0 |                             |
| hr-admin     | `hr/setup:employee`                                    |             19 |     6.2 |       12.93 |            11.64 |        1 |       0.6 |                             |
| fg-catalogue | `finishedGoods/catalogue:summary`                      |   18 (was 272) |     6.9 |       11.44 |            49.87 |        1 |       0.3 |                             |
| ai-usage     | `aiUsage/dimensions:actorOptions`                      |             17 |     5.3 |       11.08 |            10.67 |        1 |       0.4 |                             |
| shell        | `workspace/current:readCurrent`                        |             16 |     5.0 |       11.79 |            10.51 |        1 |       0.5 |                             |
| shell        | `hr/access:display`                                    |             16 |     5.3 |       12.22 |            11.28 |        1 |       0.7 |                             |
| job-scan     | `finishedGoods/jobScanLocations:resolve`               |             15 |     6.2 |       13.86 |            13.59 |        1 |       0.6 |                             |
| job-scan     | `finishedGoods/scanning:resolveLocationCode`           |             13 |     5.0 |        12.2 |            13.89 |        1 |       0.5 |                             |
| hr-self      | `hr/self:today`                                        |    13 (was 14) |     5.8 |       13.87 |            14.61 |        1 |       0.8 |                             |
| fg-product   | `finishedGoods/catalogue:productSummary`               |             12 |     4.3 |       11.44 |             9.99 |        1 |       0.3 |                             |
| hr-self      | `hr/self:profile`                                      |             12 |     4.1 |       12.16 |            12.15 |        1 |       0.6 |                             |
| hr-self      | `hr/self:history`                                      |             12 |     5.6 |       12.64 |            11.93 |        1 |       1.6 |                             |
| shell        | `aiUsage/reports:access`                               |             11 |     3.4 |       10.98 |             9.72 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/batches:getBatch`                       |             11 |     3.7 |       12.29 |            10.67 |        1 |       1.0 |                             |
| storage      | `storageLayouts/catalogue:buildingStatusControl`       |             11 |     4.4 |       11.78 |             11.4 |        1 |       0.1 |                             |
| hr-admin     | `hr/leave:queuePage`                                   |             11 |     3.4 |       12.29 |            11.82 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/workflow:getProduct`                    |             10 |     3.4 |       11.15 |            10.01 |        1 |       0.7 |                             |
| fg-product   | `finishedGoods/batches:pageProductBatches`             |             10 |     3.3 |       12.35 |            11.05 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/history:palletMoveHistory`              |             10 |     3.4 |       11.35 |            10.74 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/workflow:stackChoices`                  |             10 |     3.4 |       11.23 |            10.06 |        1 |       0.1 |                             |
| job-scan     | `finishedGoods/scanning:resolvePackageCode`            |             10 |     3.5 |        11.7 |            12.33 |        1 |       0.1 | NOT_OK                      |
| hr-self      | `hr/self:requests`                                     |             10 |     4.3 |       10.71 |            11.31 |        1 |       0.6 |                             |
| hr-admin     | `hr/periods:listPage`                                  |             10 |     3.4 |       11.45 |            11.26 |        1 |       0.5 |                             |
| job-scan     | `finishedGoods/jobScanLocations:page`                  |              9 |     2.9 |       11.96 |            12.17 |        1 |       0.2 |                             |
| hr-self      | `hr/announcements:self`                                |              9 |     3.4 |       11.23 |            11.46 |        1 |       0.1 |                             |
| hr-self      | `hr/notifications:list`                                |              9 |     3.4 |       10.89 |            11.69 |        1 |       0.2 |                             |
| hr-self      | `hr/leave:self`                                        |              9 |     3.4 |       12.32 |            12.78 |        1 |       0.3 |                             |
| hr-admin     | `hr/roster:shifts`                                     |              9 |     2.8 |       11.75 |            11.41 |        1 |       0.2 |                             |
| hr-admin     | `hr/payslips:list`                                     |              9 |     3.4 |       11.49 |            11.15 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/payslips:imports`                                  |              8 |     2.7 |       11.65 |            10.81 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/org:listDepartments`                               |              8 |     2.7 |       10.69 |             9.82 |        1 |       0.1 |                             |
| ai-usage     | `aiUsage/reports:summary`                              |              8 |     2.7 |       11.21 |            10.67 |        1 |       1.2 |                             |
| ai-usage     | `aiUsage/reports:recent`                               |              8 |     2.7 |        11.3 |            10.82 |        1 |       0.1 |                             |

**candidate: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |       12.74 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |       13.73 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       13.04 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       18.54 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        37 |            9 |         56 |       18.34 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        32 |            8 |         57 |       16.22 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        23 |            5 |         33 |       13.93 |

**candidate: reactive fan-out** (61 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           29.3 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                      |
| reserve (awaiting pallet)       | 40 / 9 / 9.4                                       |              8 |         1708 |     2742.4 |          678.8 |                            0 (0) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (16 docs); finishedGoods/batches:pageLegacyUnits×1 (37 docs); finishedGoods/catalogue:page×3 (268 docs); finishedGoods/workflow:recommend×1 (688 docs); finishedGoods/workflow:recommendMove×1 (689 docs) |
| cancelReservation (same pallet) | 35 / 8 / 8.1                                       |              8 |         1708 |     2740.3 |            755 |                            0 (0) | finishedGoods/batches:pageProductBatches×1 (16 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (37 docs); finishedGoods/catalogue:page×3 (268 docs); finishedGoods/workflow:recommend×1 (688 docs); finishedGoods/workflow:recommendMove×1 (689 docs) |
| createPallet (busiest product)  | 27 / 9 / 6.9                                       |              7 |          354 |      180.8 |          310.3 |                            0 (0) | finishedGoods/catalogue:summary×1 (18 docs); finishedGoods/batches:pageProductBatches×1 (16 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (38 docs); finishedGoods/catalogue:page×3 (270 docs)                                                   |

**candidate: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 35.1 ms / max 44.2 ms

**candidate: contention** 8 concurrent createPallet (same product) → executions 20, OCC retries 12, failures 0, RTT p50 150.4 ms / max 446.1 ms

**candidate: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 11, OCC retries 3, failures 0, RTT p50 67.6 ms / max 165.7 ms

**base: write flows**

| Flow                                      | Function                                   | Docs read | Docs written | Index rows | Exec p50 ms |
| ----------------------------------------- | ------------------------------------------ | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:saveJobScans`      |        10 |            4 |         22 |       11.64 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:updateJobScan`     |        13 |            4 |         22 |          11 |
| job-scan save 1 → correct → delete        | `finishedGoods/jobScans:deleteJobScans`    |        13 |            4 |         22 |       11.21 |
| job-scan save batch of 50 (max)           | `finishedGoods/jobScans:saveJobScans`      |        10 |           53 |        218 |       17.51 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:reserve`           |        28 |            7 |         47 |       14.01 |
| reserve → cancel in the fullest open zone | `finishedGoods/workflow:cancelReservation` |        23 |            6 |         48 |       13.72 |
| pallet measurement save                   | `finishedGoods/workflow:saveMeasurement`   |        21 |            5 |         33 |       13.44 |

**base: reactive fan-out** (61 subscriptions open on one session)

| Write                           | Write cost (docs read / docs written / KB written) | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------------------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           | 10 / 4 / 3.7                                       |              2 |          122 |       64.1 |           29.2 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                         |
| reserve (awaiting pallet)       | 28 / 7 / 7.2                                       |             10 |         6098 |     3808.1 |         1166.7 |                          2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommend×1 (2887 docs); finishedGoods/workflow:recommendMove×1 (2888 docs) |
| cancelReservation (same pallet) | 23 / 6 / 6.8                                       |             10 |         6096 |     3806.3 |         1201.5 |                          2 (272) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (250 docs); finishedGoods/workflow:recommend×1 (2886 docs); finishedGoods/workflow:recommendMove×1 (2887 docs) |
| createPallet (busiest product)  | 22 / 8 / 6.4                                       |              7 |          316 |      168.1 |          202.3 |                          2 (272) | finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (252 docs)                                                                                                                                                      |

**base: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 59.3 ms / max 72.4 ms

**base: contention** 8 concurrent createPallet (same product) → executions 18, OCC retries 10, failures 0, RTT p50 154.8 ms / max 376.6 ms

**base: contention** 8 concurrent saveMeasurement (distinct pallets) → executions 19, OCC retries 11, failures 0, RTT p50 153.6 ms / max 280.6 ms
