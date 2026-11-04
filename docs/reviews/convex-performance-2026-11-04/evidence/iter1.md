Profile `iter1` · 2026-11-04T14:33:54.808Z · 7 uncached samples per target (p50) · dataset {"pallets":1305,"products":126,"zones":421,"buildings":127,"jobScans":2182,"employees":153}
Targets: candidate@80dc0a93+dirty, base@80dc0a93 · load avg before/after 4.1/2.6

| Screen       | Function                                               |       Docs read | KB read | Exec p50 ms | Base exec p50 ms | Requests | Return KB | Note                        |
| ------------ | ------------------------------------------------------ | --------------: | ------: | ----------: | ---------------: | -------: | --------: | --------------------------- |
| fg-pallet    | `finishedGoods/workflow:recommendMove`                 | 2455 (was 2887) |  1622.4 |       243.6 |           273.27 |        1 |     238.5 |                             |
| fg-pallet    | `finishedGoods/workflow:recommend`                     | 2454 (was 2886) |  1621.6 |      247.16 |           290.35 |        1 |     238.3 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (search)         |            2389 |  1541.1 |      428.58 |           385.56 |       22 |      21.5 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuilding`          |            1844 |  1328.2 |      147.45 |           151.28 |        1 |     453.4 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:getStorageBuildingInventory` |            1829 |  1317.4 |      169.38 |           167.57 |        1 |     447.8 |                             |
| fg-pallet    | `finishedGoods/workflow:list`                          |            1440 |   914.8 |       136.8 |           136.32 |        1 |     925.4 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:getStorageLocationMap`       |             936 |   671.6 |       97.88 |           108.22 |        1 |     376.2 | legacy (no live subscriber) |
| storage      | `storageLayouts/catalogue:buildingOccupancy`           |             917 |   819.4 |       76.69 |            81.99 |        1 |       1.0 |                             |
| job-scan     | `finishedGoods/jobScanLocations:searchPage`            |             896 |   474.3 |      111.98 |           113.46 |        2 |       0.8 |                             |
| storage      | `storageLayouts/locationCatalogue:detail`              |             312 |   274.5 |       75.34 |            82.96 |        1 |      62.6 |                             |
| fg-catalogue | `finishedGoods/catalogue:summary`                      |             272 |   136.9 |       37.33 |            37.78 |        2 |       1.6 |                             |
| hr-admin     | `hr/review:queuePage`                                  |             251 |   139.4 |       51.31 |            57.56 |        2 |       9.9 |                             |
| job-scan     | `finishedGoods/jobScanLocations:options`               |             218 |   134.8 |       22.05 |            22.69 |        1 |      13.2 |                             |
| hr-admin     | `hr/periods:preview`                                   |             164 |   114.0 |        14.9 |            15.86 |        1 |       0.8 |                             |
| hr-admin     | `hr/roster:roster`                                     |             162 |   112.8 |       13.95 |            14.82 |        1 |       0.1 | LIMIT_EXCEEDED              |
| hr-admin     | `hr/setup:employeesPage`                               |             141 |    83.6 |       17.15 |            17.42 |        1 |      15.0 |                             |
| hr-admin     | `hr/search:adminEmployees`                             |             111 |    75.2 |       11.76 |             14.4 |        1 |       1.5 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (products tab)          |             110 |    55.1 |       19.55 |            19.28 |        1 |      74.0 |                             |
| storage      | `storageLayouts/locationCatalogue:options`             |             109 |    69.1 |       10.56 |            11.97 |        1 |      14.5 |                             |
| storage      | `storageLayouts/locationCatalogue:page`                |              83 |    52.8 |       15.96 |            17.81 |        1 |      25.8 |                             |
| fg-pallet    | `finishedGoods/workflow:getPallet`                     |              75 |    50.9 |       15.75 |            17.37 |        1 |       2.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets tab)           |              65 |    39.2 |       31.28 |            31.18 |        1 |      75.3 |                             |
| fg-catalogue | `finishedGoods/catalogue:page` (pallets search)        |              65 |    39.2 |       31.39 |            31.29 |        1 |      75.3 |                             |
| job-scan     | `finishedGoods/jobScanLocations:buildingOptions`       |              61 |    37.8 |        10.8 |            11.44 |        1 |       7.7 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans`                  |              60 |    36.9 |       26.32 |            26.34 |        1 |      21.3 |                             |
| job-scan     | `finishedGoods/jobScans:listJobScans` (unmapped)       |              60 |    37.0 |       25.47 |            26.64 |        1 |      21.3 |                             |
| fg-product   | `finishedGoods/batches:pageLegacyUnits`                |              31 |    17.7 |        16.8 |            15.23 |        1 |      15.8 |                             |
| storage      | `storageLayouts/catalogue:listStorageBuildingsPage`    |              29 |    16.2 |        11.4 |            11.92 |        1 |      13.7 |                             |
| hr-admin     | `hr/periods:versionRowsPage`                           |              29 |    16.3 |         8.5 |             9.82 |        1 |       9.4 |                             |
| hr-admin     | `hr/setup:accessMembersPage`                           |              26 |     8.4 |       10.94 |            11.72 |        1 |       0.6 |                             |
| storage      | `storageLayouts/catalogue:getStorageBuildingLayout`    |              25 |    14.3 |       10.65 |            11.07 |        1 |       7.4 |                             |
| storage      | `storageLayouts/writes:layoutReadiness`                |              25 |    14.3 |       11.34 |            11.62 |        1 |       1.9 |                             |
| hr-admin     | `hr/setup:employee`                                    |              19 |     6.2 |        9.16 |            10.01 |        1 |       0.6 |                             |
| ai-usage     | `aiUsage/dimensions:actorOptions`                      |              17 |     5.3 |        7.62 |             8.99 |        1 |       0.4 |                             |
| shell        | `workspace/current:readCurrent`                        |              16 |     5.0 |       10.41 |             9.41 |        1 |       0.5 |                             |
| shell        | `hr/access:display`                                    |              16 |     5.3 |        9.91 |            10.17 |        1 |       0.7 |                             |
| job-scan     | `finishedGoods/jobScanLocations:resolve`               |              15 |     6.2 |       11.45 |            11.63 |        1 |       0.6 |                             |
| hr-self      | `hr/self:today`                                        |              14 |     6.3 |          11 |            10.22 |        1 |       0.8 |                             |
| job-scan     | `finishedGoods/scanning:resolveLocationCode`           |              13 |     5.0 |        8.92 |            10.58 |        1 |       0.5 |                             |
| fg-product   | `finishedGoods/catalogue:productSummary`               |              12 |     4.3 |        8.82 |            10.49 |        1 |       0.3 |                             |
| hr-self      | `hr/self:profile`                                      |              12 |     4.1 |        8.84 |             9.48 |        1 |       0.6 |                             |
| hr-self      | `hr/self:history`                                      |              12 |     5.6 |        9.81 |            10.26 |        1 |       1.6 |                             |
| shell        | `aiUsage/reports:access`                               |              11 |     3.4 |        8.96 |             9.02 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/batches:getBatch`                       |              11 |     3.7 |        8.84 |              9.3 |        1 |       1.0 |                             |
| storage      | `storageLayouts/catalogue:buildingStatusControl`       |              11 |     4.4 |        8.76 |             9.93 |        1 |       0.1 |                             |
| hr-admin     | `hr/leave:queuePage`                                   |              11 |     3.4 |        8.99 |             9.62 |        1 |       0.2 |                             |
| fg-product   | `finishedGoods/workflow:getProduct`                    |              10 |     3.4 |        9.76 |             9.41 |        1 |       0.7 |                             |
| fg-product   | `finishedGoods/batches:pageProductBatches`             |              10 |     3.2 |       10.25 |            10.07 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/history:palletMoveHistory`              |              10 |     3.4 |        9.42 |             8.93 |        1 |       0.1 |                             |
| fg-pallet    | `finishedGoods/workflow:stackChoices`                  |              10 |     3.4 |        9.71 |             8.21 |        1 |       0.1 |                             |
| job-scan     | `finishedGoods/scanning:resolvePackageCode`            |              10 |     3.5 |        8.62 |             8.85 |        1 |       0.1 | NOT_OK                      |
| hr-self      | `hr/self:requests`                                     |              10 |     4.3 |        8.48 |             8.62 |        1 |       0.6 |                             |
| hr-admin     | `hr/periods:listPage`                                  |              10 |     3.4 |        8.24 |             9.04 |        1 |       0.5 |                             |
| job-scan     | `finishedGoods/jobScanLocations:page`                  |               9 |     2.9 |         8.4 |             9.87 |        1 |       0.2 |                             |
| hr-self      | `hr/announcements:self`                                |               9 |     3.4 |        9.25 |             9.53 |        1 |       0.1 |                             |
| hr-self      | `hr/notifications:list`                                |               9 |     3.4 |        8.07 |              8.4 |        1 |       0.2 |                             |
| hr-self      | `hr/leave:self`                                        |               9 |     3.4 |        8.71 |             9.28 |        1 |       0.3 |                             |
| hr-admin     | `hr/roster:shifts`                                     |               9 |     2.8 |         7.8 |             8.82 |        1 |       0.2 |                             |
| hr-admin     | `hr/payslips:list`                                     |               9 |     3.4 |        8.41 |             8.57 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/payslips:imports`                                  |               8 |     2.7 |        7.83 |             8.98 |        1 |       0.1 | POLICY_NOT_ACTIVE           |
| hr-admin     | `hr/org:listDepartments`                               |               8 |     2.7 |        7.96 |             8.81 |        1 |       0.1 |                             |
| ai-usage     | `aiUsage/reports:summary`                              |               8 |     2.7 |        8.12 |             8.81 |        1 |       1.2 |                             |
| ai-usage     | `aiUsage/reports:recent`                               |               8 |     2.7 |        7.55 |             8.64 |        1 |       0.1 |                             |

**candidate: write flows**

| Flow                               | Function                                 | Docs read | Docs written | Index rows | Exec p50 ms |
| ---------------------------------- | ---------------------------------------- | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans`    |        10 |            4 |         22 |        9.32 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan`   |        13 |            4 |         22 |        9.54 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans`  |        13 |            4 |         22 |        9.62 |
| job-scan save batch of 50 (max)    | `finishedGoods/jobScans:saveJobScans`    |        10 |           53 |        218 |       12.59 |
| pallet measurement save            | `finishedGoods/workflow:saveMeasurement` |        11 |            2 |         14 |        7.47 |

