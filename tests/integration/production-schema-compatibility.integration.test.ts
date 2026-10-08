import { describe, expect, it } from "vitest";

import schema from "../../convex/schema";
import productionFields from "../fixtures/production-schema-2026-10-08.json";

interface ExportedTable {
  tableName: string;
  documentType: { value: Record<string, unknown> };
}

// Captured from the active production schema, without document data. These
// fields must remain valid when main is deployed over existing records.
// Convex's deployment serializer is runtime-only and omitted from its public
// declarations; this assertion is confined to the deployment-contract test.
const deploymentSchema = schema as unknown as { export(): string };
const tables = (
  JSON.parse(deploymentSchema.export()) as { tables: ExportedTable[] }
).tables;

describe("existing production document compatibility", () => {
  for (const [tableName, fields] of Object.entries(productionFields)) {
    it(`preserves deployed metadata in ${tableName}`, () => {
      const table = tables.find(
        (candidate) => candidate.tableName === tableName,
      );
      expect(table).toBeDefined();
      for (const [fieldName, validator] of Object.entries(fields)) {
        expect(
          table?.documentType.value[fieldName],
          `${tableName}.${fieldName}`,
        ).toEqual(validator);
      }
    });
  }
});
