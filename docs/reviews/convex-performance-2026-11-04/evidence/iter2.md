Profile `iter2` · 2026-11-04T15:17:39.383Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@a3fa1e28+dirty, base@80dc0a93 · load avg before/after 2.9/4.0

| Screen       | Function                                               |      Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note                        |
| ------------ | ------------------------------------------------------ | -------------: | ------: | ----------: | ---------------: | -------: | --------: | --------------------------- |
| job-scan     | `finishedGoods/jobScans:listJobScans` (search)         |           2389 |  1541.1 |       518.9 |           516.88 |       22 |      21.5 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuilding`          |           1844 |  1328.2 |      177.15 |           187.31 |        1 |     453.4 | legacy (no live subscriber) |
| fg-pallet    | `finishedGoods/workflow:list`                          |           1440 |   914.8 |      166.67 |           163.83 |        1 |     925.4 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:getStorageLocationMap`       |            936 |   671.6 |       97.03 |            98.62 |        1 |     376.2 | legacy (no live subscriber) |
| job-scan     | `finishedGoods/jobScanLocations:searchPage`            |            896 |   474.3 |      127.21 |           130.21 |        2 |       0.8 |                             |
| fg-pallet    | `finishedGoods/workflow:recommendMove`                 | 687 (was 2887) |  1284.0 |      150.47 |            316.2 |        1 |     238.5 |                             |
| fg-pallet    | `finishedGoods/workflow:recommend`                     | 686 (was 2886) |  1283.3 |       145.4 |           311.28 |        1 |     238.3 |                             |
| storage      | `storageLayouts/locationCatalogue:detail`              |            312 |   274.5 |       89.48 |            86.09 |        1 |      62.6 |                             |
| fg-catalogue | `finishedGoods/catalogue:summary`                      |            272 |   136.9 |       44.57 |            41.81 |        2 |       1.6 |                             |
| hr-admin     | `hr/review:queuePage`                                  |            251 |   139.4 |       67.26 |            70.51 |        2 |       9.9 |                             |
| job-scan     | `finishedGoods/jobScanLocations:options`               |            218 |   134.8 |       26.39 |             26.1 |        1 |      13.2 |                             |
| hr-admin     | `hr/periods:preview`                                   |            164 |   114.0 |       18.13 |            19.28 |        1 |       0.8 |                             |
| hr-admin     | `hr/roster:roster`                                     |            162 |   112.8 |       17.52 |            18.69 |        1 |       0.1 | LIMIT_EXCEEDED              |
| hr-admin     | `hr/setup:employeesPage`                               |            141 |    83.6 |       19.95 |            22.86 |        1 |      15.0 |                             |
| hr-admin     | `hr/search:adminEmployees`                             |            111 |    75.2 |       17.22 |            16.22 |        1 |       1.5 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab)          |            110 |    55.1 |       22.88 |            22.98 |        1 |      74.0 |                             |
| storage      | `storageLayouts/locationCatalogue:options`             |            109 |    69.1 |       13.38 |            13.47 |        1 |      14.5 |                             |
| storage      | `storageLayouts/locationCatalogue:page`                |             83 |    52.8 |       19.48 |            19.84 |        1 |      25.8 |                             |
| fg-pallet    | `finishedGoods/workflow:getPallet`                     |             75 |    50.9 |       16.73 |            16.33 |        1 |       2.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab)           |             65 |    39.2 |       36.06 |            36.17 |        1 |      75.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search)        |             65 |    39.2 |       35.88 |            35.91 |        1 |      75.3 |                             |
| job-scan     | `finishedGoods/jobScanLocations:buildingOptions`       |             61 |    37.8 |       13.89 |            13.42 |        1 |       7.7 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans`                  |             60 |    36.9 |        31.5 |            31.14 |        1 |      21.3 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (unmapped)       |             60 |    37.0 |       30.48 |            29.93 |        1 |      21.3 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingInventory` |  34 (was 1829) |   963.6 |       59.57 |           200.47 |        1 |     447.8 |                             |
| fg-product   | `finishedGoods/batches:pageLegacyUnits`                |             31 |    17.7 |       17.22 |            17.25 |        1 |      15.8 |                             |
| storage      | `storageLayouts/catalogue:listStorageBuildingsPage`    |             29 |    16.2 |       11.75 |            11.93 |        1 |      13.7 |                             |
| hr-admin     | `hr/periods:versionRowsPage`                           |             29 |    16.3 |       11.94 |            11.84 |        1 |       9.4 |                             |
| hr-admin     | `hr/setup:accessMembersPage`                           |             26 |     8.4 |       13.62 |            12.94 |        1 |       0.6 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingLayout`    |             25 |    14.3 |       16.98 |            15.29 |        1 |       7.4 |                             |
| storage      | `storageLayouts/writes:layoutReadiness`                |             25 |    14.3 |       14.24 |             13.7 |        1 |       1.9 |                             |
| storage      | `storageLayouts/catalogue:buildingOccupancy`           |   20 (was 917) |     8.1 |       10.38 |            90.73 |        1 |       1.0 |                             |
| hr-admin     | `hr/setup:employee`                                    |             19 |     6.2 |       11.71 |            11.59 |        1 |       0.6 |                             |
| ai-usage     | `aiUsage/dimensions:actorOptions`                      |             17 |     5.3 |       12.83 |            11.46 |        1 |       0.4 |                             |
| shell        | `workspace/current:readCurrent`                        |             16 |     5.0 |       11.43 |            11.42 |        1 |       0.5 |                             |
| shell        | `hr/access:display`                                    |             16 |     5.3 |       12.13 |            12.15 |        1 |       0.7 |                             |
| job-scan     | `finishedGoods/jobScanLocations:resolve`               |             15 |     6.2 |       11.99 |             11.1 |        1 |       0.6 |                             |
| hr-self      | `hr/self:today`                                        |             14 |     6.3 |       12.92 |            12.57 |        1 |       0.8 |                             |
| job-scan     | `finishedGoods/scanning:resolveLocationCode`           |             13 |     5.0 |       10.45 |            11.64 |        1 |       0.5 |                             |
| fg-product   | `finishedGoods/catalogue:productSummary`               |             12 |     4.3 |       10.14 |             9.29 |        1 |       0.3 |                             |
| hr-self      | `hr/self:profile`                                      |             12 |     4.1 |       11.42 |            10.85 |        1 |       0.6 |                             |
| hr-self      | `hr/self:history`                                      |             12 |     5.6 |       11.71 |            12.23 |        1 |       1.6 |                             |
| shell        | `aiUsage/reports:access`                               |             11 |     3.4 |        9.46 |             9.12 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/batches:getBatch`                       |             11 |     3.7 |       11.15 |            10.95 |        1 |       1.0 |                             |
| storage      | `storageLayouts/catalogue:buildingStatusControl`       |             11 |     4.4 |        9.87 |             9.54 |        1 |       0.1 |                             |
| hr-admin     | `hr/leave:queuePage`                                   |             11 |     3.4 |       10.33 |             9.89 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/workflow:getProduct`                    |             10 |     3.4 |       10.64 |            10.11 |        1 |       0.7 |                             |
| fg-product   | `finishedGoods/batches:pageProductBatches`             |             10 |     3.2 |        10.4 |             9.67 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/history:palletMoveHistory`              |             10 |     3.4 |       10.45 |            10.02 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/workflow:stackChoices`                  |             10 |     3.4 |        9.66 |             9.23 |        1 |       0.1 |                             |
| job-scan     | `finishedGoods/scanning:resolvePackageCode`            |             10 |     3.5 |       10.46 |             9.55 |        1 |       0.1 | NOT_OK                      |
| hr-self      | `hr/self:requests`                                     |             10 |     4.3 |        10.3 |            10.14 |        1 |       0.6 |                             |
| hr-admin     | `hr/periods:listPage`                                  |             10 |     3.4 |       10.69 |            10.79 |        1 |       0.5 |                             |
| job-scan     | `finishedGoods/jobScanLocations:page`                  |              9 |     2.9 |       10.11 |            10.55 |        1 |       0.2 |                             |
| hr-self      | `hr/announcements:self`                                |              9 |     3.4 |       10.84 |            11.57 |        1 |       0.1 |                             |
| hr-self      | `hr/notifications:list`                                |              9 |     3.4 |        9.93 |            10.56 |        1 |       0.2 |                             |
| hr-self      | `hr/leave:self`                                        |              9 |     3.4 |       11.05 |            11.06 |        1 |       0.3 |                             |
| hr-admin     | `hr/roster:shifts`                                     |              9 |     2.8 |        9.99 |             9.94 |        1 |       0.2 |                             |
| hr-admin     | `hr/payslips:list`                                     |              9 |     3.4 |       11.14 |            10.64 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/payslips:imports`                                  |              8 |     2.7 |       10.28 |            10.74 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/org:listDepartments`                               |              8 |     2.7 |        10.3 |             9.58 |        1 |       0.1 |                             |
| ai-usage     | `aiUsage/reports:summary`                              |              8 |     2.7 |       10.51 |            10.58 |        1 |       1.2 |                             |
| ai-usage     | `aiUsage/reports:recent`                               |              8 |     2.7 |        9.77 |            10.15 |        1 |       0.1 |                             |

**candidate: write flows**

| Flow                               | Function                                 | Docs read | Docs written | Index rows | Exec p50 ms |
| ---------------------------------- | ---------------------------------------- | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans`    |        10 |            4 |         22 |       12.05 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan`   |        13 |            4 |         22 |       12.24 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans`  |        13 |            4 |         22 |       11.99 |
| job-scan save batch of 50 (max)    | `finishedGoods/jobScans:saveJobScans`    |        10 |           53 |        218 |       17.12 |
| pallet measurement save            | `finishedGoods/workflow:saveMeasurement` |        22 |            5 |         33 |       12.38 |