**candidate: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | -------------: | -----------: | ---------: | -------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           |              3 |          232 |      123.6 |           50.5 | finishedGoods/jobScans:listJobScans×3 (232 docs)                                                                                                                                                                                                                                                                                                                                                          |
| reserve (awaiting pallet)       |             10 |         5428 |     3516.7 |         1120.4 | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/catalogue:summary×1 (210 docs); finishedGoods/workflow:recommend×1 (2455 docs); finishedGoods/workflow:recommendMove×1 (2456 docs) |
| cancelReservation (same pallet) |             10 |         5426 |     3514.9 |           1300 | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/catalogue:summary×1 (210 docs); finishedGoods/workflow:recommend×1 (2454 docs); finishedGoods/workflow:recommendMove×1 (2455 docs) |
| createPallet (busiest product)  |              7 |          510 |      269.1 |          215.3 | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (246 docs); finishedGoods/catalogue:summary×1 (210 docs)                                                                                                                                                      |

**candidate: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 98.7 ms / max 144.3 ms

**candidate: contention** 8 concurrent createPallet (same product) → executions 8, OCC retries 0, failures 0, RTT p50 115.9 ms / max 178.7 ms

**base: write flows**

| Flow                               | Function                                 | Docs read | Docs written | Index rows | Exec p50 ms |
| ---------------------------------- | ---------------------------------------- | --------: | -----------: | ---------: | ----------: |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:saveJobScans`    |        10 |            4 |         22 |       10.77 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:updateJobScan`   |        13 |            4 |         22 |       12.11 |
| job-scan save 1 → correct → delete | `finishedGoods/jobScans:deleteJobScans`  |        13 |            4 |         22 |       12.65 |
| job-scan save batch of 50 (max)    | `finishedGoods/jobScans:saveJobScans`    |        10 |           53 |        218 |        16.1 |
| pallet measurement save            | `finishedGoods/workflow:saveMeasurement` |        11 |            2 |         14 |        9.46 |

