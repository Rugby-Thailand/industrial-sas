# Finished goods lane implementation status

Implemented: product storage-condition guard uses two exact tenant/product/status
index existence reads. RESERVED and STORED retain their rejection behavior;
equivalent condition text remains allowed. These reads remain inside the writer
transaction, so Convex range OCC protects concurrent occupancy transitions.

Migration: additive by_orgId_productId_status index on finishedGoodsPallets.
Deploy schema/index with the updated writer; no document rewrite or deletion.
Rollback can retain the unused index. No public API contract changed.

Local validation: finished-goods integration suite: 21 passing tests, including
10,001 unrelated pallets plus existing RESERVED/STORED guards. Changed-file ESLint
passed. This is local correctness evidence, not production load evidence or a
measured concurrent OCC benchmark.

Outstanding assigned work: concurrent product-edit/occupancy regression; bounded
batch APIs and ProductBatches caller migration; conditional placement/business-key
contracts and duplicate audit; retention policy/workers/tests/operator metrics;
generation/counter scale evidence. No retention or business data was deleted.
This commit is a partial lane delivery and must not be treated as completion of
the database review. No production deployment or browser acceptance was performed.
