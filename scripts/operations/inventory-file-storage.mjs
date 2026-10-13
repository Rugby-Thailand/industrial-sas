#!/usr/bin/env node
import { inventoryFileStorage } from "./file-storage-inventory.mjs";

const args = process.argv.slice(2);
if (args.length !== 1 || !/^--target=(staging|production)$/.test(args[0])) {
  console.error(
    "Usage: inventory-file-storage.mjs --target=staging|production",
  );
  process.exitCode = 1;
} else {
  const result = await inventoryFileStorage({
    targetName: args[0].slice("--target=".length),
    adminKey: process.env.CONVEX_INVENTORY_ADMIN_KEY,
  });
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