**base: reactive fan-out** (60 subscriptions open on one session)

| Write                           | Queries re-run | Docs re-read | KB re-read | Re-run exec ms | Re-run functions                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | -------------: | -----------: | ---------: | -------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| saveJobScans (1 item)           |              3 |          232 |      123.4 |           47.6 | finishedGoods/jobScans:listJobScans×3 (232 docs)                                                                                                                                                                                                                                                                                                                                                          |
| reserve (awaiting pallet)       |             10 |         6292 |     3909.2 |         1261.1 | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/catalogue:summary×1 (210 docs); finishedGoods/workflow:recommend×1 (2887 docs); finishedGoods/workflow:recommendMove×1 (2888 docs) |
| cancelReservation (same pallet) |             10 |         6290 |     3907.4 |           1323 | finishedGoods/workflow:stackChoices×1 (10 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (31 docs); finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/catalogue:page×3 (244 docs); finishedGoods/catalogue:summary×1 (210 docs); finishedGoods/workflow:recommendMove×1 (2887 docs); finishedGoods/workflow:recommend×1 (2886 docs) |
| createPallet (busiest product)  |              7 |          510 |      269.1 |            227 | finishedGoods/catalogue:productSummary×1 (12 docs); finishedGoods/batches:pageProductBatches×1 (10 docs); finishedGoods/batches:pageLegacyUnits×1 (32 docs); finishedGoods/catalogue:page×3 (246 docs); finishedGoods/catalogue:summary×1 (210 docs)                                                                                                                                                      |

**base: contention** 8 concurrent saveJobScans → executions 8, OCC retries 0, failures 0, RTT p50 80.1 ms / max 124.7 ms

**base: contention** 8 concurrent createPallet (same product) → executions 8, OCC retries 0, failures 0, RTT p50 109.3 ms / max 171.9 ms