**candidate: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| saveJobScans (1 item)           |              2 |          122 |       64.1 |           31.4 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                       |
| reserve (awaiting pallet)       |             10 |         1692 |     2737.0 |          713.7 |                          1 (210) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/workflow:recommend×1 (687 docs); finishedGoods/workflow:recommendMove×1 (688 docs) |
| cancelReservation (same pallet) |             10 |         1692 |     2735.0 |          698.3 |                          2 (272) | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/workflow:recommend×1 (687 docs); finishedGoods/workflow:recommendMove×1 (688 docs) |
| createPallet (busiest product)  |              7 |          310 |      165.2 |          364.9 |                          1 (210) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (246 docs)                                                                                                                                                    |

**candidate: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 37.3 ms / max 43.5 ms

**candidate: contention** 8 concurrent createPallet (same product) → executions 19, OCC retries 11, failures 0, RTT p50 123.9 ms / max 355 ms

**base: write flows**

| Flow                               | Function                                 | Docs read | Docs written | Index rows | Exec p50 ms |
| ---------------------------------- | ---------------------------------------- | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans`    |        10 |            4 |         22 |       11.02 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan`   |        13 |            4 |         22 |       11.53 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans`  |        13 |            4 |         22 |       11.82 |
| job-scan save batch of 50 (max)    | `finishedGoods/jobScans:saveJobScans`    |        10 |           53 |        218 |       17.13 |
| pallet measurement save            | `finishedGoods/workflow:saveMeasurement` |        21 |            5 |         33 |       11.43 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Client follow-up requests (docs) | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | -------------: | -----------: | ---------: | -------------: | -------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           |              2 |          122 |       64.1 |             36 |                            0 (0) | finishedGoods/jobScans:listJobScans×2 (122 docs)                                                                                                                                                                                                                                                                                                                                                         |
| reserve (awaiting pallet)       |             10 |         6092 |     3805.2 |         1186.3 |                          1 (210) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/workflow:recommendMove×1 (2888 docs); finishedGoods/workflow:recommend×1 (2887 docs) |
| cancelReservation (same pallet) |             10 |         6090 |     3803.5 |         1505.4 |                          1 (210) | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/workflow:recommend×1 (2886 docs); finishedGoods/workflow:recommendMove×1 (2887 docs) |
| createPallet (busiest product)  |              7 |          310 |      165.2 |          205.1 |                          2 (272) | finishedGoods/catalogue:summary×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (246 docs)                                                                                                                                                      |

**base: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 38 ms / max 43.9 ms

**base: contention** 8 concurrent createPallet (same product) → executions 20, OCC retries 12, failures 0, RTT p50 150.6 ms / max 357.6 ms
