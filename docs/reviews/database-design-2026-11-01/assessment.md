# Database design assessment

The initial source review rated the bounded application **7.5/10**. Tenant isolation and transactional integrity were stronger than query scaling and lifecycle management. The fixes retain Convex and the existing domain model.

## Findings addressed

- Product storage-condition checks now query exact tenant/product/status ranges. Unrelated inventory no longer causes the 10,000-row guard to reject a small product's edit. Transactional occupancy protection remains intact.
- Current batch units are separated from retired units and revision history. History is paged; the unused unpaged endpoint is removed. The existing product catalogue was already paged and did not need replacement.
- Payslip metadata no longer carries PDF bytes. Private payloads retain immutable hashes and ownership checks. Migration verifies both legacy and already-moved bytes before declaring completion.
- Temporary replay keys expire after 30 days and are cleaned in bounded daily tenant jobs. Expired access tickets are cleaned; permanent cancellation fences and business/audit history remain intact.
- Uniqueness contracts match actual domain identities, including legitimate shared position labels and dual move holds. Bounded duplicate auditing and writer regressions supplement index-shape checks.
- Large attendance periods close through bounded, resumable stages with write guards and explicit publication. Draft review, frozen rows and CSV export are paged. Date-lock reads exclude irrelevant old periods.

## Assessment after implementation

The implementation supports a provisional **8.5/10** design assessment, based on the local evidence in [validation](validation.md). This is a subjective engineering judgment, not a throughput benchmark or a claim of perfect behavior.

Warehouse counters and readiness generations still serialize some writes. Production retry rates, latency, subscription fan-out and sustainable load remain unmeasured. Abandoned attendance closes require a reviewer to resume or cancel them. Cloud migration completion, provider re-verification and external file recovery must be validated operationally; local fixture evidence does not establish business recovery objectives.

Migration procedures: [finished goods and retention](finished-goods-migration.md), [payslip payloads](../../operations/hr-payslip-payload-migration.md), [staged period closing](../../operations/hr-period-staged-close.md).
